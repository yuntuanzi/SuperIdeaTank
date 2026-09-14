// OAuth 模块测试：全部使用注入的 fetchImpl 替身喂假响应，绝不发起真实 OAuth 请求
// （回调地址尚未部署登记，且授权确认必须由用户本人点击）。
// 本文件所有凭证值都是测试专用假值；真实 app_key/token 的任何片段都不允许出现在这里。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createOAuth } from '../src/oauth.js';

// 测试专用假凭证（不是真实值，仅用于验证字段流向）
const FAKE_APP_KEY = 'test-only-fake-app-key';
const FAKE_SECRET = 'test-only-fake-access-secret';
const FAKE_TOKEN = 'test-only-fake-oauth-token';
const FAKE_CODE = 'test-only-fake-auth-code';

// 每个用例前后固定/恢复环境变量：凭证读取只走 env，测试必须完全控制这两个键
function withEnv(t) {
  const saved = {
    ZHIHU_OAUTH_APP_KEY: process.env.ZHIHU_OAUTH_APP_KEY,
    ZHIHU_ACCESS_SECRET: process.env.ZHIHU_ACCESS_SECRET,
  };
  process.env.ZHIHU_OAUTH_APP_KEY = FAKE_APP_KEY;
  process.env.ZHIHU_ACCESS_SECRET = FAKE_SECRET;
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

const fakeReq = (cookie = '') => ({ headers: { cookie } });
const fakeRes = () => ({
  headers: {},
  setHeader(k, v) { this.headers[k] = v; },
});
// 从假响应里取出会话 cookie，模拟浏览器在下一次请求带回
function sessionCookie(res) {
  const setCookie = res.headers['Set-Cookie'];
  assert.ok(setCookie?.startsWith('zhihu_hackathon_session='), '会话必须写入 HttpOnly cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Lax/);
  return setCookie.split(';')[0];
}

const jsonRes = (obj) => ({ text: async () => JSON.stringify(obj) });

// 记录每一次出站请求（URL/方法/头/体），供断言协议形状；按 URL 前缀分发假响应
function makeFakeFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    for (const [prefix, respond] of routes) {
      if (url.startsWith(prefix)) return typeof respond === 'function' ? respond(url, options) : jsonRes(respond);
    }
    throw new Error(`测试未预期的 URL 前缀`);
  };
  return { impl, calls };
}

const CONFIGURED = { oauth: { appId: 'test-app-id', redirectUri: 'https://app.example.com/auth/callback' } };

test('status：未配回调时 configured/callbackConfigured 均为 false，且不携带任何凭证字段', async (t) => {
  withEnv(t);
  const oauth = createOAuth({ oauth: { appId: 'test-app-id', redirectUri: '' } });
  const status = await oauth.status(fakeReq(), fakeRes());
  assert.equal(status.configured, false);
  assert.equal(status.callbackConfigured, false);
  assert.equal(status.authorized, false);
  assert.equal(status.appId, 'test-app-id');
  // 序列化后的整个响应里不允许出现 app_key / token / code 的假值片段
  const raw = JSON.stringify(status);
  for (const secret of [FAKE_APP_KEY, FAKE_SECRET, FAKE_TOKEN, FAKE_CODE]) {
    assert.ok(!raw.includes(secret), 'status 响应泄露了凭证片段');
  }
});

test('start：未配回调时抛 DEPLOYMENT_REQUIRED，绝不把 localhost 当可用回调', async (t) => {
  withEnv(t);
  const oauth = createOAuth({ oauth: { appId: 'test-app-id', redirectUri: '' } });
  await assert.rejects(
    () => oauth.start(fakeReq(), fakeRes()),
    (e) => e.code === 'DEPLOYMENT_REQUIRED' && e.message.includes('请先部署应用并配置公网回调地址'),
  );
});

