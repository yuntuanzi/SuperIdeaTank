// 观点进化缸 · 服务端入口
// 职责：持有全部凭证、代理知乎开放平台、构建生态缸、放生分析、AI 识别编排。

// 必须是第一条 import：ESM 会先求值全部依赖，配置必须早于任何使用者的模块顶层代码。
import './loadEnv.js';

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasSecret, fetchHot, fetchQuota, zhidaCount, hashKey, ecoCache, ECO_TTL, loadEcoCache, persistEcoCacheEntry, listReadyTanks, dedup } from './zhihu.js';
import { buildEcosystem, analyzeRelease, explainEcosystem, refreshLocalAnnotations } from './ecosystem.js';
import { annotateOne } from './annotator.js';
import { survivalRule } from './ruleModel.js';
import { demoHot, demoEcosystem } from './demoData.js';
import { createOAuth } from './oauth.js';
import { buildSpeciesProfile } from './speciesProfile.js';
import { aiConfig, aiUsage, hasAi } from './aiClient.js';
import { aiCacheStats, loadAiCache } from './aiCache.js';
import { aiProfileContents } from './aiAnnotator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

// 测试通过 TANK_DATA_DIR 注入临时数据目录，避免读写真实缓存；缺省走真实 data/。
const TANK_DATA_DIR = process.env.TANK_DATA_DIR || null;
const dataDirOpts = () => (TANK_DATA_DIR ? { dataDir: TANK_DATA_DIR } : {});

const app = express();
app.use(express.json({ limit: '1mb' }));

const live = () => hasSecret();
// AI 总开关：未配置密钥即关闭；也允许显式关掉（评审演示时可强制走本地可解释路径）。
const aiOn = () => hasAi() && process.env.AI_DISABLED !== '1';

// 启动时恢复磁盘缓存（服务重启不丢已消耗额度换来的数据）
loadEcoCache(dataDirOpts());
// AI 调用缓存同理：容器重建后已花额度买来的模型输出必须还能复用
loadAiCache();

// 放生分析缓存：同一问题+同一草稿 1 小时内复用，防误触重复消耗
const releaseCache = new Map();
const RELEASE_TTL = 60 * 60 * 1000;
// AI 生态解说历史：按知乎授权会话隔离，每日最多重新生成 2 次。
const narrativeHistory = new Map(); // sessionId -> { day, items: [{ data, ts }] }
const NARRATIVE_DAILY_LIMIT = 15;

app.get('/api/status', (req, res) => {
  const cfg = aiConfig();
  res.json({
    liveMode: live(),
    zhidaUsedToday: live() ? zhidaCount() : 0,
    ecoCacheCount: ecoCache.size,
    // AI 可观测性：只暴露模式、模型名与计量，绝不暴露密钥本身
    aiEnabled: aiOn(),
    aiConfigured: cfg.configured,
    aiModels: { fast: cfg.fast, pro: cfg.pro },
    aiUsage: aiUsage(),
    // AI 缓存可观测性：hits 越高说明省下的真实调用越多
    aiCache: aiCacheStats(),
    time: Date.now(),
  });
});

app.get('/api/hot', async (req, res) => {
  if (!live()) return res.json({ ...demoHot, source: 'demo' });
  try {
    const data = await fetchHot(dataDirOpts());
    if (!data.items.length) {
      // 热榜额度耗尽时官方返回空列表：降级为演示热榜并如实告知
      return res.json({ ...demoHot, source: 'demo', warning: '今日热榜额度已耗尽，以下为演示数据（明日 0 点额度重置）' });
    }
    // fetchHot 的兜底链可能返回 source:'snapshot'（真实历史快照）或 'demo'（演示数据），
    // 必须原样透传给前端如实展示，只有链上真实 API/缓存命中才标 'live'。
    res.json({ source: 'live', ...data });
  } catch (e) {
    res.status(502).json({ error: `热榜获取失败：${e.message}`, code: e.code });
  }
});

// 评委入口：列出当前可直接展示的缸（含永久预构建缸），无需任何凭证。
app.get('/api/tanks', (req, res) => {
  res.json(listReadyTanks());
});

// 缓存命中判定与写入抽成一对函数：SSE 与普通接口必须走同一套规则，
// 否则「流式接口跳过缓存」会变成隐性的额度泄漏。
function cachedTank(question, questionUrl) {
  const key = hashKey(question + '|' + questionUrl);
  const hit = ecoCache.get(key);
  if (hit && (hit.prebuilt || Date.now() - hit.ts < ECO_TTL)) {
    // 旧缓存里的物种可能是重构前的全灰标签；只在内存重标，不回写磁盘。
    return { key, data: { ...refreshLocalAnnotations(hit.data), cached: true } };
  }
  return { key, data: null };
}

