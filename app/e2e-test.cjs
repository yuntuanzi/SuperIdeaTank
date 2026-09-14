// 端到端接口验证：请求本地服务并写入结果文件（绕开宿主 shell 流问题）
const BASE = process.argv[2] || 'http://localhost:8787';
const OUT = process.argv[3];

async function main() {
  const results = {};

  const status = await fetch(`${BASE}/api/status`);
  results.status = { http: status.status, body: await status.json() };

  const hot = await fetch(`${BASE}/api/hot`);
  const hotBody = await hot.json();
  results.hot = { http: hot.status, source: hotBody.source, items: hotBody.items?.length, stale: hotBody.stale || false };

  // 用真实热榜第一题验证双通道管线（URL 直取 + 搜索富化）
  const top = hotBody.items?.[0] || {};
  const eco = await fetch(`${BASE}/api/ecosystem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: top.title || '测试问题', url: top.url }),
  });
  const ecoBody = await eco.json();
  results.ecosystem = {
    http: eco.status,
    source: ecoBody.source,
    dataSource: ecoBody.dataSource,
    species: ecoBody.species?.length,
    enriched: ecoBody.species?.filter((s) => s.votes !== null && s.votes !== undefined).length,
    sample: ecoBody.species?.[0]
      ? { stance: ecoBody.species[0].stance, strategy: ecoBody.species[0].strategy, votes: ecoBody.species[0].votes, annSrc: ecoBody.species[0].annotationSource }
      : null,
    narrative: (ecoBody.narrative || '').slice(0, 60),
  };

  const rel = await fetch(`${BASE}/api/release`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: ecoBody.question || '测试问题',
      draft: '我整理了近三年所在行业的工时与产出数据：加班最严重的季度，人均有效产出反而下降了两成。无效加班不是奋斗，是把工位当成了秀场。这一段超过二十个字，符合最低长度要求。',
      species: ecoBody.species || [],
    }),
  });
  const relBody = await rel.json();
  results.release = {
    http: rel.status,
    probability: relBody.survivalProbability,
    analysisSource: relBody.analysisSource,
    stance: relBody.stance,
    strategy: relBody.strategy,
    adviceCount: relBody.hybridAdvice?.length,
    suppressedBy: (relBody.suppressedBy || '').slice(0, 40),
  };

  const lines = Object.entries(results).map(
    ([k, v]) => `${k}: ${JSON.stringify(v)}`,
  );
  require('node:fs').writeFileSync(OUT, lines.join('\n'), 'utf8');
  process.exit(0);
}

main().catch((e) => {
  require('node:fs').writeFileSync(OUT, `FATAL: ${e.message}\n${e.stack}`, 'utf8');
  process.exit(1);
});
