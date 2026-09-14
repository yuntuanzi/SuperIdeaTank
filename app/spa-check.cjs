// SPA 托管验证
fetch('http://localhost:8787/')
  .then(async (r) => {
    const t = await r.text();
    const out = { status: r.status, hasRoot: t.includes('id="root"'), hasTitle: t.includes('观点进化缸'), len: t.length };
    require('node:fs').writeFileSync(__dirname + '/spa-check.txt', JSON.stringify(out, null, 1), 'utf8');
  })
  .catch((e) => {
    require('node:fs').writeFileSync(__dirname + '/spa-check.txt', 'ERR: ' + e.message, 'utf8');
  });