function storeTank(key, data) {
  if (data.species.length > 0) {
    // 构建成功的缸一律按预构建资产持久化：永久保留、不受 24h TTL 清理，
    // 评委与普通用户随时可复看。数据落在 /opt/opinion-tank-data 数据卷，容器重建不丢。
    ecoCache.set(key, { data, ts: Date.now(), prebuilt: true });
    persistEcoCacheEntry(key, data, dataDirOpts(), { prebuilt: true });
  }
}

app.post('/api/ecosystem', async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 120);
  const questionUrl = String(req.body?.url || '').trim().slice(0, 200);
  if (!question) return res.status(400).json({ error: '请提供问题标题' });

  // 门禁：强制要求知乎账号授权登录，未登录禁止查看任何生态缸（包含预构建缓存）
  if (!oauth.isAuthorized(req, res)) {
    return res.status(401).json({ error: '请先授权登录知乎账号后使用生态缸', code: 'LOGIN_REQUIRED' });
  }

  // 授权通过后优先命中生态缓存，不重复消耗 AI/知乎额度
  const { key, data: hit } = cachedTank(question, questionUrl);
  if (hit) return res.json(hit);

  if (!live()) return res.json(demoEcosystem(question));

  try {
    // dedup：并发同请求只构建一次
    const data = await dedup(`eco:${key}`, () => buildEcosystem(question, questionUrl, { includeAi: aiOn() }));
    storeTank(key, data);
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `生态缸构建失败：${e.message}`, code: e.code });
  }
});

// 流式构建：把「汇聚样本 → AI 逐条识别 → 派系归纳」的全过程实时推给前端。
//
// 为什么用 POST + fetch/ReadableStream 而不是 EventSource：EventSource 只支持 GET，
// 而问题标题可能很长且需要请求体；fetch 读流同样能拿到 SSE 格式的增量。
app.post('/api/ecosystem/stream', async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 120);
  const questionUrl = String(req.body?.url || '').trim().slice(0, 200);
  if (!question) return res.status(400).json({ error: '请提供问题标题' });

  // 门禁：强制要求知乎账号授权登录，未登录禁止查看任何生态缸（包含预构建缓存）
  if (!oauth.isAuthorized(req, res)) {
    return res.status(401).json({ error: '请先授权登录知乎账号后使用生态缸', code: 'LOGIN_REQUIRED' });
  }

  const { key: streamKey, data: streamHit } = cachedTank(question, questionUrl);

  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // 宝塔/Nginx 反代默认会缓冲响应体，缓冲会让所有进度事件攒到结束才一起下发，
    // 前端就完全看不到过程。这个头必须显式带上。
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  const send = (event) => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      closed = true;
    }
  };

  // 客户端断开（用户返回上一页）时中止上游 AI 请求，不再空烧 token
  const ac = new AbortController();
  req.on('aborted', () => {
    if (res.writableEnded) return;
    closed = true;
    ac.abort();
  });
  // req.close 在正常响应完成时也可能触发，不能把它当成客户端取消；
  // 只有响应仍未结束且请求确实被中止时才终止上游 AI。
  req.on('close', () => {
    if (res.writableEnded || !req.aborted) return;
    closed = true;
    ac.abort();
  });

  // 心跳：AI 思考期可能十几秒没有新事件，长时间静默的连接会被反代/浏览器掐断。
  // 以 SSE 注释行发送，不会触发任何事件监听器。
  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      res.write(': keep-alive\n\n');
    } catch {
      closed = true;
    }
  }, 15000);

  try {
    send({ type: 'stage', key: 'start', label: '开始构建生态缸', state: 'start' });
    if (!streamHit && !aiOn()) {
      send({ type: 'error', message: '请先授权登录知乎账号后使用 AI 生态缸', code: 'LOGIN_REQUIRED' });
      return;
    }

    const key = streamKey;
    const hit = streamHit;
    if (hit) {
      send({ type: 'log', text: '命中已就绪的生态缸缓存，不消耗任何接口额度' });
      send({ type: 'stage', key: 'done', label: '来自预构建缓存', state: 'done' });
      send({ type: 'result', data: hit });
      send({ type: 'end' });
      return;
    }

    if (!live()) {
      send({ type: 'log', text: '未配置开放平台凭证，返回演示数据集' });
      send({ type: 'result', data: demoEcosystem(question) });
      send({ type: 'end' });
      return;
    }

    const data = await dedup(`eco:${key}`, () =>
      buildEcosystem(question, questionUrl, {
        onEvent: send,
        signal: ac.signal,
        includeAi: aiOn(),
      }),
    );
    storeTank(key, data);
    send({ type: 'stage', key: 'done', label: '构建完成', state: 'done' });
    send({ type: 'result', data });
    send({ type: 'end' });
  } catch (e) {
    send({ type: 'error', message: e.message, code: e.code });
  } finally {
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {
      /* 连接可能已被客户端关闭 */
    }
  }
});