test('start：生成知乎授权 URL，带 app_id/redirect_uri/response_type/state 并写会话 cookie', async (t) => {
  withEnv(t);
  const oauth = createOAuth({ ...CONFIGURED, fetchImpl: makeFakeFetch([]).impl });
  const res = fakeRes();
  const authUrl = await oauth.start(fakeReq(), res);
  const url = new URL(authUrl);
  assert.equal(url.origin, 'https://openapi.zhihu.com');
  assert.equal(url.pathname, '/authorize');
  assert.equal(url.searchParams.get('app_id'), 'test-app-id');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example.com/auth/callback');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.ok(url.searchParams.get('state')?.length > 16, 'state 必须是高熵随机串');
  sessionCookie(res);
});

// 完整成功链路：start → 知乎跳回 → 换 token → 拉 profile → status 反映授权态
async function runSuccessFlow(t, { callbackQuery, fetchRoutes } = {}) {
  const { impl, calls } = makeFakeFetch(fetchRoutes || [
    ['https://openapi.zhihu.com/access_token', { access_token: FAKE_TOKEN, expires_in: 7200 }],
    ['https://openapi.zhihu.com/user', { data: { name: '测试用户', avatar_url: 'https://pic.example.com/a.jpg', headline: '测试签名', url: 'https://www.zhihu.com/people/test' } }],
  ]);
  const oauth = createOAuth({ ...CONFIGURED, fetchImpl: impl });
  const res1 = fakeRes();
  const authUrl = await oauth.start(fakeReq(), res1);
  const state = new URL(authUrl).searchParams.get('state');
  const cookie = sessionCookie(res1);
  const query = callbackQuery ?? `authorization_code=${FAKE_CODE}&state=${state}`;
  const res2 = fakeRes();
  await oauth.callback(fakeReq(cookie), res2, new URL(`https://app.example.com/auth/callback?${query}`));
  return { oauth, cookie, calls, state };
}

test('callback 成功链路：换 token 表单字段名为 code，用户接口带齐三个鉴权头', async (t) => {
  withEnv(t);
  const { oauth, cookie, calls } = await runSuccessFlow(t);

  const tokenCall = calls.find((c) => c.url.startsWith('https://openapi.zhihu.com/access_token'));
  assert.equal(tokenCall.options.method, 'POST');
  const form = new URLSearchParams(tokenCall.options.body);
  // 表单字段名是 code（不是回调参数名 authorization_code），grant_type 固定值
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), FAKE_CODE);
  assert.equal(form.get('authorization_code'), null);
  assert.equal(form.get('app_id'), 'test-app-id');
  assert.equal(form.get('app_key'), FAKE_APP_KEY);
  assert.equal(form.get('redirect_uri'), 'https://app.example.com/auth/callback');

  const userCall = calls.find((c) => c.url.startsWith('https://openapi.zhihu.com/user'));
  // 三个头缺一不可；app_key 不允许出现在其中任何一个头里
  assert.equal(userCall.options.headers.Authorization, `Bearer ${FAKE_SECRET}`);
  assert.equal(userCall.options.headers['X-OAuth-Token'], FAKE_TOKEN);
  assert.match(userCall.options.headers['X-Request-Timestamp'], /^\d{10}$/);
  assert.ok(!Object.values(userCall.options.headers).includes(FAKE_APP_KEY));

  const status = await oauth.status(fakeReq(cookie), fakeRes());
  assert.equal(status.authorized, true);
  assert.equal(status.stateVerified, true);
  assert.equal(status.profile?.name, '测试用户');
  assert.ok(status.expiresAt, '有 expires_in 时必须给出过期时间');
  const raw = JSON.stringify(status);
  for (const secret of [FAKE_APP_KEY, FAKE_SECRET, FAKE_TOKEN, FAKE_CODE]) {
    assert.ok(!raw.includes(secret), '授权后的 status 泄露了凭证片段');
  }
});

