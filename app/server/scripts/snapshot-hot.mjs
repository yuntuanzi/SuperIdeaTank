// 导出热榜快照（data/hot-snapshot.json）作为 fetchHot 降级链的最终真实数据兜底。
// 素材只能来自「已经到手的热榜」：优先读运行时磁盘缓存 hot-cache.json，
// 其次读本机服务的 /api/hot（读本地缓存，不打上游）。
// 绝不直接调用真实 hot_list —— 今日额度只剩 2 次，要留给评审当天的意外。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_LOCAL_API = 'http://localhost:8787/api/hot';

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// 快照只收真实热榜：演示数据是虚构的，存成快照等于把假货标成真货（诚信红线）。
function toSnapshot(items, snapshotAt, sourceDesc) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return { snapshotAt: snapshotAt || Date.now(), sourceDesc, items };
}

export async function snapshotHot({
  dataDir = DATA_DIR,
  localApiUrl = DEFAULT_LOCAL_API,
  fetchImpl = fetch,
  log = () => {},
} = {}) {
  let snapshot = null;

  // 首选：运行时磁盘缓存（完全不经过任何网络，连本机端口都不走）
  const disk = await readJson(path.join(dataDir, 'hot-cache.json'));
  if (disk?.data?.items?.length) {
    snapshot = toSnapshot(disk.data.items, disk.data.fetchedAt || disk.ts, 'hot-cache.json');
    log(`source=hot-cache.json items=${snapshot.items.length}`);
  }

  // 次选：本机运行中服务的 /api/hot（读的是它 12h 内存/磁盘缓存，不消耗上游额度）
  if (!snapshot) {
    const res = await fetchImpl(localApiUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`本机 /api/hot 返回 HTTP ${res.status}`);
    const body = await res.json();
    if (body?.source === 'demo') {
      throw new Error('本机 /api/hot 返回的是演示数据，不能存成快照（虚构 ≠ 真实采集）');
    }
    snapshot = toSnapshot(body?.items, body?.snapshotAt || body?.fetchedAt, `local ${localApiUrl} (source=${body?.source})`);
    if (snapshot) log(`source=${localApiUrl} items=${snapshot.items.length} upstreamSource=${body?.source}`);
  }

  if (!snapshot) throw new Error('没有可用的真实热榜素材（hot-cache.json 与本机 /api/hot 均无数据）');

  const file = path.join(dataDir, 'hot-snapshot.json');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(snapshot, null, 2), 'utf8');
  log(`WROTE ${file} snapshotAt=${new Date(snapshot.snapshotAt).toISOString()}`);
  return { file, ...snapshot };
}

// 与 prebuild-tanks.mjs 相同的 Windows 安全主入口判断
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  snapshotHot({ localApiUrl: process.argv[2] || DEFAULT_LOCAL_API, log: console.log }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