app.post('/api/ecosystem/narrative', async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 120);
  const species = Array.isArray(req.body?.species) ? req.body.species : [];
  if (!question || !species.length) return res.status(400).json({ error: '需要 question 与 species' });
  if (!aiOn() || !oauth.isAuthorized(req, res)) return res.status(401).json({ error: '请先授权登录知乎账号后使用 AI 解说', code: 'LOGIN_REQUIRED' });
  const sid = oauth.sessionId(req, res);
  const day = new Date().toISOString().slice(0, 10);
  const current = narrativeHistory.get(sid);
  const history = current?.day === day ? current : { day, items: [] };
  if (history.items.length >= NARRATIVE_DAILY_LIMIT) {
    return res.status(429).json({ error: '今日 AI 生态解说重新生成次数已用完（每日 15 次）', code: 'NARRATIVE_DAILY_LIMIT', remaining: 0, history: history.items });
  }
  try {
    const data = await explainEcosystem(question, species, { includeAi: true });
    const item = { ...data, createdAt: Date.now(), version: history.items.length + 1 };
    history.items.push(item);
    narrativeHistory.set(sid, history);
    res.json({ ...item, remaining: NARRATIVE_DAILY_LIMIT - history.items.length, history: history.items });
  } catch (e) {
    res.status(502).json({ error: `AI 解说生成失败：${e.message}`, code: e.code });
  }
});

app.get('/api/ecosystem/narrative/history', (req, res) => {
  noStore(res);
  const sid = oauth.sessionId(req, res);
  const day = new Date().toISOString().slice(0, 10);
  const current = narrativeHistory.get(sid);
  const history = current?.day === day ? current.items : [];
  res.json({ items: history, remaining: Math.max(0, NARRATIVE_DAILY_LIMIT - history.length) });
});

app.post('/api/release', async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 120);
  const draft = String(req.body?.draft || '').trim().slice(0, 4000);
  const species = Array.isArray(req.body?.species) ? req.body.species : [];
  if (!question || !draft) return res.status(400).json({ error: '需要 question 与 draft' });
  if (draft.length < 20) return res.status(400).json({ error: '草稿太短，至少 20 字再放生' });

  const cacheKey = hashKey(question + '|' + draft);
  const hit = releaseCache.get(cacheKey);
  if (hit && Date.now() - hit.ts < RELEASE_TTL) {
    return res.json({ ...hit.report, cached: true });
  }

  if (!live()) {
    // 演示模式：规则模型 + 本地启发式标注（可解释、零消耗）。
    // 草稿的立场/策略必须与 live 路径同源（annotator），否则演示和真实结果会对不上；
    // 只是不调用 AI，aiComment 恒为 null。
    const annotation = annotateOne(question, { excerpt: draft });
    const rule = survivalRule(species, annotation);
    const report = {
      stance: annotation.stance,
      strategy: annotation.strategy,
      summary: '（演示模式：规则模型 + 本地启发式标注结果）',
      survivalProbability: rule.probability,
      ruleProbability: rule.probability,
      aiProbability: null,
      suppressedBy: rule.suppressedBy,
      risks: rule.risks,
      rebuttals: [],
      attractComments: ['（演示数据）这条说到点子上了', '（演示数据）建议补充数据来源'],
      hybridAdvice: rule.advice,
      narrative: rule.narrative,
      aiComment: null,
      aiInsightSource: null,
      analysisSource: 'rule-only-demo',
      simulatedAt: Date.now(),
    };
    releaseCache.set(cacheKey, { report, ts: Date.now() });
    return res.json(report);
  }

  try {
    const report = await dedup(`release:${cacheKey}`, () => analyzeRelease(question, species, draft, { includeAi: aiOn() }));
    releaseCache.set(cacheKey, { report, ts: Date.now() });
    res.json(report);
  } catch (e) {
    res.status(502).json({ error: `放生分析失败：${e.message}`, code: e.code });
  }
});

app.get('/api/quota', async (req, res) => {
  if (!live()) return res.json({ liveMode: false, items: [] });
  try {
    res.json({ liveMode: true, items: await fetchQuota() });
  } catch (e) {
    res.status(502).json({ error: `额度查询失败：${e.message}` });
  }
});

