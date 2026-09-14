// 知乎开放平台 API 客户端
// 鉴权：Authorization: Bearer <Access Secret> + X-Request-Timestamp（秒级）
// 设计要点：统一超时、错误归一化、多级缓存（内存+磁盘）、并发去重、直答调用计数（额度守卫）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { demoHot } from './demoData.js';

const BASE = 'https://developer.zhihu.com';
const TIMEOUT_MS = 20000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function hasSecret() {
  return Boolean(process.env.ZHIHU_ACCESS_SECRET);
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.ZHIHU_ACCESS_SECRET}`,
    'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
  };
}

async function request(url, options = {}, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const err = new Error(body?.Message || body?.error?.message || `HTTP ${res.status}`);
      err.code = body?.Code || body?.error?.code || res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 并发去重与磁盘持久化 ----------

// 同 key 并发请求只发一次（防止双击/前端重试导致额度双倍消耗）
const inflight = new Map();
export function dedup(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// 生态缸缓存磁盘持久化：服务重启不丢已消耗额度换来的数据
const CACHE_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(CACHE_DIR, 'eco-cache.json');
const PREBUILT_FILE = 'prebuilt-tanks.json';
const CACHE_MAX_ENTRIES = 100;

// 测试和预构建脚本必须使用临时目录，路径集中在这里可以避免误写真实 eco-cache。
function cachePaths(dataDir = CACHE_DIR) {
  return {
    cacheDir: dataDir,
    cacheFile: path.join(dataDir, 'eco-cache.json'),
    prebuiltFile: path.join(dataDir, PREBUILT_FILE),
    hotFile: path.join(dataDir, 'hot-cache.json'),
    hotSnapshotFile: path.join(dataDir, 'hot-snapshot.json'),
    searchFile: path.join(dataDir, 'search-cache.json'),
    globalSearchFile: path.join(dataDir, 'global-search-cache.json'),
    qaFile: path.join(dataDir, 'qa-cache.json'),
  };
}

// 缓存文件允许不存在或损坏，启动路径需要优雅降级到空缓存而不是阻断服务。
function readJsonArray(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 对象型缓存文件（热榜、快照）同样允许缺失或损坏，降级为 null 交给后续兜底链。
function readJsonObject(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// search/qa 这类多 key 缓存共用一套落盘格式：[{ k, ts, data }]，按 key 覆盖合并。
// 内存未命中时先查磁盘：Render 免费档 15 分钟休眠一次，评审期反复冷启动，
// 纯内存缓存意味着每个冷启动后的第一个访客都要烧一次真实额度。
function readPersistedEntry(file, key, ttl) {
  const entry = readJsonArray(file).find((e) => e?.k === key);
  if (entry && Date.now() - entry.ts < ttl) return entry;
  return null;
}

function persistMapEntry(file, key, data, maxEntries = 100) {
  try {
    if (!fs.existsSync(path.dirname(file))) fs.mkdirSync(path.dirname(file), { recursive: true });
    const merged = [{ k: key, ts: Date.now(), data }, ...readJsonArray(file).filter((e) => e?.k !== key)];
    fs.writeFileSync(file, JSON.stringify(merged.slice(0, maxEntries)), 'utf8');
  } catch {
    // 磁盘写入失败不影响内存缓存
  }
}

// 缸是否“已就绪”只看本地标注产物（question + 非空 species）；AI 叙事是可选增强，
// 缺失不应让整缸失效——常规缓存的新鲜度由 TTL 负责，预构建缸永久有效。
export function isEcoCacheEntryReady(entry) {
  const data = entry?.data || entry;
  return Boolean(data?.question && Array.isArray(data?.species) && data.species.length > 0);
}

// 前端徽标只需要轻量清单，避免把完整回答和 AI 文本通过列表接口重复传输。
export function listReadyTanks() {
  const seen = new Set();
  const ready = [];
  for (const entry of ecoCache.values()) {
    if (!isEcoCacheEntryReady(entry)) continue;
    const data = entry.data || entry;
    const key = `${data.question}|${data.questionUrl || data.url || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ready.push({
      question: data.question,
      url: data.questionUrl || data.url || '',
      speciesCount: data.species.length,
    });
  }
  return ready;
}

export function loadEcoCache({ dataDir = CACHE_DIR } = {}) {
  try {
    const { cacheFile, prebuiltFile } = cachePaths(dataDir);
    const arr = readJsonArray(cacheFile);
    for (const { k, ts, data } of arr) {
      if (Date.now() - ts < ECO_TTL) ecoCache.set(k, { data, ts });
    }
    // 预构建缸来自赛前额度消耗，价值不应被 24h TTL 清掉；只要内容已就绪就永久恢复到内存缓存。
    for (const { k, ts, data } of readJsonArray(prebuiltFile)) {
      if (isEcoCacheEntryReady(data)) ecoCache.set(k, { data, ts, prebuilt: true });
    }
  } catch {
    // 缓存文件损坏不影响服务
  }
}

