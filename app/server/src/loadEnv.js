// 环境变量加载器（必须作为入口的第一条 import）
//
// 为什么单独成文件：ESM 的 import 会被提升并按源码顺序求值，若把 .env 解析写在
// index.js 的函数体里，它会在所有依赖模块求值之后才执行 —— 任何在模块顶层读取
// process.env 的代码（例如 AI 客户端的密钥检查）都会读到 undefined。
// 独立模块 + 首条 import 才能保证「配置先于使用者就绪」。
//
// Docker 部署走 `--env-file`，进程环境本身就是真实的，此时这里不做任何事。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

export function loadEnv(file = envPath) {
  try {
    if (!fs.existsSync(file)) return false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      // 只接受 KEY=VALUE，忽略注释与空行；已存在的真实环境变量优先（Docker 注入不被打架覆盖）
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    return true;
  } catch {
    return false;
  }
}

loadEnv();
