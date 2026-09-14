import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildEcosystem } from '../src/ecosystem.js';
import { fetchQuota, hashKey, isEcoCacheEntryReady } from '../src/zhihu.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data');

// 串行预构建要给上游额度系统留缓冲，避免连续请求被误判为突发流量。
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 预构建资产可能尚未生成，缺文件时返回空数组能让脚本从空状态安全启动。
async function readJsonArray(file, fallback = []) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function ensureQuestionFile(file) {
  try {
    await fs.access(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    // 问题清单缺失时只创建空数组模板，避免脚本第一次运行因为目录资产未准备而失败。
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '[]', 'utf8');
  }
}

// quota 返回是按 APIID 平铺的数组，集中解析可以让“不足哪个额度”报告更明确。
function remainingOf(quotaItems, apiId) {
  const item = quotaItems.find((quota) => quota?.APIID === apiId);
  const remaining = Number(item?.RemainingQuota);
  return Number.isFinite(remaining) ? remaining : null;
}

// QA/search 是构建必需额度，直答只影响 AI 解说，因此两类额度要分开决策。
function quotaDecision(quotaItems) {
  const qa = remainingOf(quotaItems, 'question_answers');
  const search = remainingOf(quotaItems, 'zhihu_search');
  const zhida = remainingOf(quotaItems, 'zhida_openai');
  if (qa !== null && qa <= 0) return { ok: false, includeAi: false, apiId: 'question_answers' };
  if (search !== null && search <= 0) return { ok: false, includeAi: false, apiId: 'zhihu_search' };
  return { ok: true, includeAi: zhida === null || zhida > 0, apiId: null };
}

// 预构建日志要让人工快速判断缸是否退化，分布摘要比完整物种列表更适合终端输出。
function distributions(species, field) {
  const counts = {};
  for (const item of species || []) counts[item[field]] = (counts[item[field]] || 0) + 1;
  return counts;
}

async function savePrebuiltEntry(file, entry) {
  const entries = await readJsonArray(file);
  const next = [entry, ...entries.filter((item) => item.k !== entry.k)];
  // 每个成功缸立刻落盘，脚本中途停止时也能保住已经消耗额度换来的成果。
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
}

export async function prebuildTanks({
  dataDir = DEFAULT_DATA_DIR,
  sleepMs = 2000,
  fetchImpl,
  fetchQuotaImpl = (options = {}) => fetchQuota({ ...options, fetchImpl }),
  buildEcosystemImpl = buildEcosystem,
  log = () => {},
} = {}) {
  const questionsFile = path.join(dataDir, 'prebuilt-questions.json');
  const tanksFile = path.join(dataDir, 'prebuilt-tanks.json');
  await ensureQuestionFile(questionsFile);
  const questions = await readJsonArray(questionsFile);
  const existing = await readJsonArray(tanksFile);
  const readyKeys = new Set(existing.filter((entry) => isEcoCacheEntryReady(entry)).map((entry) => entry.k));

  const result = { total: questions.length, saved: 0, skippedCached: 0, stoppedReason: null, message: '' };
  for (const item of questions) {
    const question = String(item?.question || '').trim();
    const url = String(item?.url || '').trim();
    if (!question) continue;
    const key = hashKey(`${question}|${url}`);
    if (readyKeys.has(key)) {
      result.skippedCached += 1;
      log(`SKIP cached ${question}`);
      continue;
    }

    const quotaItems = await fetchQuotaImpl({ fetchImpl });
    const decision = quotaDecision(quotaItems || []);
    if (!decision.ok) {
      result.stoppedReason = 'quota_insufficient';
      result.message = `quota insufficient: ${decision.apiId}`;
      log(result.message);
      break;
    }

    const data = await buildEcosystemImpl(question, url, { fetchImpl, includeAi: decision.includeAi });
    await savePrebuiltEntry(tanksFile, { k: key, ts: Date.now(), data });
    readyKeys.add(key);
    result.saved += 1;
    log(
      [
        `SAVE ${question}`,
        `species=${data?.species?.length || 0}`,
        `stance=${JSON.stringify(distributions(data?.species, 'stance'))}`,
        `strategy=${JSON.stringify(distributions(data?.species, 'strategy'))}`,
        `aiNarrative=${Boolean(data?.aiNarrative)}`,
      ].join(' '),
    );
    if (sleepMs > 0) await sleep(sleepMs);
  }

  if (!result.message) result.message = 'prebuild complete';
  return result;
}

// ---------- 离线模式：--from-raw ----------

