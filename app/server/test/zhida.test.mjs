import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchQuota, zhidaChat } from '../src/zhihu.js';

// fake Response 只实现生产代码会读取的最小表面，测试失败时更容易定位真实契约变化。
function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  };
}

test('zhidaChat sends both quota and chat HTTP through injected fetchImpl', async () => {
  const oldSecret = process.env.ZHIHU_ACCESS_SECRET;
  const oldFetch = globalThis.fetch;
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  globalThis.fetch = async () => {
    throw new Error('global fetch must not be used in offline tests');
  };

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/api/v1/quota')) {
      return jsonResponse({ Data: [{ APIID: 'zhida_openai', RemainingQuota: 1 }] });
    }
    return jsonResponse({ choices: [{ message: { content: 'ok narrative' } }] });
  };

  try {
    const content = await zhidaChat('zhida-thinking-1p5', [{ role: 'user', content: '问题' }], { fetchImpl });

    assert.equal(content, 'ok narrative');
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/api\/v1\/quota\?APIIDs=zhida_openai/);
    assert.match(calls[1].url, /\/v1\/chat\/completions/);
  } finally {
    if (oldSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
    else process.env.ZHIHU_ACCESS_SECRET = oldSecret;
    globalThis.fetch = oldFetch;
  }
});

test('fetchQuota accepts injected fetchImpl instead of touching the network', async () => {
  const oldSecret = process.env.ZHIHU_ACCESS_SECRET;
  const oldFetch = globalThis.fetch;
  process.env.ZHIHU_ACCESS_SECRET = 'test-secret';
  globalThis.fetch = async () => {
    throw new Error('global fetch must not be used in offline tests');
  };

  const fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/v1\/quota$/);
    return jsonResponse({ Data: [{ APIID: 'question_answers', RemainingQuota: 3 }] });
  };

  try {
    assert.deepEqual(await fetchQuota({ fetchImpl }), [{ APIID: 'question_answers', RemainingQuota: 3 }]);
  } finally {
    if (oldSecret === undefined) delete process.env.ZHIHU_ACCESS_SECRET;
    else process.env.ZHIHU_ACCESS_SECRET = oldSecret;
    globalThis.fetch = oldFetch;
  }
});