export function persistEcoCacheEntry(key, data, { dataDir = CACHE_DIR } = {}) {
  try {
    const { cacheDir, cacheFile } = cachePaths(dataDir);
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const entries = readJsonArray(cacheFile);
    const merged = [{ k: key, ts: Date.now(), data }, ...entries.filter((e) => e.k !== key)];
    // 带 AI 叙事的条目消耗过真实直答额度，裁剪时永远保留在 100 条上限之外；
    // 普通条目仍按 CACHE_MAX_ENTRIES 封顶，防止缓存文件无限膨胀。
    const next = [];
    let plainCount = 0;
    for (const entry of merged) {
      if (entry?.data?.aiNarrative) {
        next.push(entry);
      } else if (plainCount < CACHE_MAX_ENTRIES) {
        next.push(entry);
        plainCount += 1;
      }
    }
    fs.writeFileSync(cacheFile, JSON.stringify(next), 'utf8');
  } catch {
    // 磁盘写入失败不影响内存缓存
  }
}

// ---------- 缓存 ----------

const hotCache = { data: null, ts: 0 };
const HOT_TTL = Number(process.env.HOT_TTL_HOURS || 12) * 60 * 60 * 1000; // 实测热榜额度仅 2 次/日，长缓存

const ecoCache = new Map(); // key: question hash → { data, ts }
const ECO_TTL = 24 * 60 * 60 * 1000; // 24 小时

function hashKey(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return String(h);
}

// ---------- 直答额度守卫（实测该账号仅 2 次/日，env 可调） ----------

const ZHIDA_DAILY_LIMIT = Number(process.env.ZHIDA_DAILY_LIMIT || 2);
const zhidaUsage = { date: new Date().toISOString().slice(0, 10), count: 0 };
export function zhidaCount() {
  const today = new Date().toISOString().slice(0, 10);
  if (zhidaUsage.date !== today) {
    zhidaUsage.date = today;
    zhidaUsage.count = 0;
  }
  return zhidaUsage.count;
}

const quotaCache = { remaining: null, ts: 0 };
async function zhidaRemaining(force = false, { fetchImpl } = {}) {
  const canUseCache = !fetchImpl;
  if (canUseCache && !force && quotaCache.remaining !== null && Date.now() - quotaCache.ts < 60 * 1000) {
    return quotaCache.remaining;
  }
  try {
    const body = await request(`${BASE}/api/v1/quota?APIIDs=zhida_openai`, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    }, { fetchImpl });
    const item = (body?.Data || []).find((d) => d.APIID === 'zhida_openai');
    const remaining = item ? Number(item.RemainingQuota) : null;
    if (canUseCache) {
      quotaCache.remaining = remaining;
      quotaCache.ts = Date.now();
    }
    return remaining;
  } catch {
    return null; // 查询失败不阻断，交给本地计数兜底
  }
}

// ---------- 业务调用 ----------

export async function fetchHot({ dataDir = CACHE_DIR, fetchImpl } = {}) {
  return dedup('hot', async () => {
    const { hotFile, hotSnapshotFile } = cachePaths(dataDir);
    // 降级链：内存 → 磁盘 → 真实 API → 快照 → 演示数据。
    // 评审窗口我们不在场，热榜额度只有 2 次/日，链上每一环都在为下一环省额度。

    // 1) 内存缓存（同一进程内 12h 新鲜）
    if (hotCache.data && Date.now() - hotCache.ts < HOT_TTL) {
      return { ...hotCache.data, cached: true };
    }
    // 2) 磁盘缓存：服务冷启动后内存必空，磁盘是保卫热榜额度的第二道防线
    const disk = readJsonObject(hotFile);
    if (disk?.data?.items?.length && Date.now() - disk.ts < HOT_TTL) {
      hotCache.data = disk.data;
      hotCache.ts = disk.ts;
      return { ...disk.data, cached: true };
    }
    // 3) 真实 API（只有前两环都 miss 才轮到它烧额度）
    try {
      const body = await request(`${BASE}/api/v1/content/hot_list?Limit=30`, {
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      }, { fetchImpl });
      const items = (body?.Data?.Items || []).map((it) => ({
        title: it.Title,
        url: it.Url,
        summary: it.Summary || '',
        thumbnail: it.ThumbnailUrl || '',
      }));
      // 额度耗尽时官方返回空列表而非报错；空列表没有展示价值，
      // 必须当作失败继续走兜底链，更不能拿它覆盖掉磁盘上的真实缓存。
      if (!items.length) throw new Error('热榜返回空列表（额度可能已耗尽）');
      const data = { items, fetchedAt: Date.now() };
      hotCache.data = data;
      hotCache.ts = Date.now();
      persistHotCache(hotFile, data);
      return { ...data, cached: false };
    } catch (e) {
      // stale-while-error：过期的真实热榜仍然优于快照和演示数据
      if (hotCache.data) return { ...hotCache.data, cached: true, stale: true, warning: e.message };
      if (disk?.data?.items?.length) return { ...disk.data, cached: true, stale: true, warning: e.message };
      // 4) 快照：赛前真实采集的历史热榜，必须如实标注来源与采集时间——
      // 真实历史快照 ≠ 虚构演示数据，混为一谈就是欺骗评委。
      const snapshot = readJsonObject(hotSnapshotFile);
      if (snapshot?.items?.length) {
        return {
          items: snapshot.items,
          fetchedAt: snapshot.snapshotAt,
          source: 'snapshot',
          snapshotAt: snapshot.snapshotAt,
          cached: true,
          warning: e.message,
        };
      }
      // 5) 最后的兜底才是虚构演示数据（前端有醒目标识）
      return { ...demoHot, warning: e.message };
    }
  });
}