// 离线替身必须严格照 searchZhihu / fetchQuestionAnswers / globalSearch 的既有返回形状喂数据：
// 复用 buildEcosystem 已验证的注入点，是为了让离线缸与在线缸走完全相同的
// 标注与组装管线，避免“另起炉灶”导致两种构建路径行为分叉。
//
// rawItem.global 是 global_search 的原始抓取（可选）。它决定离线缸能否拿到真实赞同数：
// mergeSameQuestion 会把 answers（成规模、无赞同数）与 global（少量、带 VoteUpCount）
// 合并成一个更大的物种池。缺这个字段时全部物种 votes=null，能量只能按热序近似 ——
// 这不是失败，但要如实知道拿到了多少条真实数据。
function rawSubstitutes(rawItem) {
  const all = Array.isArray(rawItem?.answers) ? rawItem.answers : [];
  const answers = async (questionUrl, offset = 0, limit = 10) => ({
    items: all.slice(offset, offset + limit),
    paging: { IsEnd: offset + limit >= all.length, NextOffset: offset + limit },
  });
  const search = async () => (Array.isArray(rawItem?.search) ? rawItem.search : []);
  // 与 globalSearch 的返回形状保持一致（已映射的条目数组，不是原始 API 包体）
  const global = async () => (Array.isArray(rawItem?.global) ? rawItem.global : []);
  return { search, answers, global };
}

// 某一立场/策略占比 ≥80% 说明标注可能退化回全灰，必须显眼警告而不是悄悄通过。
const DEGENERATION_RATIO = 0.8;

function degenerationWarnings(species) {
  const total = species?.length || 0;
  const warnings = [];
  if (!total) return warnings;
  for (const field of ['stance', 'strategy']) {
    const dist = distributions(species, field);
    for (const [label, count] of Object.entries(dist)) {
      if (count / total >= DEGENERATION_RATIO) {
        warnings.push(`${field} 退化：「${label}」占 ${count}/${total}（≥80%）`);
      }
    }
  }
  return warnings;
}

// 离线预构建：data/raw-tanks.json 是赛前抢在额度过期前抓的真实素材，
// 全程零网络（不查 quota、不调直答/搜索），aiNarrative 恒为 null ——
// 这不是失败，本地标注已能撑起整个缸，AI 解说留待额度重置后单独补。
export async function prebuildFromRaw({
  rawFile,
  dataDir = DEFAULT_DATA_DIR,
  buildEcosystemImpl = buildEcosystem,
  fetchImpl, // 仅用于测试注入会抛异常的 fetch 替身来自证零网络；正常离线流程不触网
  log = () => {},
} = {}) {
  const raw = JSON.parse(await fs.readFile(rawFile, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`raw 文件必须是数组：${rawFile}`);
  const tanksFile = path.join(dataDir, 'prebuilt-tanks.json');

  const entries = [];
  const result = { total: raw.length, saved: 0, failed: 0, warnings: [], message: '' };
  for (const item of raw) {
    const question = String(item?.question || '').trim();
    const url = String(item?.url || '').trim();
    if (!question) {
      result.failed += 1;
      continue;
    }
    // key 算法与 /api/ecosystem 完全一致（hashKey(question + '|' + url)），
    // 错了前端会 cache miss 再去打 API，离线预构建就白做了。
    const key = hashKey(`${question}|${url}`);
    try {
      const { search, answers, global } = rawSubstitutes(item);
      const data = await buildEcosystemImpl(question, url, { search, answers, global, includeAi: false, fetchImpl });
      entries.push({ k: key, ts: Date.now(), data });
      result.saved += 1;
      const species = data?.species || [];
      const enriched = species.filter((s) => s?.enriched).length;
      log(
        [
          `SAVE ${question}`,
          `species=${species.length}`,
          `stance=${JSON.stringify(distributions(species, 'stance'))}`,
          `strategy=${JSON.stringify(distributions(species, 'strategy'))}`,
          `enriched=${enriched}/${species.length}`,
          `aiNarrative=${Boolean(data?.aiNarrative)}`,
        ].join(' '),
      );
      for (const warning of degenerationWarnings(species)) {
        result.warnings.push(`${question} :: ${warning}`);
        log(`⚠️ 警告 ${question} :: ${warning}`);
      }
    } catch (error) {
      // 单缸失败不拖垮整批：素材是花额度抓的，能救几个缸是几个。
      result.failed += 1;
      log(`FAIL ${question} :: ${error instanceof Error ? error.message : error}`);
    }
  }

  // 整文件覆盖写（而非逐条合并）：raw 是离线缸的唯一事实来源，
  // 重跑必须得到完全相同的结果，不追加、不残留上一轮的旧条目。
  await fs.mkdir(path.dirname(tanksFile), { recursive: true });
  await fs.writeFile(tanksFile, JSON.stringify(entries, null, 2), 'utf8');

  result.message = `offline prebuild complete: saved=${result.saved} failed=${result.failed}`;
  return result;
}

// 判断当前进程是否为主入口。旧写法 `file://${process.argv[1]}` 在 Windows 上
// 永远不匹配（盘符+反斜杠），导致 CLI 入口形同虚设；用 pathToFileURL 归一化才可靠。
function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(path.resolve(argv1)).href;
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  const fromRawAt = args.indexOf('--from-raw');
  const run = fromRawAt !== -1
    ? prebuildFromRaw({ rawFile: path.resolve(args[fromRawAt + 1]), log: console.log })
    : prebuildTanks({ log: console.log });
  run.then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