test('callback：回调参数名以 authorization_code 为主，同时兼容 code', async (t) => {
  withEnv(t);
  // 用兼容参数 code 走一遍完整流程，也能授权成功
  const { oauth, cookie, state } = await runSuccessFlow(t, { callbackQuery: undefined });
  void state;
  const oauth2 = createOAuth({
    ...CONFIGURED,
    fetchImpl: makeFakeFetch([
      ['https://openapi.zhihu.com/access_token', { access_token: FAKE_TOKEN, expires_in: 7200 }],
      ['https://openapi.zhihu.com/user', { data: null }],
    ]).impl,
  });
  const res1 = fakeRes();
  const authUrl = await oauth2.start(fakeReq(), res1);
  const state2 = new URL(authUrl).searchParams.get('state');
  const cookie2 = sessionCookie(res1);
  await oauth2.callback(fakeReq(cookie2), fakeRes(), new URL(`https://app.example.com/auth/callback?code=${FAKE_CODE}&state=${state2}`));
  assert.equal((await oauth2.status(fakeReq(cookie2), fakeRes())).authorized, true);
  assert.equal((await oauth.status(fakeReq(cookie), fakeRes())).authorized, true);
});

test('callback：回调不带 state 时放行但如实记 stateVerified=false（官方实测协议缺口）', async (t) => {
  withEnv(t);
  const { oauth, cookie } = await runSuccessFlow(t, { callbackQuery: `authorization_code=${FAKE_CODE}` });
  const status = await oauth.status(fakeReq(cookie), fakeRes());
  assert.equal(status.authorized, true);
  assert.equal(status.stateVerified, false);
});

test('callback：state 不匹配直接拒绝换 token（CSRF 防线）', async (t) => {
  withEnv(t);
  const { impl, calls } = makeFakeFetch([
    ['https://openapi.zhihu.com/access_token', { access_token: FAKE_TOKEN, expires_in: 7200 }],
  ]);
  const oauth = createOAuth({ ...CONFIGURED, fetchImpl: impl });
  const res1 = fakeRes();
  await oauth.start(fakeReq(), res1);
  const cookie = sessionCookie(res1);
  await assert.rejects(
    () => oauth.callback(fakeReq(cookie), fakeRes(), new URL(`https://app.example.com/auth/callback?authorization_code=${FAKE_CODE}&state=forged-state`)),
    (e) => e.code === 'STATE_MISMATCH',
  );
  assert.equal(calls.length, 0, 'state 校验失败时不许发出换 token 请求');
});

test('callback：缺少授权码直接失败，不进入换 token 环节', async (t) => {
  withEnv(t);
  const { impl, calls } = makeFakeFetch([]);
  const oauth = createOAuth({ ...CONFIGURED, fetchImpl: impl });
  await assert.rejects(
    () => oauth.callback(fakeReq(), fakeRes(), new URL('https://app.example.com/auth/callback?state=x')),
    (e) => e.code === 'CODE_MISSING',
  );
  assert.equal(calls.length, 0);
});

test('callback：判成功只看有没有 access_token，code:20000 但无 token 也判失败', async (t) => {
  withEnv(t);
  const { impl } = makeFakeFetch([
    ['https://openapi.zhihu.com/access_token', { code: 20000, message: 'ok but no token' }],
  ]);
  const oauth = createOAuth({ ...CONFIGURED, fetchImpl: impl });
  const res1 = fakeRes();
  const authUrl = await oauth.start(fakeReq(), res1);
  const state = new URL(authUrl).searchParams.get('state');
  const cookie = sessionCookie(res1);
  await assert.rejects(
    () => oauth.callback(fakeReq(cookie), fakeRes(), new URL(`https://app.example.com/auth/callback?authorization_code=${FAKE_CODE}&state=${state}`)),
  );
  assert.equal((await oauth.status(fakeReq(cookie), fakeRes())).authorized, false);
});

test('token 过期：到点后 status 清 token 并报 TOKEN_EXPIRED', async (t) => {
  withEnv(t);
  const { oauth, cookie } = await runSuccessFlow(t, {
    fetchRoutes: [
      ['https://openapi.zhihu.com/access_token', { access_token: FAKE_TOKEN, expires_in: -1 }],
      ['https://openapi.zhihu.com/user', { data: null }],
    ],
  });
  const status = await oauth.status(fakeReq(cookie), fakeRes());
  assert.equal(status.authorized, false);
  assert.equal(status.profile, null);
  assert.equal(status.error?.code, 'TOKEN_EXPIRED');
});