// 热榜缓存落盘：与 eco-cache 同机制，fetchHot 成功后写盘，冷启动后从磁盘恢复。
function persistHotCache(hotFile, data) {
  try {
    if (!fs.existsSync(path.dirname(hotFile))) fs.mkdirSync(path.dirname(hotFile), { recursive: true });
    fs.writeFileSync(hotFile, JSON.stringify({ ts: Date.now(), data }), 'utf8');
  } catch {
    // 磁盘写入失败不影响内存缓存
  }
}

// 按问题 URL 拉取该问题下的回答列表（2026-09-13 实测发现的隐藏端点，不在官方文档中）
// 字段：ContentType / ContentToken / Url / Summary；分页 {IsEnd, NextOffset}
const qaCache = new Map(); // key: questionUrl|offset|limit → { data, ts }
const QA_TTL = 6 * 60 * 60 * 1000; // 6 小时

export async function fetchQuestionAnswers(questionUrl, offset = 0, limit = 10, { dataDir = CACHE_DIR, fetchImpl } = {}) {
  const key = `qa:${questionUrl}|${offset}|${limit}`;
  const hit = qaCache.get(key);
  if (hit && Date.now() - hit.ts < QA_TTL) return hit.data;
  // 内存 miss 时先查磁盘：冷启动不该让同一问题的回答列表再烧一次额度
  const persisted = readPersistedEntry(cachePaths(dataDir).qaFile, key, QA_TTL);
  if (persisted) {
    qaCache.set(key, { data: persisted.data, ts: persisted.ts });
    return persisted.data;
  }
  const data = await dedup(key, async () => {
    const url = `${BASE}/api/v1/content/question_answers?QuestionUrl=${encodeURIComponent(questionUrl)}&Offset=${offset}&Limit=${limit}`;
    const body = await request(url, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    }, { fetchImpl });
    return {
      items: (body?.Data?.Items || []).map((it) => ({
        id: String(it.ContentToken),
        contentType: it.ContentType,
        url: it.Url,
        excerpt: (it.Summary || '').replace(/<[^>]+>/g, '').trim(),
      })),
      paging: body?.Data?.Paging || null,
    };
  });
  qaCache.set(key, { data, ts: Date.now() });
  persistMapEntry(cachePaths(dataDir).qaFile, key, data);
  return data;
}

// 全网搜索 / 知乎搜索共用同一套解析（两者返回字段完全一致）。
// 与 zhihu_search 的关键差异：global_search 的结果 Url 带 question/<qid>，
// 因此可以按问题 ID 精确过滤出「同题回答」并取得其真实赞同数，
// 这正是 question_answers（不返回 VoteUpCount）所缺的那一半数据。
function mapSearchItems(items) {
  return (items || []).map((it) => ({
    id: it.ContentID,
    title: it.Title,
    contentType: it.ContentType,
    excerpt: (it.ContentText || '').replace(/<[^>]+>/g, '').trim(),
    url: it.Url,
    votes: it.VoteUpCount ?? 0,
    comments: it.CommentCount ?? 0,
    author: it.AuthorName || '知乎用户',
    avatar: it.AuthorAvatar || '',
    badgeText: it.AuthorBadgeText || '',
    authority: Number(it.AuthorityLevel) || 1,
    editTime: Number(it.EditTime) || 0,
    featuredComments: (it.CommentInfoList || []).map((c) => c.Content).filter(Boolean),
  }));
}

