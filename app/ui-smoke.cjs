// UI 改版冒烟验证：页面可达 + 新样式资源被引用 + 关键接口仍通
const fs = require('node:fs');
async function main() {
  const page = await (await fetch('http://localhost:8787/')).text();
  const m = page.match(/assets\/index-([\w-]+)\.js/);
  const jsRes = await fetch(`http://localhost:8787/assets/index-${m[1]}.js`);
  const js = await jsRes.text();
  const status = await (await fetch('http://localhost:8787/api/status')).json();
  const hot = await (await fetch('http://localhost:8787/api/hot')).json();
  const out = [
    `页面 HTTP 200: ${page.includes('id="root"')}`,
    `新 bundle: ${m[1]}`,
    `bundle 含 hero 类: ${js.includes('hero')}`,
    `bundle 含深色缸类 tank-svg-wrap: ${js.includes('tank-svg-wrap')}`,
    `bundle 含 segmented: ${js.includes('segmented')}`,
    `status: liveMode=${status.liveMode} ecoCacheCount=${status.ecoCacheCount}`,
    `hot: ${hot.items?.length} 条 (source=${hot.source}${hot.warning ? ', warning' : ''})`,
  ];
  fs.writeFileSync(__dirname + '/ui-smoke.txt', out.join('\n'), 'utf8');
}
main().catch((e) => fs.writeFileSync(__dirname + '/ui-smoke.txt', 'EXC: ' + e.message, 'utf8'));
