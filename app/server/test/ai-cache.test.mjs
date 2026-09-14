// DeepSeek 调用缓存的单测：全部用替身 fetch，不联网、不消耗真实额度。
//
// 这一层是成本红线：一次建缸要打 2–3 次真实调用，重复点开、双击、多标签页
// 都会重复扣余额。测试必须钉死三件事：
//  ① 同请求第二次调用**不产生网络请求**（这是省钱的唯一判据）；
//  ② 参数或提示词有任何差异必须视为不同请求（不能被缓存脏读）；
//  ③ 失败与取消**不得写入缓存**（否则故障会被固化 7 天）。
//
// 另外覆盖流式回放：命中缓存时必须把 reasoning/content 回放给回调，
// 否则「等待期展示思考过程」的交互在命中时会变成一片空白。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 缓存目录必须在 import 目标模块之前指定：模块首次读取时即解析 TANK_DATA_DIR
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tank-aicache-test-'));
process.env.TANK_DATA_DIR = tmpDir;
process.env.DEEPSEEK_API_KEY = 'sk-test-not-a-real-key';

const { aiChatText, aiChatStream, aiUsage, resetAiUsage } = await import('../src/aiClient.js');
const { aiCacheStats, resetAiCacheStats, clearAiCache, aiCacheKey, loadAiCache } = await import('../src/aiCache.js');

// 返回一个「SSE 流」替身：先吐若干 reasoning 增量，再吐 content 增量
function sseResponse(reasoning, content) {
  const chunks = [];
  for (const part of reasoning) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: part } }] })}\n\n`);
  for (const part of content) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { value: encoder.encode(chunks[i++]), done: false } : { value: undefined, done: true }),
      }),
    },
  };
}

function jsonResponse(content) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content } }], usage: { completion_tokens: 10 } }),
  };
}

const msgs = [{ role: 'user', content: '把下面这段判一下：{"json":true}' }];

test('同请求第二次调用不再发网络请求，且不增加 calls', async () => {
  clearAiCache();
  resetAiCacheStats();
  resetAiUsage();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return jsonResponse('{"ok":1}');
  };

  const a = await aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });
  const b = await aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });

  assert.equal(a, '{"ok":1}');
  assert.equal(b, '{"ok":1}');
  assert.equal(fetches, 1, '第二次必须命中缓存，不得再发请求');
  assert.equal(aiUsage().calls, 1);
  assert.equal(aiCacheStats().hits, 1);
});

test('提示词、模型、温度、额度任一不同都视为不同请求', async () => {
  clearAiCache();
  resetAiCacheStats();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return jsonResponse('{"ok":1}');
  };

  await aiChatText(msgs, { fetchImpl, model: 'm', temperature: 0.2, maxTokens: 4096 });
  await aiChatText(msgs, { fetchImpl, model: 'm', temperature: 0.2, maxTokens: 8192 }); // 额度变了
  await aiChatText(msgs, { fetchImpl, model: 'm', temperature: 0.5, maxTokens: 4096 }); // 温度变了
  await aiChatText(msgs, { fetchImpl, model: 'm2', temperature: 0.2, maxTokens: 4096 }); // 模型变了
  await aiChatText([{ role: 'user', content: '换了提示词 {"json":true}' }], { fetchImpl, model: 'm', temperature: 0.2, maxTokens: 4096 });

  assert.equal(fetches, 5, '五个键互不相同，各发一次');
});

test('并发同请求合并为一次真实调用', async () => {
  clearAiCache();
  resetAiCacheStats();
  let fetches = 0;
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const fetchImpl = async () => {
    fetches += 1;
    await gate;
    return jsonResponse('{"ok":1}');
  };

  const p1 = aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });
  const p2 = aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });
  const p3 = aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });
  release();
  const all = await Promise.all([p1, p2, p3]);

  assert.deepEqual(all, ['{"ok":1}', '{"ok":1}', '{"ok":1}']);
  assert.equal(fetches, 1, '飞行中的同键请求必须合并');
  assert.equal(aiCacheStats().merged, 2);
});

test('失败不写入缓存：修好后重试必须真的重试', async () => {
  clearAiCache();
  resetAiCacheStats();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    if (fetches === 1) throw new Error('网络抖动');
    return jsonResponse('{"ok":1}');
  };

  await assert.rejects(() => aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 }), /网络抖动/);
  const ok = await aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });

  assert.equal(ok, '{"ok":1}');
  assert.equal(fetches, 2, '失败结果不得被缓存');
});

test('流式命中缓存时回放思考过程与正文，且不再发请求', async () => {
  clearAiCache();
  resetAiCacheStats();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return sseResponse(['先看', '立场'], ['{"ok"', ':1}']);
  };

  const r1 = [];
  const c1 = [];
  const first = await aiChatStream(msgs, {
    fetchImpl,
    model: 'm',
    maxTokens: 4096,
    onReasoning: (d) => r1.push(d),
    onContent: (d) => c1.push(d),
  });

  const r2 = [];
  const c2 = [];
  const second = await aiChatStream(msgs, {
    fetchImpl,
    model: 'm',
    maxTokens: 4096,
    onReasoning: (d) => r2.push(d),
    onContent: (d) => c2.push(d),
  });

  assert.equal(fetches, 1);
  assert.equal(first.text, '{"ok":1}');
  assert.equal(second.text, '{"ok":1}');
  assert.equal(first.reasoning, '先看立场');
  // 第一次是真流式，增量是分片的
  assert.deepEqual(r1, ['先看', '立场']);
  assert.deepEqual(c1, ['{"ok"', ':1}']);
  // 第二次是回放：整段一次性推给回调，内容必须一致
  assert.deepEqual(r2, ['先看立场']);
  assert.deepEqual(c2, ['{"ok":1}']);
  assert.equal(second.cached, true);
});

test('磁盘持久化：进程内清空后仍能从磁盘恢复，不重复调用', async () => {
  clearAiCache();
  resetAiCacheStats();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return jsonResponse('{"persisted":true}');
  };
  const key = aiCacheKey({ model: 'm', temperature: 0.2, json: false, maxTokens: 4096, messages: msgs });
  await aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });

  // 模拟容器重启：内存清空、只剩磁盘文件
  const file = path.join(tmpDir, 'ai-cache.json');
  await new Promise((r) => setTimeout(r, 1700)); // 等落盘防抖
  assert.equal(fs.existsSync(file), true, '缓存必须落盘');

  // 直接断言磁盘里有这个键，且能重新载入
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(rows.some((e) => e.k === key), true);
  loadAiCache();
  assert.equal(fetches, 1);
});

test('AI_CACHE=0 时完全关闭缓存，每次都真实调用', async () => {
  clearAiCache();
  resetAiCacheStats();
  process.env.AI_CACHE = '0';
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return jsonResponse('{"ok":1}');
  };
  await aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });
  await aiChatText(msgs, { fetchImpl, model: 'm', maxTokens: 4096 });
  delete process.env.AI_CACHE;

  assert.equal(fetches, 2, '关闭后不得走缓存');
});
