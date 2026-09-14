// 一次性补齐脚本：为已构建但缺 AI 解说的缸重新生成解说并写回缓存文件。
// 读取 dataDir 下 prebuilt-tanks.json 与 eco-cache.json，对 aiNarrative 为空的
// 条目调用 explainEcosystem（走 DeepSeek），成功后立即落盘，中途失败可重跑续补。
// 用法：node scripts/backfill-narratives.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { buildEcosystem, explainEcosystem } from '../src/ecosystem.js';
import { hashKey, loadEcoCache, ecoCache } from '../src/zhihu.js';
import { hasAi } from '../src/aiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const FILES = ['prebuilt-tanks.json', 'eco-cache.json'];

async function readJsonArray(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function main() {
  if (!hasAi()) {
    console.error('AI 未配置（缺少 DEEPSEEK_API_KEY），无法补齐解说');
    process.exitCode = 1;
    return;
  }
  const result = { scanned: 0, backfilled: 0, already: 0, failed: 0, empty: 0 };
  for (const name of FILES) {
    const file = path.join(dataDir, name);
    const entries = await readJsonArray(file);
    for (const entry of entries) {
      const data = entry?.data;
      if (!data?.question || !Array.isArray(data?.species) || data.species.length === 0) {
        result.empty += 1;
        continue;
      }
      result.scanned += 1;
      if (data.aiNarrative || data.aiFactions) {
        result.already += 1;
        continue;
      }
      try {
        const ai = await explainEcosystem(data.question, data.species, {});
        if (ai.aiNarrative || ai.aiFactions) {
          data.aiNarrative = ai.aiNarrative;
          data.aiNarrativeSource = ai.aiNarrativeSource;
          data.aiFactions = ai.aiFactions;
          data.aiDominant = ai.aiDominant;
          data.aiNarrativeError = null;
          result.backfilled += 1;
          console.log(`OK  ${data.question.slice(0, 40)}`);
        } else {
          result.failed += 1;
          console.log(`EMPTY ${data.question.slice(0, 40)} :: ${ai.aiNarrativeError || '无输出'}`);
        }
      } catch (e) {
        result.failed += 1;
        console.log(`FAIL ${data.question.slice(0, 40)} :: ${e.message}`);
      }
      // 每缸立即落盘，脚本中途停止也能保住已完成的部分
      await fs.writeFile(file, JSON.stringify(entries), 'utf8');
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

function isMainModule() {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return import.meta.url === pathToFileURL(path.resolve(argv1)).href;
}

if (isMainModule()) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