const searchCache = new Map(); // key: query → { data, ts }
const SEARCH_TTL = 6 * 60 * 60 * 1000; // 6 小时，保护 10 次/日额度

export async function searchZhihu(query, count = 10, { dataDir = CACHE_DIR, fetchImpl } = {}) {
  const key = `search:${query}`;
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.ts < SEARCH_TTL) return hit.data;
  // 内存 miss 时先查磁盘，理由同 qa 缓存：搜索结果是用 10 次/日额度换来的
  const persisted = readPersistedEntry(cachePaths(dataDir).searchFile, key, SEARCH_TTL);
  if (persisted) {
    searchCache.set(key, { data: persisted.data, ts: persisted.ts });
    return persisted.data;
  }
  const data = await dedup(key, async () => {
    const url = `${BASE}/api/v1/content/zhihu_search?Query=${encodeURIComponent(query)}&Count=${count}`;
    const body = await request(url, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    }, { fetchImpl });
    return mapSearchItems(body?.Data?.Items);
  });
  searchCache.set(key, { data, ts: Date.now() });
  persistMapEntry(cachePaths(dataDir).searchFile, key, data);
  return data;
}

// 全网搜索：字段与 zhihu_search 一致，但结果带 question/<qid>，
// 是唯一能「既绑定到具体问题、又提供真实赞同数」的端点。
// 额度与 zhihu_search 独立（各 10 次/日），缓存策略保持一致。
const globalSearchCache = new Map();
const GLOBAL_SEARCH_TTL = 6 * 60 * 60 * 1000;

export async function globalSearch(query, count = 20, { dataDir = CACHE_DIR, fetchImpl } = {}) {
  const key = `gsearch:${query}|${count}`;
  const hit = globalSearchCache.get(key);
  if (hit && Date.now() - hit.ts < GLOBAL_SEARCH_TTL) return hit.data;
  const persisted = readPersistedEntry(cachePaths(dataDir).globalSearchFile, key, GLOBAL_SEARCH_TTL);
  if (persisted) {
    globalSearchCache.set(key, { data: persisted.data, ts: persisted.ts });
    return persisted.data;
  }
  const data = await dedup(key, async () => {
    const url = `${BASE}/api/v1/content/global_search?Query=${encodeURIComponent(query)}&Count=${count}`;
    const body = await request(url, {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    }, { fetchImpl });
    return mapSearchItems(body?.Data?.Items);
  });
  globalSearchCache.set(key, { data, ts: Date.now() });
  persistMapEntry(cachePaths(dataDir).globalSearchFile, key, data);
  return data;
}

// ⚠️ 已弃用（2026-09-15）：全项目不再调用知乎直答。
// 直答是检索问答产品而非指令执行器，无法承担标注职能（见 docs/DEVELOPMENT.md 0.5 节），
// AI 能力已整体迁至 DeepSeek（src/aiClient.js + src/aiAnnotator.js）。
// 此函数与下面的额度守卫保留，仅用于留存「双层额度守卫」的历史实现与覆盖它的回归测试，
// 请勿在新代码中调用。删除它需要同时删除 test/zhida.test.mjs 的对应用例。
export async function zhidaChat(model, messages, { timeoutMs = 60000, fetchImpl } = {}) {
  if (!hasSecret()) throw Object.assign(new Error('未配置 Access Secret'), { code: 'NO_SECRET' });
  if (zhidaCount() >= ZHIDA_DAILY_LIMIT) {
    throw Object.assign(new Error('今日直答额度已用尽（本地守卫）'), { code: 'QUOTA_GUARD' });
  }
  const remaining = await zhidaRemaining(false, { fetchImpl });
  if (remaining !== null && remaining <= 0) {
    throw Object.assign(new Error('今日直答额度已用尽（服务端确认）'), { code: 'QUOTA_GUARD' });
  }
  zhidaUsage.count += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // 直答额度今日已耗尽，调用点必须能注入 fake HTTP；这样测试能覆盖真实协议而不会误烧线上额度。
    const res = await (fetchImpl || fetch)(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ model, messages, stream: false }),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`直答返回非 JSON（HTTP ${res.status}）`);
    }
    if (body?.error) {
      throw Object.assign(new Error(body.error.message || '直答调用失败'), { code: body.error.code });
    }
    const content = body?.choices?.[0]?.message?.content;
    if (!content) throw new Error('直答返回缺少 content');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchQuota({ fetchImpl } = {}) {
  const body = await request(`${BASE}/api/v1/quota`, {
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
  }, { fetchImpl });
  return body?.Data || [];
}

export { hashKey, ecoCache, ECO_TTL };
