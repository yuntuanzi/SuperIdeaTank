#!/usr/bin/env node
/**
 * 提交前合规闸（① 层：纯脚本判定，零模型信任）
 *
 * 为什么要有这个文件：
 *   赛事官方检查清单里「凭证不得出现在代码仓库 / 前端响应 / 日志 / 截图」是一条会
 *   直接取消资格的红线，而「AI 演化重建 / AI 模拟预测」的诚信标注是评委明确会看的点。
 *   这两类检查都能被机械判定，就不该交给任何人（包括模型）用眼睛看。
 *
 * 用法：
 *   node tools/compliance-check.mjs            # 检查工作区
 *   node tools/compliance-check.mjs --dist     # 额外检查前端构建产物
 *   node tools/compliance-check.mjs --url https://xxx.onrender.com   # 额外检查线上响应
 *
 * 退出码：0 = 全绿；1 = 有红项。可直接挂 CI 或提交前手跑。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const checkDist = args.includes('--dist');
const urlIdx = args.indexOf('--url');
const liveUrl = urlIdx >= 0 ? args[urlIdx + 1] : null;

const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail = '') => results.push({ ok: false, name, detail });
const skip = (name, detail = '') => results.push({ ok: null, name, detail });

// ---------- 工具 ----------

function git(...a) {
  return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function readEnvSecret() {
  // 只从本地 .env 读，用来做「这个值有没有泄漏出去」的比对。
  // 注意：本脚本自身绝不打印 secret 明文，只打印前 6 位做定位。
  const p = path.join(ROOT, 'app', 'server', '.env');
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, 'utf8').match(/^\s*ZHIHU_ACCESS_SECRET\s*=\s*(.+)$/m);
  const v = m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  return v || null;
}

function walk(dir, out = [], ignore = /node_modules|[\\/]\.git[\\/]/) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (ignore.test(p)) continue;
    if (e.isDirectory()) walk(p, out, ignore);
    else out.push(p);
  }
  return out;
}

// ---------- 检查 1：凭证零泄漏 ----------

const secret = readEnvSecret();

if (!secret) {
  skip('凭证泄漏扫描', 'app/server/.env 未配置 Access Secret，跳过（演示模式）');
} else {
  const head = secret.slice(0, 6);

  // 1a. git 跟踪的文件里不得出现 secret
  const tracked = git('ls-files').split('\n').filter(Boolean).filter((f) => !f.includes('node_modules'));
  const leaked = [];
  for (const f of tracked) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    if (st.size > 8 * 1024 * 1024) continue;
    let buf;
    try {
      buf = fs.readFileSync(p, 'utf8');
    } catch {
      continue;
    }
    if (buf.includes(secret)) leaked.push(f);
  }
  leaked.length
    ? fail('凭证未入库', `以下已跟踪文件含 Access Secret（${head}…）：\n    ${leaked.join('\n    ')}`)
    : pass('凭证未入库', `扫描 ${tracked.length} 个已跟踪文件，未发现 ${head}…`);

  // 1b. .env 及其备份必须处于 ignore 状态
  const mustIgnore = ['app/server/.env'];
  for (const f of fs.readdirSync(path.join(ROOT, 'app', 'server'))) {
    if (f.startsWith('.env.bak')) mustIgnore.push(`app/server/${f}`);
  }
  const notIgnored = mustIgnore.filter((f) => {
    try {
      execFileSync('git', ['check-ignore', '-q', f], { cwd: ROOT });
      return false;
    } catch {
      return true;
    }
  });
  notIgnored.length
    ? fail('凭证文件已 gitignore', `未被忽略：${notIgnored.join(', ')}`)
    : pass('凭证文件已 gitignore', mustIgnore.join(', '));

  // 1c. 构建产物里不得出现 secret（评委会看前端 bundle）
  if (checkDist) {
    const dist = path.join(ROOT, 'app', 'web', 'dist');
    if (!fs.existsSync(dist)) {
      fail('构建产物无凭证', 'app/web/dist 不存在，先跑 npm run build');
    } else {
      const hit = walk(dist).filter((p) => {
        try {
          return fs.readFileSync(p, 'utf8').includes(secret);
        } catch {
          return false;
        }
      });
      hit.length
        ? fail('构建产物无凭证', `泄漏文件：${hit.join(', ')}`)
        : pass('构建产物无凭证', `扫描 ${walk(dist).length} 个 dist 文件`);
    }
  }

  // 1d. 线上响应里不得出现 secret
  if (liveUrl) {
    try {
      const res = await fetch(liveUrl.replace(/\/$/, '') + '/api/status');
      const body = await res.text();
      body.includes(secret)
        ? fail('线上响应无凭证', `${liveUrl}/api/status 返回体含 Access Secret`)
        : pass('线上响应无凭证', `HTTP ${res.status}`);
    } catch (e) {
      fail('线上响应无凭证', `请求失败：${e.message}`);
    }
  }
}

// ---------- 检查 2：诚信标注在位 ----------
//
// 三处标注是产品文档里对评委的承诺，改 UI 时很容易被顺手删掉。
// 这里按字符串锚点检查，比"让人再看一遍"可靠。

const HONESTY_ANCHORS = [
  { file: 'app/web/src/components/Workspace.tsx', text: 'AI 演化重建', why: '时间轴面板的非历史数据标注' },
  { file: 'app/web/src/components/Workspace.tsx', text: 'AI 模拟预测', why: '放生面板的模拟结果标注' },
  { file: 'app/web/src/App.tsx', text: '非知乎平台历史数据', why: '页脚全局声明' },
];

for (const a of HONESTY_ANCHORS) {
  const p = path.join(ROOT, a.file);
  if (!fs.existsSync(p)) {
    fail(`诚信标注：${a.text}`, `文件不存在 ${a.file}`);
    continue;
  }
  fs.readFileSync(p, 'utf8').includes(a.text)
    ? pass(`诚信标注：${a.text}`, `${a.file}（${a.why}）`)
    : fail(`诚信标注：${a.text}`, `${a.file} 中已找不到该标注 —— ${a.why}`);
}

// ---------- 检查 3：无新增依赖（防止改 UI 时偷偷装包） ----------

for (const pkg of ['app/web/package.json', 'app/server/package.json']) {
  try {
    const diff = git('diff', 'HEAD', '--', pkg);
    diff.includes('"dependencies"') || diff.includes('"devDependencies"')
      ? fail('依赖未变更', `${pkg} 的依赖段有改动：\n${diff.slice(0, 400)}`)
      : pass('依赖未变更', pkg);
  } catch {
    skip('依赖未变更', `${pkg} 无法 diff（可能不在 git 中）`);
  }
}

// ---------- 检查 4：构建产物指纹（验证 UI 改动真的构建进去了） ----------
//
// 踩过的坑：tsc -b 失败时 vite build 不会产出新文件，但旧 dist 还在，
// 于是"dist 存在"被误当成"构建成功"。所以这里打印 hash，让人比对而不是靠感觉。

if (checkDist) {
  const assets = path.join(ROOT, 'app', 'web', 'dist', 'assets');
  if (fs.existsSync(assets)) {
    const files = fs.readdirSync(assets);
    const stamp = files
      .map((f) => `${f} (${(fs.statSync(path.join(assets, f)).size / 1024).toFixed(1)}KB, ${fs.statSync(path.join(assets, f)).mtime.toISOString().slice(0, 19)})`)
      .join('\n    ');
    pass('构建产物指纹', `\n    ${stamp}`);
  } else {
    fail('构建产物指纹', 'dist/assets 不存在');
  }
}

// ---------- 输出 ----------

console.log('\n观点进化缸 · 提交前合规闸\n' + '='.repeat(56));
let bad = 0;
for (const r of results) {
  const mark = r.ok === null ? '跳过' : r.ok ? ' OK ' : '失败';
  if (r.ok === false) bad++;
  console.log(`[${mark}] ${r.name}${r.detail ? `\n       ${r.detail}` : ''}`);
}
console.log('='.repeat(56));
console.log(bad === 0 ? '全部通过。' : `${bad} 项未通过，修完再提交。`);
process.exit(bad === 0 ? 0 : 1);