test('logout：清空授权态，profile 与过期时间一并清除', async (t) => {
  withEnv(t);
  const { oauth, cookie } = await runSuccessFlow(t);
  oauth.logout(fakeReq(cookie), fakeRes());
  const status = await oauth.status(fakeReq(cookie), fakeRes());
  assert.equal(status.authorized, false);
  assert.equal(status.profile, null);
  assert.equal(status.expiresAt, null);
});

test('错误归一化：网络层失败与非法 JSON 都归一成固定文案，不回显响应细节', async (t) => {
  withEnv(t);
  const networkDown = createOAuth({
    ...CONFIGURED,
    fetchImpl: async () => { throw new TypeError('getaddrinfo ENOTFOUND openapi.zhihu.com'); },
  });
  const res1 = fakeRes();
  const authUrl = await networkDown.start(fakeReq(), res1);
  const state = new URL(authUrl).searchParams.get('state');
  const cookie = sessionCookie(res1);
  await assert.rejects(
    () => networkDown.callback(fakeReq(cookie), fakeRes(), new URL(`https://app.example.com/auth/callback?authorization_code=${FAKE_CODE}&state=${state}`)),
    (e) => e.message === '网络请求失败',
  );

  const badJson = createOAuth({ ...CONFIGURED, fetchImpl: async () => ({ text: async () => '<html>502</html>' }) });
  const res2 = fakeRes();
  const authUrl2 = await badJson.start(fakeReq(), res2);
  const state2 = new URL(authUrl2).searchParams.get('state');
  const cookie2 = sessionCookie(res2);
  await assert.rejects(
    () => badJson.callback(fakeReq(cookie2), fakeRes(), new URL(`https://app.example.com/auth/callback?authorization_code=${FAKE_CODE}&state=${state2}`)),
    (e) => e.message === '知乎开放平台返回了无法解析的响应',
  );
});

test('fetchUserContents：未授权抛 LOGIN_REQUIRED；授权后拉取创作并剥离 HTML', async (t) => {
  withEnv(t);
  const contents = {
    Code: 0,
    Data: {
      Items: [
        { ContentType: 'answer', Title: '如何看待远程办公？', Summary: '<p>数据显示远程办公占比提升。</p>', Url: 'https://www.zhihu.com/answer/1', CreatedAt: 1700000000, LikeCount: 12, CommentCount: 3 },
      ],
    },
  };
  const { impl, calls } = makeFakeFetch([
    ['https://openapi.zhihu.com/access_token', { access_token: FAKE_TOKEN, expires_in: 7200 }],
    ['https://openapi.zhihu.com/user', { data: null }],
    ['https://developer.zhihu.com/api/v1/user/contents', contents],
  ]);
  const oauth = createOAuth({ ...CONFIGURED, fetchImpl: impl });

  // 未授权直接抛 LOGIN_REQUIRED，不发出任何用户数据请求
  await assert.rejects(() => oauth.fetchUserContents(fakeReq(), fakeRes()), (e) => e.code === 'LOGIN_REQUIRED');

  const res1 = fakeRes();
  const authUrl = await oauth.start(fakeReq(), res1);
  const state = new URL(authUrl).searchParams.get('state');
  const cookie = sessionCookie(res1);
  await oauth.callback(fakeReq(cookie), fakeRes(), new URL(`https://app.example.com/auth/callback?authorization_code=${FAKE_CODE}&state=${state}`));

  const items = await oauth.fetchUserContents(fakeReq(cookie), fakeRes());
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '如何看待远程办公？');
  assert.equal(items[0].excerpt, '数据显示远程办公占比提升。');
  assert.equal(items[0].likeCount, 12);

  const contentsCall = calls.find((c) => c.url.startsWith('https://developer.zhihu.com/api/v1/user/contents'));
  const params = new URL(contentsCall.url).searchParams;
  assert.equal(params.get('ContentType'), 'all');
  assert.equal(params.get('Limit'), '20');
  assert.equal(params.get('SortField'), 'ts');
  assert.equal(contentsCall.options.headers['X-OAuth-Token'], FAKE_TOKEN);

  // 业务错误码（Code !== 0）必须归一为带 code 的错误
  const failing = createOAuth({
    ...CONFIGURED,
    fetchImpl: makeFakeFetch([
      ['https://openapi.zhihu.com/access_token', { access_token: FAKE_TOKEN, expires_in: 7200 }],
      ['https://openapi.zhihu.com/user', { data: null }],
      ['https://developer.zhihu.com/api/v1/user/contents', { Code: 30002, Message: 'quota exceeded' }],
    ]).impl,
  });
  const res3 = fakeRes();
  const authUrl3 = await failing.start(fakeReq(), res3);
  const state3 = new URL(authUrl3).searchParams.get('state');
  const cookie3 = sessionCookie(res3);
  await failing.callback(fakeReq(cookie3), fakeRes(), new URL(`https://app.example.com/auth/callback?authorization_code=${FAKE_CODE}&state=${state3}`));
  await assert.rejects(() => failing.fetchUserContents(fakeReq(cookie3), fakeRes()), (e) => e.code === 30002);
});