// ---------- 知乎 OAuth + 我的观点画像 ----------
// 协议行为以官方黑客松参考实现（hello-world-oauth）为准，见 src/oauth.js 头部注释。
// app_id 是公开标识可以下发前端；app_key / Access Secret / OAuth token / AI 密钥
// 只存进程内存或服务端环境，任何路由的响应体都不携带它们。
const oauth = createOAuth({
  oauth: {
    appId: process.env.ZHIHU_OAUTH_APP_ID || '',
    // 留空 = 尚未部署登记回调：start 会拒绝跳转，前端按钮置灰「等待部署后开放」，
    // 绝不把 localhost 当成可用回调地址
    redirectUri: (process.env.ZHIHU_OAUTH_REDIRECT_URI || '').trim(),
  },
});

// 画像结果按会话缓存 30 分钟：user_data 额度虽充裕（1000/日）也没理由让评委
// 每点一次就烧一次真实请求；缓存在登出时立即失效。
const profileCache = new Map(); // sessionId → { data, ts }
const PROFILE_TTL = 30 * 60 * 1000;

// OAuth 相关响应一律 no-store：授权态是会话私有的，不能被共享缓存复用
const noStore = (res) => res.set('Cache-Control', 'no-store');

app.get('/api/oauth/status', async (req, res) => {
  noStore(res);
  res.json(await oauth.status(req, res));
});

app.get('/api/oauth/start', async (req, res) => {
  noStore(res);
  try {
    res.redirect(302, await oauth.start(req, res));
  } catch (e) {
    oauth.record(req, res, e);
    // 未配回调是「部署未完成」而非授权失败：返回 409 让前端停在原页并解释原因，
    // 其余错误才按参考实现跳回首页带错误标记
    if (e.code === 'DEPLOYMENT_REQUIRED') {
      return res.status(409).json({ error: e.message, code: e.code });
    }
    res.redirect(302, '/?oauth=err');
  }
});

// 路由陷阱：知乎回调路径不带 /api 前缀，必须注册在 SPA fallback（下面的
// app.get(/^(?!\/api\/).*/)）之前，否则会被 catch-all 吃掉返回 index.html。
app.get('/auth/callback', async (req, res) => {
  noStore(res);
  try {
    await oauth.callback(req, res, new URL(req.originalUrl, `http://${req.headers.host || 'localhost'}`));
    res.redirect(302, '/?oauth=ok');
  } catch (e) {
    oauth.record(req, res, e);
    res.redirect(302, '/?oauth=err');
  }
});

app.post('/api/oauth/logout', (req, res) => {
  noStore(res);
  const sid = oauth.sessionId(req, res);
  oauth.logout(req, res);
  profileCache.delete(sid); // 登出即作废画像缓存，避免下个使用者看到上一个人的结果
  res.json({ ok: true });
});

// 核心功能：「我的观点画像」——读授权用户自己的创作，用同一套立场×策略模型分析他的物种。
// 识别优先交给 DeepSeek（能读懂反讽、拆解这类词典抓不住的表达），失败回退本地标注器。
app.get('/api/profile/species', async (req, res) => {
  noStore(res);
  const sid = oauth.sessionId(req, res);
  const hit = profileCache.get(sid);
  if (hit && Date.now() - hit.ts < PROFILE_TTL) {
    return res.json({ ...hit.data, cached: true });
  }
  try {
    const contents = await oauth.fetchUserContents(req, res);
    let ai = null;
    // 只送前 12 条：更多条目对「画像」没有边际收益，却线性抬高 token 成本与失败面
    if (aiOn() && contents.length) {
      try {
        ai = await aiProfileContents(contents.slice(0, 12));
      } catch {
        // AI 失败不阻断画像：本地标注器给出的分布同样可解释
        ai = null;
      }
    }
    // 空创作（新号/无公开内容）是正常结果不是错误：total: 0 原样下发，前端展示空态
    const data = buildSpeciesProfile(contents, ai);
    profileCache.set(sid, { data, ts: Date.now() });
    res.json(data);
  } catch (e) {
    if (e.code === 'LOGIN_REQUIRED' || e.code === 'TOKEN_EXPIRED') {
      return res.status(401).json({ error: e.message, code: e.code });
    }
    res.status(502).json({ error: `读取知乎创作失败：${e.message}`, code: e.code });
  }
});

// 生产模式：托管前端构建产物（SPA 回退）
const distDir = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, () => {
  const mode = live() ? 'LIVE（知乎开放平台）' : 'DEMO（演示数据）';
  const ai = aiOn() ? `AI：${aiConfig().fast} / ${aiConfig().pro}` : 'AI：关闭（本地可解释标注）';
  console.log(`[观点进化缸] http://localhost:${PORT} · 模式: ${mode} · ${ai}`);
});
