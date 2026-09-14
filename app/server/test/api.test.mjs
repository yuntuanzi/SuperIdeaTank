// 用独立进程和临时缓存验证真实路由，禁止测试覆盖用户已有缸或借用真实凭证。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { hashKey } from '../src/zhihu.js';

test('路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotator-api-'));
  const question = '如何看待预构建测试？';
  const url = 'https://www.zhihu.com/question/321';
  const species = [{ id: 'cached', excerpt: '我赞成，确实值得肯定。数据显示平均增长20%，占比30%。', stance: '中立', strategy: '数据论证', annotationSource: 'none', votes: null, comments: 0, authority: 1 }];
  fs.writeFileSync(path.join(dataDir, 'prebuilt-tanks.json'), JSON.stringify([{ k: hashKey(question + '|' + url), ts: 1, data: { question, questionUrl: url, source: 'live', createdAt: 1, species } }]));
  // 让操作系统选择空闲端口，避免本机已有开发服务影响测试结果。
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const server = spawn(process.execPath, [new URL('../src/index.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: { ...process.env, PORT: String(port), TANK_DATA_DIR: dataDir, ZHIHU_ACCESS_SECRET: '', ZHIDA_DAILY_LIMIT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    // 只等待监听日志；失败输出不包含环境变量，防止把凭证带进验收记录。
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('测试服务启动超时')), 10000);
      server.once('error', error => { clearTimeout(timer); reject(error); });
      server.once('exit', code => { clearTimeout(timer); reject(new Error(`测试服务提前退出 ${code}`)); });
      server.stdout.once('data', () => { clearTimeout(timer); resolve(); });
    });
    const base = `http://127.0.0.1:${port}`;
    const tanks = await fetch(`${base}/api/tanks`);
    assert.equal(tanks.status, 200);
    assert.deepEqual(await tanks.json(), [{ question, url, speciesCount: 1 }]);
    const tank = await fetch(`${base}/api/ecosystem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, url }) }).then(r => r.json());
    assert.equal(tank.source, 'live');
    assert.equal(tank.cached, true);
    assert.equal(tank.species[0].annotationSource, 'local-heuristic');
    assert.equal(tank.species[0].stance, '支持');
    assert.equal(tank.aiNarrative, null);
    const release = await fetch(`${base}/api/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, draft: species[0].excerpt, species: [] }) }).then(r => r.json());
    assert.equal(release.stance, '支持');
    assert.equal(release.analysisSource, 'rule-only-demo');
    assert.equal(release.aiComment, null);
    assert.equal(fs.existsSync(path.join(dataDir, 'eco-cache.json')), false);
  } finally {
    // 清理只针对本测试创建且校验过父目录的临时路径，不触碰项目缓存。
    const stopped = server.exitCode !== null ? Promise.resolve() : once(server, 'exit');
    server.kill();
    await stopped;
    if (path.dirname(path.resolve(dataDir)) === path.resolve(os.tmpdir()) && path.basename(dataDir).startsWith('annotator-api-')) fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