// 路由级测试：起真实服务进程，验证 /auth/callback 没被 SPA fallback 吃掉、
// start 未配回调返回 409、species 未授权返回 401。环境变量全部置空，模拟「未配置」部署前状态。
test('路由：/auth/callback 先于 SPA fallback 命中，未配置时各端点行为符合契约', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-api-'));
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const server = spawn(process.execPath, [new URL('../src/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: {
      ...process.env,
      PORT: String(port),
      TANK_DATA_DIR: dataDir,
      // 显式置空，防止 .env 加载器填入本机真实配置，保证「未配置」语义确定
      ZHIHU_ACCESS_SECRET: '',
      ZHIHU_OAUTH_APP_ID: '',
      ZHIHU_OAUTH_APP_KEY: '',
      ZHIHU_OAUTH_REDIRECT_URI: '',
      ZHIDA_DAILY_LIMIT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试服务启动超时')), 10000);
      server.once('error', (error) => { clearTimeout(timer); reject(error); });
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`测试服务提前退出 ${code}`)); });
      server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    });
    const base = `http://127.0.0.1:${port}`;

    const status = await fetch(`${base}/api/oauth/status`).then((r) => r.json());
    assert.equal(status.configured, false);
    assert.equal(status.callbackConfigured, false);
    assert.equal(status.authorized, false);

    // 未配回调：409 + DEPLOYMENT_REQUIRED，而不是 302 去一个 localhost 回调
    const startRes = await fetch(`${base}/api/oauth/start`, { redirect: 'manual' });
    assert.equal(startRes.status, 409);
    assert.equal((await startRes.json()).code, 'DEPLOYMENT_REQUIRED');

    // 关键防回归：若被 SPA fallback 吃掉会返回 200 HTML；正确行为是 302 回首页带错误标记
    const callbackRes = await fetch(`${base}/auth/callback`, { redirect: 'manual' });
    assert.equal(callbackRes.status, 302);
    assert.equal(callbackRes.headers.get('location'), '/?oauth=err');

    const logoutRes = await fetch(`${base}/api/oauth/logout`, { method: 'POST' });
    assert.equal(logoutRes.status, 200);

    const speciesRes = await fetch(`${base}/api/profile/species`);
    assert.equal(speciesRes.status, 401);
    assert.equal((await speciesRes.json()).code, 'LOGIN_REQUIRED');
  } finally {
    const stopped = server.exitCode !== null ? Promise.resolve() : once(server, 'exit');
    server.kill();
    await stopped;
    if (path.dirname(path.resolve(dataDir)) === path.resolve(os.tmpdir()) && path.basename(dataDir).startsWith('oauth-api-')) fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
