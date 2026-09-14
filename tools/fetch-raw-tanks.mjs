#!/usr/bin/env node
/**
 * 演示缸「原始素材」抓取器（运维脚本，不是产品代码）
 *
 * 为什么单独做这个：
 *   知乎搜索与问题回答两个接口各 10 次/日，**当天不用就作废**。而这两个接口拿到的
 *   「回答正文 + 赞同数」是整个产品最贵的东西——标注是本地算的，随时可以重算，
 *   原始数据错过今天就得等明天。
 *
 *   所以这个脚本只做一件事：把若干问题的**原始回答数据**抓下来落盘，
 *   不做任何标注、不写进服务端缓存、不依赖服务端当前的数据结构。
 *   等标注器重构完成后，直接对这份原始数据离线重跑标注即可，零额度消耗。
 *
 * 用法：
 *   node tools/fetch-raw-tanks.mjs <问题清单json> <输出json>
 *   问题清单格式：[{ "question": "标题", "url": "https://www.zhihu.com/question/123" }]
 *
 * 安全：Access Secret 从 app/server/.env 读取，脚本本身不打印、不写出凭证。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://developer.zhihu.com';

const [, , listPath, outPath] = process.argv;
if (!listPath || !outPath) {
  console.error('用法: node tools/fetch-raw-tanks.mjs <问题清单json> <输出json>');
  process.exit(2);
}

// ---------- 凭证 ----------

const envFile = path.join(ROOT, 'app', 'server', '.env');
const SECRET = (fs.readFileSync(envFile, 'utf8').match(/^\s*ZHIHU_ACCESS_SECRET\s*=\s*(.+)$/m) || [])[1]?.trim();
if (!SECRET) {
  console.error('app/server/.env 里没有 ZHIHU_ACCESS_SECRET');
  process.exit(2);
}

const headers = () => ({
  Authorization: `Bearer ${SECRET}`,
  'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
  'Content-Type': 'application/json',
});

async function get(url) {
  const res = await fetch(url, { headers: headers() });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`非 JSON 响应 HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || (body.Code !== undefined && body.Code !== 0)) {
    throw new Error(`Code=${body.Code} ${body.Message || res.status}`);
  }
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 额度守门：抓之前先看余量，不够就不动手 ----------

async function quota() {
  const body = await get(`${BASE}/api/v1/quota`);
  return Object.fromEntries((body.Data || []).map((d) => [d.APIID, d.RemainingQuota]));
}

// ---------- 主流程 ----------

const list = JSON.parse(fs.readFileSync(listPath, 'utf8'));
const before = await quota();
console.log('抓取前余量:', JSON.stringify(before));

// 每个问题消耗 1 次 question_answers + 1 次 zhihu_search，留 2 次余量不用完
// 预留额度可通过 RESERVE 环境变量调整；默认留 2 次应急
const RESERVE = Number(process.env.RESERVE ?? 2);
const budget = Math.min(before.question_answers - RESERVE, before.zhihu_search - RESERVE, list.length);
if (budget <= 0) {
  console.error(`余量不足（qa=${before.question_answers}, search=${before.zhihu_search}），不抓取。`);
  process.exit(1);
}
if (budget < list.length) console.log(`余量只够 ${budget} 个问题，清单里的后 ${list.length - budget} 个跳过。`);

const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : [];
const done = new Set(out.map((t) => t.url || t.question));

let used = 0;
for (const item of list) {
  if (used >= budget) break;
  const key = item.url || item.question;
  if (done.has(key)) {
    console.log(`跳过（已有）：${item.question.slice(0, 26)}`);
    continue;
  }

  const tank = { question: item.question, url: item.url || '', fetchedAt: Date.now(), answers: [], search: [], errors: [] };

  // 通道 A：按问题 URL 直取真实回答
  if (item.url) {
    try {
      const b = await get(`${BASE}/api/v1/content/question_answers?QuestionUrl=${encodeURIComponent(item.url)}&Offset=0&Limit=10`);
      tank.answers = (b?.Data?.Items || []).map((it) => ({
        id: String(it.ContentToken),
        contentType: it.ContentType,
        url: it.Url,
        excerpt: (it.Summary || '').replace(/<[^>]+>/g, '').trim(),
      }));
      tank.paging = b?.Data?.Paging || null;
    } catch (e) {
      tank.errors.push(`question_answers: ${e.message}`);
    }
    await sleep(1500);
  }

  // 搜索：既用于富化赞同数，也是通道 B 的兜底样本
  try {
    const b = await get(`${BASE}/api/v1/content/zhihu_search?Query=${encodeURIComponent(item.question)}&Count=10`);
    tank.search = (b?.Data?.Items || []).map((it) => ({
      id: it.ContentID,
      title: it.Title,
      contentType: it.ContentType,
      excerpt: (it.ContentText || '').replace(/<[^>]+>/g, '').trim(),
      url: it.Url,
      votes: it.VoteUpCount ?? 0,
      comments: it.CommentCount ?? 0,
      author: it.AuthorName || '知乎用户',
      avatar: it.AuthorAvatar || '',
      badgeText: it.AuthorBadgeText || '',
      authority: Number(it.AuthorityLevel) || 1,
      editTime: Number(it.EditTime) || 0,
      featuredComments: (it.CommentInfoList || []).map((c) => c.Content).filter(Boolean),
    }));
  } catch (e) {
    tank.errors.push(`zhihu_search: ${e.message}`);
  }

  out.push(tank);
  used++;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8'); // 每抓一个就落盘，中断不丢
  console.log(
    `✓ ${item.question.slice(0, 28)} — 回答 ${tank.answers.length} 条 / 搜索 ${tank.search.length} 条` +
      (tank.errors.length ? ` ⚠ ${tank.errors.join('; ')}` : ''),
  );
  await sleep(2000);
}

const after = await quota();
console.log('\n抓取后余量:', JSON.stringify(after));
console.log(`共抓取 ${used} 个问题，累计 ${out.length} 个，已写入 ${outPath}`);
