import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ecoCache, hashKey, isEcoCacheEntryReady, listReadyTanks, loadEcoCache, persistEcoCacheEntry } from '../src/zhihu.js';
import { prebuildTanks } from '../scripts/prebuild-tanks.mjs';

// 每个用例独立临时目录，保证测试不会读写真实缓存或其他支线的未跟踪数据。
async function makeTempDataDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'super-eco-prebuild-'));
}

// 缸 fixture 保留 ready 判定所需字段，让测试聚焦缓存语义而非生态构建细节。
function tank(question, url, aiNarrative = 'AI narrative') {
  return {
    question,
    questionUrl: url,
    species: [{ id: 's1', stance: '支持', strategy: '数据论证' }],
    aiNarrative,
  };
}

function tankWithoutAi(question, url) {
  return {
    question,
    questionUrl: url,
    species: [{ id: 's1', stance: '中立', strategy: '数据论证' }],
    aiNarrative: null,
  };
}

test('loadEcoCache loads fresh eco cache and permanent prebuilt tanks from injected dataDir', async () => {
  const dataDir = await makeTempDataDir();
  const liveKey = 'live-key';
  const prebuiltKey = 'prebuilt-key';
  await fs.writeFile(
    path.join(dataDir, 'eco-cache.json'),
    JSON.stringify([{ k: liveKey, ts: Date.now(), data: tank('live question', 'https://www.zhihu.com/question/1') }]),
    'utf8',
  );
  await fs.writeFile(
    path.join(dataDir, 'prebuilt-tanks.json'),
    JSON.stringify([{ k: prebuiltKey, ts: 1, data: tank('old prebuilt', 'https://www.zhihu.com/question/2') }]),
    'utf8',
  );

  ecoCache.clear();
  loadEcoCache({ dataDir });

  assert.equal(ecoCache.get(liveKey)?.data.question, 'live question');
  assert.equal(ecoCache.get(prebuiltKey)?.data.question, 'old prebuilt');
  assert.equal(isEcoCacheEntryReady(ecoCache.get(prebuiltKey)), true);
  // ready 列表服务的是“当前可直接展示的缸”，prebuilt 负责跨 TTL 恢复，live ready cache 也应自然可见。
  assert.deepEqual(listReadyTanks(), [
    { question: 'live question', url: 'https://www.zhihu.com/question/1', speciesCount: 1 },
    { question: 'old prebuilt', url: 'https://www.zhihu.com/question/2', speciesCount: 1 },
  ]);
});

test('prebuilt tanks are ready forever even when AI narrative is absent', async () => {
  const dataDir = await makeTempDataDir();
  const prebuiltKey = 'prebuilt-no-ai';
  await fs.writeFile(
    path.join(dataDir, 'prebuilt-tanks.json'),
    JSON.stringify([{ k: prebuiltKey, ts: 1, data: tankWithoutAi('no ai prebuilt', 'https://www.zhihu.com/question/20') }]),
    'utf8',
  );

  ecoCache.clear();
  loadEcoCache({ dataDir });

  assert.equal(ecoCache.get(prebuiltKey)?.data.question, 'no ai prebuilt');
  assert.equal(isEcoCacheEntryReady(ecoCache.get(prebuiltKey)), true);
  assert.deepEqual(listReadyTanks(), [{ question: 'no ai prebuilt', url: 'https://www.zhihu.com/question/20', speciesCount: 1 }]);
});

test('fresh regular cache without AI narrative is ready until TTL expires', async () => {
  const dataDir = await makeTempDataDir();
  const freshKey = 'fresh-no-ai';
  await fs.writeFile(
    path.join(dataDir, 'eco-cache.json'),
    JSON.stringify([{ k: freshKey, ts: Date.now(), data: tankWithoutAi('fresh no ai', 'https://www.zhihu.com/question/21') }]),
    'utf8',
  );

  ecoCache.clear();
  loadEcoCache({ dataDir });

  assert.equal(isEcoCacheEntryReady(ecoCache.get(freshKey)), true);
  assert.deepEqual(listReadyTanks(), [{ question: 'fresh no ai', url: 'https://www.zhihu.com/question/21', speciesCount: 1 }]);
});

