// 晋升 + 补齐脚本：
// 1) 把 eco-cache.json 中所有"已就绪"的缸晋升进 prebuilt-tanks.json（永久资产，重启必加载，不受 24h TTL 限制）
// 2) 对 prebuilt-tanks.json 中缺 AI 解说的缸重新调用 DeepSeek 补齐，逐缸落盘
// 用法：node scripts/promote-and-regen.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainEcosystem } from '../src/ecosystem.js';
import { hasAi } from '../src/aiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const prebuiltFile = path.join(dataDir, 'prebuilt-tanks.json');
const ecoFile = path.join(dataDir, 'eco-cache.json');

async function readJsonArray(file) {
  try {
    const arr = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function isReady(data) {
  return Boolean(data?.question && Array.isArray(data?.species) && data.species.length > 0);
}

async function main() {
  if (!hasAi()) {
    console.error('AI 未配置（缺少 DEEPSEEK_API_KEY），无法补齐解说');
    process.exitCode = 1;
    return;
  }
  const prebuilt = await readJsonArray(prebuiltFile);
  const eco = await readJsonArray(ecoFile);
  const byKey = new Map(prebuilt.filter((e) => e?.k).map((e) => [e.k, e]));

  // 第一步：晋升（同 key 以预构建版本为准）
  let promoted = 0;
  let promotedMissingNarrative = 0;
  for (const entry of eco) {
    if (!entry?.k || !isReady(entry?.data)) continue;
    if (byKey.has(entry.k)) continue;
    byKey.set(entry.k, entry);
    prebuilt.push(entry);
    promoted += 1;
    if (!entry.data.aiNarrative) promotedMissingNarrative += 1;
    console.log(`PROMOTE ${entry.data.question.slice(0, 40)}`);
  }
  if (promoted) await fs.writeFile(prebuiltFile, JSON.stringify(prebuilt), 'utf8');
  console.log(`晋升完成：+${promoted} 条（其中 ${promotedMissingNarrative} 条缺解说）`);

  // 第二步：对缺解说的缸补齐（已有解说的不动）
  let regen = 0;
  let failed = 0;
  for (const entry of prebuilt) {
    const d = entry?.data;
    if (!isReady(d)) continue;
    if (d.aiNarrative && Array.isArray(d.aiFactions) && d.aiFactions.length) continue;
    try {
      const ai = await explainEcosystem(d.question, d.species, {});
      if (ai.aiNarrative || ai.aiFactions) {
        d.aiNarrative = ai.aiNarrative;
        d.aiNarrativeSource = ai.aiNarrativeSource;
        d.aiFactions = ai.aiFactions;
        d.aiDominant = ai.aiDominant;
        d.aiNarrativeError = null;
        regen += 1;
        console.log(`OK  [${d.aiFactions ? `${d.aiFactions.length}派` : '原文'}] ${d.question.slice(0, 40)}`);
      } else {
        failed += 1;
        console.log(`EMPTY ${d.question.slice(0, 40)} :: ${ai.aiNarrativeError || '无输出'}`);
      }
    } catch (e) {
      failed += 1;
      console.log(`FAIL ${d.question.slice(0, 40)} :: ${e.message}`);
    }
    // 逐缸落盘，中途失败不丢已完成部分
    await fs.writeFile(prebuiltFile, JSON.stringify(prebuilt), 'utf8');
  }
  console.log(JSON.stringify({ promoted, regen, failed, prebuiltTotal: prebuilt.length }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
