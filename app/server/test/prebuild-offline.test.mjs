import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prebuildFromRaw } from '../scripts/prebuild-tanks.mjs';
import { ecoCache, hashKey, loadEcoCache } from '../src/zhihu.js';

// 与既有测试一致：临时目录隔离，绝不读写真实 data/。
async function makeTempDataDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'super-eco-offline-'));
}

// 任何网络访问都必须立刻爆炸：跑完全程不抛异常，才证明离线模式真的零网络。
const throwingFetch = () => {
  throw new Error('offline mode must not touch network');
};

function rawItem(question, url, answerCount) {
  return {
    question,
    url,
    fetchedAt: Date.now(),
    // excerpt 需要足够长度，模拟真实 question_answers 的摘要形态
    answers: Array.from({ length: answerCount }, (_, i) => ({
      id: `${question}-a${i}`,
      contentType: 'answer',
      url: `${url}/answer/${i}`,
      excerpt: `这是关于「${question}」的第 ${i} 条真实回答样本，内容足够长以便参与本地立场与策略标注流程。`,
    })),
    search: [],
    errors: [],
  };
}

test('offline prebuild turns raw captures into loadable tanks with zero network', async () => {
  const dataDir = await makeTempDataDir();
  const raw = [
    rawItem('离线问题一？', 'https://www.zhihu.com/question/900001', 3),
    rawItem('离线问题二？', 'https://www.zhihu.com/question/900002', 4),
  ];
  const rawFile = path.join(dataDir, 'raw-tanks.json');
  await fs.writeFile(rawFile, JSON.stringify(raw), 'utf8');

  const logs = [];
  const result = await prebuildFromRaw({ rawFile, dataDir, fetchImpl: throwingFetch, log: (m) => logs.push(m) });

  assert.equal(result.saved, 2);
  assert.equal(result.failed, 0);

  const entries = JSON.parse(await fs.readFile(path.join(dataDir, 'prebuilt-tanks.json'), 'utf8'));
  assert.equal(entries.length, 2);

  for (const item of raw) {
    // key 必须与 /api/ecosystem 的算法逐位一致，否则前端点击会 cache miss 再去打 API
    const key = hashKey(`${item.question}|${item.url}`);
    const entry = entries.find((e) => e.k === key);
    assert.ok(entry, `missing prebuilt entry for ${item.question}`);
    // 离线模式没有直答额度，aiNarrative 为 null 是契约而不是失败
    assert.equal(entry.data.aiNarrative, null);
    // 通道 A（question_answers）每个回答恰好产出一个物种
    assert.equal(entry.data.species.length, item.answers.length);
  }

  // 产出必须能被现有 loadEcoCache 直接加载并被 /api/ecosystem 的 key 命中
  ecoCache.clear();
  loadEcoCache({ dataDir });
  for (const item of raw) {
    const key = hashKey(`${item.question}|${item.url}`);
    const hit = ecoCache.get(key);
    assert.ok(hit?.prebuilt, `ecoCache miss for ${item.question}`);
    assert.equal(hit.data.question, item.question);
  }

  assert.ok(logs.some((m) => m.includes('stance=')), 'per-tank distribution log missing');
});

test('offline prebuild reruns overwrite instead of appending', async () => {
  const dataDir = await makeTempDataDir();
  const raw = [rawItem('覆盖问题？', 'https://www.zhihu.com/question/900003', 2)];
  const rawFile = path.join(dataDir, 'raw-tanks.json');
  await fs.writeFile(rawFile, JSON.stringify(raw), 'utf8');

  await prebuildFromRaw({ rawFile, dataDir, fetchImpl: throwingFetch });
  await prebuildFromRaw({ rawFile, dataDir, fetchImpl: throwingFetch });

  const entries = JSON.parse(await fs.readFile(path.join(dataDir, 'prebuilt-tanks.json'), 'utf8'));
  assert.equal(entries.length, 1);
});
