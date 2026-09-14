// 缓存加固验证：并发 3 个相同请求只应消耗一次额度；重复请求命中缓存
const fs = require('node:fs');
const BASE = 'http://localhost:8787';

const question = '如何看待于东来发文称胖东来再招员工都是学员性质，合同四年，不续签？意味着什么？';
const url = 'https://www.zhihu.com/question/2082478357984421508';

async function main() {
  const out = [];
  // 1) 并发 3 个相同生态缸请求
  const t0 = Date.now();
  const results = await Promise.all(
    Array.from({ length: 3 }, () =>
      fetch(`${BASE}/api/ecosystem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, url }),
      }).then((r) => r.json()),
    ),
  );
  out.push(`并发 3 请求耗时 ${Date.now() - t0}ms`);
  out.push(`species 数一致: ${results.every((r) => r.species?.length === results[0].species?.length)}（${results[0].species?.length}）`);
  out.push(`cached 标记: ${results.map((r) => r.cached ?? 'fresh').join(', ')}（期望仅一个 fresh，其余等同一结果）`);

  // 2) 再次单发 → 必须命中缓存
  const again = await (await fetch(`${BASE}/api/ecosystem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, url }),
  })).json();
  out.push(`复请求 cached: ${again.cached === true}`);

  // 3) 放生重复提交 → 命中缓存
  const draft = '四年不续签在劳动法框架内并不违规，到期终止支付 N 个月补偿即可。真正值得讨论的是：一家以善待员工著称的企业，为何选择用合法但冷淡的方式收缩？这恰恰说明高福利模式在增长放缓时同样脆弱，值得所有组织反思。';
  const r1 = await (await fetch(`${BASE}/api/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, draft, species: results[0].species }),
  })).json();
  const r2 = await (await fetch(`${BASE}/api/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, draft, species: results[0].species }),
  })).json();
  out.push(`放生两次 probability: ${r1.survivalProbability} / ${r2.survivalProbability}，第二次 cached: ${r2.cached === true}`);

  // 4) status 缓存计数
  const st = await (await fetch(`${BASE}/api/status`)).json();
  out.push(`status: liveMode=${st.liveMode} ecoCacheCount=${st.ecoCacheCount} zhidaUsedToday=${st.zhidaUsedToday}`);

  // 5) 磁盘缓存文件存在
  out.push(`磁盘缓存文件: ${fs.existsSync(__dirname + '/server/data/eco-cache.json')}`);

  fs.writeFileSync(__dirname + '/cache-verify.txt', out.join('\n'), 'utf8');
}
main().catch((e) => fs.writeFileSync(__dirname + '/cache-verify.txt', 'EXC: ' + e.message, 'utf8'));
