import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// zhihu.js 的热榜/搜索/问答缓存是模块级单例，用带 query 的 import 拿到全新模块实例，
// 让每个用例从“内存为空”的冷启动状态开始，模拟 Render 休眠唤醒。
let seq = 0;
async function freshZhihu() {
  seq += 1;
  return await import(`../src/zhihu.js?hotpersist=${seq}-${Date.now()}`);
}

async function makeTempDataDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'super-eco-hotpersist-'));
}

// 任何网络访问都必须立刻爆炸：走到这里就说明降级链漏了
const throwingFetch = () => {
  throw new Error('network forbidden in this leg');
};

function fakeHotFetch(items) {
  return async () => ({
    ok: true,
    text: async () => JSON.stringify({ Data: { Items: items } }),
  });
}

const HOT_ITEMS = [
  { Title: '热榜问题甲？', Url: 'https://www.zhihu.com/question/700001', Summary: '摘要甲', ThumbnailUrl: '' },
  { Title: '热榜问题乙？', Url: 'https://www.zhihu.com/question/700002', Summary: '摘要乙', ThumbnailUrl: '' },
];

test('fetchHot persists to disk and a cold process serves it with zero network', async () => {
  const dataDir = await makeTempDataDir();

  const first = await freshZhihu();
  const live = await first.fetchHot({ dataDir, fetchImpl: fakeHotFetch(HOT_ITEMS) });
  assert.equal(live.cached, false);
  assert.equal(live.items.length, 2);

  // 成功后磁盘必须有文件，这是冷启动保额度的前提
  const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'hot-cache.json'), 'utf8'));
  assert.equal(saved.data.items.length, 2);

  // 全新模块实例（内存为空）+ 网络全断，仍能从磁盘恢复
  const second = await freshZhihu();
  const revived = await second.fetchHot({ dataDir, fetchImpl: throwingFetch });
  assert.equal(revived.cached, true);
  assert.equal(revived.items[0].title, '热榜问题甲？');
});

test('fallback chain: empty memory + empty disk + failing API + snapshot present → snapshot', async () => {
  const dataDir = await makeTempDataDir();
  const snapshotAt = 1789310000000;
  await fs.writeFile(
    path.join(dataDir, 'hot-snapshot.json'),
    JSON.stringify({ snapshotAt, items: [{ title: '快照问题？', url: 'https://www.zhihu.com/question/700003', summary: '', thumbnail: '' }] }),
    'utf8',
  );

  const zhihu = await freshZhihu();
  const result = await zhihu.fetchHot({ dataDir, fetchImpl: throwingFetch });

  // 快照是真实采集的历史数据，必须如实标注来源与采集时间，不能混同为演示数据
  assert.equal(result.source, 'snapshot');
  assert.equal(result.snapshotAt, snapshotAt);
  assert.equal(result.items[0].title, '快照问题？');
});

test('fallback chain: nothing available at all → demo data as last resort', async () => {
  const dataDir = await makeTempDataDir();
  const zhihu = await freshZhihu();
  const result = await zhihu.fetchHot({ dataDir, fetchImpl: throwingFetch });
  assert.equal(result.source, 'demo');
  assert.ok(result.items.length > 0);
  assert.ok(result.warning);
});

test('search and question-answers caches survive a cold restart via disk', async () => {
  const dataDir = await makeTempDataDir();
  const searchBody = {
    Data: {
      Items: [{
        ContentID: 's1', Title: '搜索结果', ContentType: 'answer', ContentText: '<p>正文</p>',
        Url: 'https://www.zhihu.com/question/700004/answer/1', VoteUpCount: 7, CommentCount: 2,
        AuthorName: '作者', AuthorAvatar: '', AuthorBadgeText: '', AuthorityLevel: 2, EditTime: 0, CommentInfoList: [],
      }],
    },
  };
  const qaBody = {
    Data: {
      Items: [{ ContentToken: 'q1', ContentType: 'answer', Url: 'https://www.zhihu.com/question/700005/answer/1', Summary: '<p>回答摘要</p>' }],
      Paging: { IsEnd: true },
    },
  };

  const first = await freshZhihu();
  const fetchImpl = async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes('zhihu_search') ? searchBody : qaBody),
  });
  const searchData = await first.searchZhihu('某查询', 10, { dataDir, fetchImpl });
  const qaData = await first.fetchQuestionAnswers('https://www.zhihu.com/question/700005', 0, 10, { dataDir, fetchImpl });
  assert.equal(searchData[0].id, 's1');
  assert.equal(qaData.items[0].id, 'q1');

  // 磁盘文件存在
  assert.ok(JSON.parse(await fs.readFile(path.join(dataDir, 'search-cache.json'), 'utf8')).length === 1);
  assert.ok(JSON.parse(await fs.readFile(path.join(dataDir, 'qa-cache.json'), 'utf8')).length === 1);

  // 冷启动（新模块实例）+ 网络全断，磁盘缓存照样命中
  const second = await freshZhihu();
  const searchHit = await second.searchZhihu('某查询', 10, { dataDir, fetchImpl: throwingFetch });
  const qaHit = await second.fetchQuestionAnswers('https://www.zhihu.com/question/700005', 0, 10, { dataDir });
  assert.equal(searchHit[0].id, 's1');
  assert.equal(qaHit.items[0].id, 'q1');
});
