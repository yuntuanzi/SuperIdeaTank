// 知乎 OAuth 模块 —— 移植自官方黑客松参考实现
// （zhihu-hackathon Skill · assets/hello-world-oauth/lib/oauth.mjs），协议行为以它为事实源。
//
// 与参考实现的两处平台改造（参考实现是 macOS 专用）：
//   1) 凭证不再读 macOS 钥匙串（/usr/bin/security），只保留参考实现本身就有的
//      process.env.ZHIHU_OAUTH_APP_KEY 环境变量分支；
//   2) runCurl() spawn /usr/bin/curl 改为 Node 内置 fetch（项目 Node 24 原生支持），
//      保持同样的超时（换 Token 20s / 用户接口 30s）与错误归一化语义：
//      HTTP 非 2xx 不视为传输失败（curl 未加 --fail 时同语义），body 交回业务层判 Code；
//      网络层失败归一化为「网络请求失败」，body 非 JSON 归一化为「返回了无法解析的响应」。
//
// 安全边界（赛事红线，见 zhihu skill/references/hackathon-oauth.md）：
//   - app_key / Access Secret / authorization_code / OAuth token 只存在于本模块内部，
//     任何返回给路由层的数据都不携带它们；错误消息也不回显请求内容。
//   - OAuth Token 只存进程内存（sessions Map），不落盘、不进缓存文件、不进前端。
//   - 所有出站请求都通过可注入的 fetchImpl 发出，测试用替身喂假响应，绝不真发请求。

import { randomBytes, timingSafeEqual } from 'node:crypto';

// ---- 出站请求（fetch 版 runCurl） ----

// 参考实现的 runCurl 用 curl --config 逐行配参数，max-time 控制总超时。
// fetch 没有内建总超时，用 AbortController 实现同样的「到点掐断」语义。
async function httpJson(url, { method = 'GET', headers = {}, body, timeoutMs, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetchImpl(url, { method, headers, body, signal: controller.signal });
  } catch (error) {
    // 归一化传输层错误：超时就说是超时，其余（DNS/连接拒绝/重置）合并成一类，
    // 不把底层错误对象原样外抛，避免其中可能夹带的 URL/头信息进入日志。
    throw new Error(error?.name === 'AbortError' ? '请求知乎开放平台超时' : '网络请求失败');
  } finally {
    clearTimeout(timer);
  }
  // curl 未加 --fail：HTTP 4xx/5xx 时 curl 退出码仍为 0，参考实现照样解析 body
  // 交给 payloadError 判业务错误码。fetch 版保持同语义——不检查 res.ok。
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('知乎开放平台返回了无法解析的响应');
  }
}

