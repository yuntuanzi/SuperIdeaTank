// 诊断运行器：以子进程运行 npm install 并把输出写入文件（绕开宿主 shell 流包装问题）
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const NODE = process.argv[2];
const NPM_CLI = process.argv[3];
const CWD = process.argv[4];
const OUT = process.argv[5];

const res = spawnSync(
  NODE,
  [NPM_CLI, 'install', '--no-fund', '--no-audit', '--loglevel=notice', '--registry=https://registry.npmmirror.com'],
  {
    cwd: CWD,
    encoding: 'utf8',
    timeout: 570000,
    env: { ...process.env },
  },
);

const lines = [
  `status: ${res.status}`,
  `error: ${res.error ? String(res.error) : 'none'}`,
  '--- stdout ---',
  res.stdout || '(empty)',
  '--- stderr ---',
  res.stderr || '(empty)',
];
fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
process.exit(res.status === 0 ? 0 : 1);
