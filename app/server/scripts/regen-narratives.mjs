// 全量重生成脚本：对数据卷内所有已构建缸重新调用 DeepSeek 生成 AI 解说，
// 覆盖旧解说（含 aiFactions/aiDominant/来源标注），逐缸落盘，可重复执行。
// 与 backfill-narratives.mjs 的区别：本脚本不跳过已有解说的缸，一律重写。
// 用法：node scripts/regen-narratives.mjs [--file prebuilt-tanks.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { explainEcosystem } from '../src/ecosystem.js';
import { hasAi } from '../src/aiClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const TARGETS = fileFlag !== -1 ? [args[fileFlag + 1]] : ['prebuilt-tanks.json', 'eco-cache.json'];

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
    console.error('AI 未配置（缺少 DEEPSEEK_API_KEY），无法生成解说');
    process.exitCode = 1;
    return;
  }
  const result = { scanned: 0, regenerated: 0, failed: 0, skipped: 0 };
  for (const name of TARGETS) {
    const file = path.join(dataDir, name);
    const entries = await readJsonArray(file);
    if (!entries.length) {
      console.log(`SKIP ${name}: 无条目`);
      continue;
    }
    for (const entry of entries) {
      const data = entry?.data;
      if (!data?.question || !Array.isArray(data?.species) || data.species.length === 0) {
        result.skipped += 1;
        console.log(`SKIP 空缸 ${entry?.k || '?'}`);
        continue;
      }
      result.scanned += 1;
      try {
        const ai = await explainEcosystem(data.question, data.species, {});
        if (ai.aiNarrative || ai.aiFactions) {
          data.aiNarrative = ai.aiNarrative;
          data.aiNarrativeSource = ai.aiNarrativeSource;
          data.aiFactions = ai.aiFactions;
          data.aiDominant = ai.aiDominant;
          data.aiNarrativeError = null;
          result.regenerated += 1;
          console.log(`OK  [${data.aiFactions ? `${data.aiFactions.length}派` : '原文'}] ${data.question.slice(0, 44)}`);
        } else {
          result.failed += 1;
          console.log(`EMPTY ${data.question.slice(0, 44)} :: ${ai.aiNarrativeError || '无输出'}`);
        }
      } catch (e) {
        result.failed += 1;
        console.log(`FAIL ${data.question.slice(0, 44)} :: ${e.message}`);
      }
      // 逐缸落盘：中途停止也能保住已重生成的部分
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
