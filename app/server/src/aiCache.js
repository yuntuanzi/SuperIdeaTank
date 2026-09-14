// DeepSeek 调用缓存层（内容寻址 · 三级去重）
//
// 为什么必须有这一层：一次「打开生态缸」会消耗 3 次真实 AI 调用（逐条识别 + 问题类型 +
// 派系归纳），「放生推演」再 +1 次，「观点画像」再 +1 次。同一个问题被反复点开、
// 同一个放生草稿被反复提交、多标签页同时访问 —— 每一次都在真实扣余额。
// 缓存不是优化项，是成本红线。
//
// 三层防线，从快到慢：
//   1. **内存命中**：同进程内同键直接返回，0 网络 0 token。
//   2. **并发合并（inflight）**：同键请求正在飞行时，后续请求挂到同一个 Promise 上，
//      不重复发。这是双击「创建生态缸」和多标签页同时打开的主要来源。
//   3. **磁盘命中**：容器重启 / 冷启动后仍可复用。Docker 卷 /opt/opinion-tank-data 是持久化的，
//      重建容器不会让已花额度买来的结果作废。
//
// 键的构成：model + temperature + json + maxTokens + 完整 messages。
// 只要提示词或采样参数变化，键就变化 —— 不会出现「改了提示词还在吃旧缓存」的脏读。
// 键里只放请求参数本身，绝不含密钥。
//
// 流式路径的特殊处理：命中缓存时**回放**完整的 reasoning 与 content 给回调，
// 而不是直接返回终值。这样「等待中展示模型思考过程」的交互在命中时依然完整，
// 用户看到的过程一样，只是瞬间完成、不花一分钱。
//
// 开关与容量（均可由环境变量覆盖）：
//   AI_CACHE=0            完全关闭（评审时若要强制观察真实调用耗时可用）
//   AI_CACHE_TTL_MS       条目有效期，默认 7 天
//   AI_CACHE_MAX          最大条目数，默认 400（超出按最久未使用淘汰）

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 400;
// 磁盘写入合并窗口：一次建缸会连打 2–3 次 AI，逐次落盘是无效 IO，攒一下再一次写完
const PERSIST_DEBOUNCE_MS = 1500;

function enabled() {
  return process.env.AI_CACHE !== '0';
}

function ttlMs() {
  const n = Number(process.env.AI_CACHE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function maxEntries() {
  const n = Number(process.env.AI_CACHE_MAX);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_ENTRIES;
}

function cacheFile() {
  // 测试与预构建脚本通过 TANK_DATA_DIR 注入临时目录，绝不能写真实 data/
  const dir = process.env.TANK_DATA_DIR || path.join(__dirname, '..', 'data');
  return path.join(dir, 'ai-cache.json');
}

// ---------- 键 ----------

// 内容寻址：同一请求必然同键，任何参数差异必然异键。
// 数组顺序敏感是有意的 —— messages 的顺序本身就是语义的一部分。
export function aiCacheKey({ model, temperature, json, maxTokens, messages }) {
  const payload = JSON.stringify([model, temperature ?? null, Boolean(json), maxTokens ?? null, messages]);
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

// ---------- 存储 ----------

/** @type {Map<string, { ts: number, text: string, reasoning: string }>} */
const store = new Map();
/** @type {Map<string, Promise<any>>} */
const inflight = new Map();
const stats = { hits: 0, misses: 0, merged: 0, stores: 0 };

let persistTimer = null;
let loaded = false;

function prune() {
  const limit = maxEntries();
  if (store.size <= limit) return;
  // Map 保持插入顺序，最早插入的最先被淘汰；命中时不重排（成本优先于完美 LRU）
  const overflow = store.size - limit;
  let i = 0;
  for (const key of store.keys()) {
    if (i >= overflow) break;
    store.delete(key);
    i += 1;
  }
}

export function loadAiCache() {
  if (loaded) return;
  loaded = true;
  try {
    const file = cacheFile();
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    const ttl = ttlMs();
    for (const entry of parsed) {
      if (!entry?.k || typeof entry.text !== 'string') continue;
      if (now - Number(entry.ts || 0) > ttl) continue;
      store.set(entry.k, { ts: Number(entry.ts) || now, text: entry.text, reasoning: String(entry.reasoning || '') });
    }
  } catch {
    // 缓存文件损坏不是故障：丢弃并以空缓存继续服务
  }
  prune();
}

function persistNow() {
  try {
    const file = cacheFile();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const rows = [...store.entries()].map(([k, v]) => ({ k, ts: v.ts, text: v.text, reasoning: v.reasoning }));
    fs.writeFileSync(file, JSON.stringify(rows), 'utf8');
  } catch {
    // 落盘失败只影响重启后的复用，不能影响本次请求
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistNow();
  }, PERSIST_DEBOUNCE_MS);
  // 定时器不应阻止进程退出
  persistTimer.unref?.();
}

// ---------- 对外读写 ----------

export function aiCacheGet(key) {
  if (!enabled()) return null;
  if (!loaded) loadAiCache();
  const hit = store.get(key);
  if (!hit) {
    stats.misses += 1;
    return null;
  }
  if (Date.now() - hit.ts > ttlMs()) {
    store.delete(key);
    stats.misses += 1;
    return null;
  }
  stats.hits += 1;
  return hit;
}

export function aiCacheSet(key, text, reasoning = '') {
  if (!enabled()) return;
  stats.stores += 1;
  store.set(key, { ts: Date.now(), text, reasoning });
  prune();
  schedulePersist();
}

// 并发合并：同键在飞行中的请求共用一次真实调用。
// 与内存命中的区别在于「结果尚未产生」，所以必须先挂接再发请求。
//
// 返回 { promise, joined }：joined=true 表示本次是挂到别人身上的。调用方需要这个标记
// —— 流式场景下只有发起者能把增量实时推给自己的回调，后来者只能等结果回来后回放，
// 否则两个人的思考过程会串到同一个界面上。
export function aiCacheDedup(key, fn) {
  if (!enabled()) return { promise: Promise.resolve().then(fn), joined: false };
  const existing = inflight.get(key);
  if (existing) {
    stats.merged += 1;
    return { promise: existing, joined: true };
  }
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return { promise: p, joined: false };
}

export function aiCacheStats() {
  if (!loaded) loadAiCache();
  return { ...stats, size: store.size, enabled: enabled(), ttlMs: ttlMs() };
}

export function resetAiCacheStats() {
  stats.hits = 0;
  stats.misses = 0;
  stats.merged = 0;
  stats.stores = 0;
}

// 仅测试使用：清空内存与磁盘缓存
export function clearAiCache() {
  store.clear();
  inflight.clear();
  try {
    const file = cacheFile();
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* 清理失败不影响测试断言 */
  }
}