test('regular cache entries with AI narrative are preserved outside the 100 item trim', async () => {
  const dataDir = await makeTempDataDir();
  const narrativeKey = 'old-narrative';
  const oldEntries = [
    { k: narrativeKey, ts: 1, data: tank('old narrative', 'https://www.zhihu.com/question/22') },
    ...Array.from({ length: 100 }, (_, index) => ({
      k: `old-${index}`,
      ts: Date.now() - index,
      data: tankWithoutAi(`old ${index}`, `https://www.zhihu.com/question/${1000 + index}`),
    })),
  ];
  await fs.writeFile(path.join(dataDir, 'eco-cache.json'), JSON.stringify(oldEntries), 'utf8');

  persistEcoCacheEntry('new-key', tankWithoutAi('newest', 'https://www.zhihu.com/question/23'), { dataDir });

  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'eco-cache.json'), 'utf8'));
  assert.ok(saved.some((entry) => entry.k === narrativeKey));
  assert.ok(saved.length > 100);
});

test('persistEcoCacheEntry can write to an injected dataDir without touching real cache files', async () => {
  const dataDir = await makeTempDataDir();
  const key = hashKey('persisted|https://www.zhihu.com/question/3');

  persistEcoCacheEntry(key, tank('persisted', 'https://www.zhihu.com/question/3'), { dataDir });

  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'eco-cache.json'), 'utf8'));
  assert.equal(saved[0].k, key);
  assert.equal(saved[0].data.question, 'persisted');
});

test('prebuildTanks checks quota before each uncached tank and stops when quota is insufficient', async () => {
  const dataDir = await makeTempDataDir();
  await fs.writeFile(
    path.join(dataDir, 'prebuilt-questions.json'),
    JSON.stringify([
      { question: 'cached', url: 'https://www.zhihu.com/question/10' },
      { question: 'new one', url: 'https://www.zhihu.com/question/11' },
      { question: 'new two', url: 'https://www.zhihu.com/question/12' },
    ]),
    'utf8',
  );
  const cachedKey = hashKey('cached|https://www.zhihu.com/question/10');
  await fs.writeFile(
    path.join(dataDir, 'prebuilt-tanks.json'),
    JSON.stringify([{ k: cachedKey, ts: 1, data: tankWithoutAi('cached', 'https://www.zhihu.com/question/10') }]),
    'utf8',
  );

  const quotaSnapshots = [
    [{ APIID: 'question_answers', RemainingQuota: 1 }, { APIID: 'zhihu_search', RemainingQuota: 1 }, { APIID: 'zhida_openai', RemainingQuota: 1 }],
    [{ APIID: 'question_answers', RemainingQuota: 0 }, { APIID: 'zhihu_search', RemainingQuota: 1 }, { APIID: 'zhida_openai', RemainingQuota: 1 }],
  ];
  const built = [];

  const result = await prebuildTanks({
    dataDir,
    sleepMs: 0,
    fetchQuotaImpl: async () => quotaSnapshots.shift(),
    buildEcosystemImpl: async (question, url, options) => {
      built.push({ question, url, includeAi: options.includeAi });
      return tank(question, url);
    },
  });

  assert.deepEqual(built, [{ question: 'new one', url: 'https://www.zhihu.com/question/11', includeAi: true }]);
  assert.equal(result.saved, 1);
  assert.equal(result.skippedCached, 1);
  assert.equal(result.stoppedReason, 'quota_insufficient');
  assert.match(result.message, /question_answers/);

  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'prebuilt-tanks.json'), 'utf8'));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].data.question, 'new one');
});