// 进入 HTTP 头部的凭证做最小格式校验：换行/引号/反斜杠能篡改参考实现 curl --config
// 的逐行语法（注入额外请求行）。fetch 版虽然不受该语法影响，但保留同样的拒绝行为，
// 让脏凭证在出网前就失败，而不是变成一次行为难料的真实请求。
function safe(value) {
  if (!value || /[\r\n"\\]/.test(value)) throw new Error('凭证格式无效');
  return value;
}

// 知乎业务错误载体不统一（code/Code、data/message 大小写都出现过），
// 归一化成带 code 的 Error；消息截断 200 字符，防止异常大的响应体进入日志。
function payloadError(payload, fallback) {
  const data = payload?.data ?? payload?.Data;
  const message = typeof data === 'string' ? data : data?.message || payload?.message || payload?.Message || fallback;
  const error = new Error(String(message).slice(0, 200));
  error.code = payload?.code ?? payload?.Code ?? 'OAUTH_FAILED';
  return error;
}

function cookieId(request) {
  const value = (request.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith('zhihu_hackathon_session='));
  return value ? decodeURIComponent(value.slice(value.indexOf('=') + 1)) : null;
}

// state 比较必须定长定耗时：length 不同直接 false，长度相同走 timingSafeEqual，
// 避免逐字符比较的时间侧信道被用来逐位爆破 state。
function equal(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

// 用户数据接口必须同时带三个头：Access Secret 鉴权调用方，X-OAuth-Token 指明授权用户，
// 秒级时间戳防重放。app_key 绝不能出现在其中任何一个头里（黑客松文档明确要求）。
function userHeaders(accessSecret, oauthToken) {
  return {
    Authorization: `Bearer ${safe(accessSecret)}`,
    'X-OAuth-Token': safe(oauthToken),
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    'Content-Type': 'application/json',
  };
}

export function createOAuth(config) {
  const sessions = new Map(); // sessionId → 会话；Token 只活在这里，进程重启即清空
  const oauthConfig = config.oauth;
  // 测试通过 config.fetchImpl 注入替身；生产缺省用全局 fetch
  const fetchImpl = config.fetchImpl || fetch;

  function session(request, response) {
    let id = cookieId(request);
    let current = id ? sessions.get(id) : null;
    if (!current) {
      id = randomBytes(24).toString('base64url');
      current = { id, state: null, token: null, expiresAt: null, profile: null, stateVerified: null, error: null };
      sessions.set(id, current);
      // HttpOnly 让前端 JS 读不到会话 id；SameSite=Lax 允许知乎授权页跳回时带上 cookie
      response.setHeader('Set-Cookie', `zhihu_hackathon_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`);
    }
    return current;
  }

  // 只从环境变量取凭证（参考实现的钥匙串分支已按平台改造要求移除）
  function credentials() {
    return {
      appKey: process.env.ZHIHU_OAUTH_APP_KEY || null,
      accessSecret: process.env.ZHIHU_ACCESS_SECRET || null,
    };
  }

  // Token 到点即清（参考实现行为）：判过期只在读取侧做，不跑后台定时器
  function clearIfExpired(current) {
    if (current.expiresAt && current.expiresAt <= Date.now()) {
      current.token = null;
      current.profile = null;
      current.error = { code: 'TOKEN_EXPIRED', message: '授权已过期，请重新连接。' };
    }
  }

  // 路由层需要按会话 id 建画像缓存，这里只暴露 id，不暴露会话内部字段
  function sessionId(request, response) {
    return session(request, response).id;
  }

  async function status(request, response) {
    const current = session(request, response);
    const creds = credentials();
    clearIfExpired(current);
    return {
      configured: Boolean(creds.appKey && creds.accessSecret && oauthConfig.redirectUri),
      callbackConfigured: Boolean(oauthConfig.redirectUri),
      authorized: Boolean(current.token),
      appId: oauthConfig.appId,
      redirectUri: oauthConfig.redirectUri,
      profile: current.profile,
      stateVerified: current.stateVerified,
      expiresAt: current.expiresAt ? new Date(current.expiresAt).toISOString() : null,
      error: current.error,
    };
  }

  async function start(request, response) {
    const current = session(request, response);
    // localhost/127.0.0.1 不是登记的公网回调，本地直接拒绝而不是发出一个注定失败的跳转
    if (!oauthConfig.redirectUri) {
      throw Object.assign(new Error('本地地址无法完成知乎登录。请先部署应用并配置公网回调地址。'), { code: 'DEPLOYMENT_REQUIRED' });
    }
    const { appKey } = credentials();
    if (!appKey) throw Object.assign(new Error('OAuth app_key 尚未配置'), { code: 'APP_KEY_REQUIRED' });
    current.state = randomBytes(24).toString('base64url');
    current.error = null;
    const url = new URL('https://openapi.zhihu.com/authorize');
    url.searchParams.set('redirect_uri', oauthConfig.redirectUri);
    url.searchParams.set('app_id', oauthConfig.appId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', current.state);
    return url.toString();
  }

  async function callback(request, response, url) {
    const current = session(request, response);
    // 实测主回调参数是 authorization_code；兼容读 code（黑客松文档记录的协议缺口）
    const code = url.searchParams.get('authorization_code') || url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    if (!code) throw Object.assign(new Error('回调缺少 authorization_code'), { code: 'CODE_MISSING' });
    if (returnedState && !equal(returnedState, current.state)) {
      throw Object.assign(new Error('state 校验失败'), { code: 'STATE_MISMATCH' });
    }
    const { appKey, accessSecret } = credentials();
    if (!appKey || !accessSecret) throw new Error('后端凭证配置不完整');
    // Token 接口的表单字段名是 code（不是回调参数名 authorization_code），别搞混
    const form = new URLSearchParams({
      app_id: oauthConfig.appId,
      app_key: safe(appKey),
      grant_type: 'authorization_code',
      redirect_uri: oauthConfig.redirectUri,
      code: safe(code),
    }).toString();
    const payload = await httpJson('https://openapi.zhihu.com/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      timeoutMs: 20000,
      fetchImpl,
    });
    // 判成功只看有没有 access_token：业务响应可能用 code:20000 表成功，不能仅凭它判定
    const token = payload?.access_token || payload?.data?.access_token || payload?.Data?.access_token;
    if (!token) throw payloadError(payload, '未获得 OAuth access token');
    const expiresIn = Number(payload?.expires_in ?? payload?.data?.expires_in ?? payload?.Data?.expires_in);
    current.token = token;
    current.expiresAt = Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : null;
    // 实测回调可能不带 state：不报错放行，但必须如实记录这次授权没经过 CSRF 校验
    current.stateVerified = Boolean(returnedState);
    current.state = null;
    current.error = null;

    // 头像昵称只用于顶栏展示；拉取失败不阻断授权主流程，profile 留空即可
    try {
      const profilePayload = await httpJson('https://openapi.zhihu.com/user', {
        headers: userHeaders(accessSecret, token),
        timeoutMs: 30000,
        fetchImpl,
      });
      const source = profilePayload?.data || profilePayload?.Data || profilePayload?.user || null;
      if (source && typeof source === 'object') {
        current.profile = {
          name: source.name || source.Fullname || source.fullname || null,
          avatarUrl: source.avatar_url || source.AvatarUrl || null,
          headline: source.headline || source.Headline || null,
          url: source.url || source.Url || null,
        };
      }
    } catch {
      current.profile = null;
    }
  }

  // 读取授权用户自己的公开创作（user_data 接口，画像功能唯一的数据源）。
  // Token 过期或鉴权失败时直接报错，绝不回退到 Access Secret 所属账号的数据——
  // 那是别人的账号，回退等于把用户画像张冠李戴。
  async function fetchUserContents(request, response, { limit = 20 } = {}) {
    const current = session(request, response);
    clearIfExpired(current);
    if (!current.token) throw Object.assign(new Error('请先完成知乎账号授权'), { code: 'LOGIN_REQUIRED' });
    const { accessSecret } = credentials();
    if (!accessSecret) throw new Error('开放平台 Access Secret 未配置');
    const query = new URLSearchParams({
      ContentType: 'all',
      Limit: String(limit),
      Offset: '0',
      SortField: 'ts',
      SortOrder: 'desc',
    });
    const payload = await httpJson(`https://developer.zhihu.com/api/v1/user/contents?${query}`, {
      headers: userHeaders(accessSecret, current.token),
      timeoutMs: 30000,
      fetchImpl,
    });
    if (payload?.Code !== 0) throw payloadError(payload, '用户数据接口失败');
    return (payload?.Data?.Items || []).map((item) => ({
      contentType: item?.ContentType || '',
      title: item?.Title || '',
      url: item?.Url || '',
      // Summary 可能带 HTML 标签，标注器只应看到纯文本
      excerpt: String(item?.Summary || '').replace(/<[^>]+>/g, '').trim(),
      createdAt: Number(item?.CreatedAt) || 0,
      likeCount: Number(item?.LikeCount) || 0,
      commentCount: Number(item?.CommentCount) || 0,
    }));
  }

  function logout(request, response) {
    const current = session(request, response);
    current.token = null; current.expiresAt = null; current.profile = null; current.state = null; current.stateVerified = null; current.error = null;
  }

  // 授权流程失败要能在 status 里被前端看到（用户从知乎跳回来时只看到 ?oauth=err），
  // 错误只记 code 和截断后的消息，不带任何凭证上下文。
  function record(request, response, error) {
    session(request, response).error = { code: String(error.code || 'OAUTH_FAILED'), message: String(error.message).slice(0, 200) };
  }

  // 仅供服务端权限守卫使用，不把 token 或会话对象暴露给路由层/前端。
  function isAuthorized(request, response) {
    const current = session(request, response);
    clearIfExpired(current);
    return Boolean(current.token);
  }

  return { status, start, callback, logout, fetchUserContents, sessionId, record, isAuthorized };
}
