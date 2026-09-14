# 派活单 · 服务端第二轮：离线预构建 + 热榜持久化

> 执行模块：Kimi ｜ 工作区：`C:\Users\bokily\dev\super-eco`（主仓 master，改动留工作区）
> 撰写：Claude Opus 5 ｜ 2026-09-13 12:05
> 前置：上一轮 29 条测试已全绿，智能层重构已合并。**这轮不许让任何一条变红。**

---

## 背景：为什么这两件事是 P0

评审窗口是 9/15 10:00 提交 → 9/15–9/17 评委滚动打分。
也就是说**评委访问的时候我们不在场**，而每日额度极少：
直答 2、热榜 2、搜索 10、问题回答 10。

两个会在评审当天出事的洞：

1. **热榜缓存只在内存里**。部署在 Render 免费档，15 分钟无请求就休眠，
   评审期两天会反复冷启动。每次冷启动后第一个访客触发一次真实 `hot_list` 调用，
   **第三个访客开始首页就只能看演示数据**。
2. **演示缸得靠额度现建**。我已经抢在今天额度过期前，把 8 个热榜问题的
   **原始素材**抓下来落盘了（`app/server/data/raw-tanks.json`，80 条真实回答 +
   80 条搜索样本）。但现在没有任何代码能把它变成可用的缸——
   现有的 `scripts/prebuild-tanks.mjs` 是**在线**模式，会再消耗额度，而今天只剩
   `zhihu_search 2` / `question_answers 2`。

---

## 任务 A ｜ `prebuild-tanks.mjs` 增加离线模式（最高优先级）

### A1. 目标

```bash
node scripts/prebuild-tanks.mjs --from-raw data/raw-tanks.json
```

**全程零网络调用**，产出 `app/server/data/prebuilt-tanks.json`，
里面是 8 个可以直接被 `loadEcoCache()` 加载、被 `/api/tanks` 列出、
被 `/api/ecosystem` 命中的完整生态缸。

### A2. 现成的注入点（不要另起炉灶）

`src/ecosystem.js` 的 `buildEcosystem(question, questionUrl, options)` 已经支持：

```js
const { search = searchZhihu, answers = fetchQuestionAnswers } = options;
```

所以离线模式只需要给它喂两个替身函数，从 `raw-tanks.json` 里取数据：

```js
// raw-tanks.json 每项：{ question, url, fetchedAt, answers: [...], search: [...], errors: [] }
// answers 项：{ id, contentType, url, excerpt }              ← 对应 fetchQuestionAnswers 的 items
// search  项：{ id, title, contentType, excerpt, url, votes, comments,
//               author, avatar, badgeText, authority, editTime, featuredComments }
//                                                            ← 对应 searchZhihu 的返回
```

注意 `fetchQuestionAnswers` 的返回形状是 `{ items, paging }`，`searchZhihu` 直接返回数组。
**照现有签名喂，不要改 `ecosystem.js` 的接口。**

### A3. 硬要求

- `--from-raw` 模式下**一次网络请求都不许发**：不查 quota、不调直答、不调搜索。
  （在线模式的 quota 守卫保持原样，只是离线模式跳过。）
- `aiNarrative` 在离线模式下就是 `null`（今日直答额度为 0）。
  **这不是失败**——本地标注已经能撑起整个缸。明天额度重置后我会单独补 AI 解说。
- 结果写进 `prebuilt-tanks.json`，条目要能被现有的 `loadEcoCache()` 正确加载
  （key 用 `hashKey(question + '|' + url)`，与 `/api/ecosystem` 的算法完全一致，
  否则前端点了会 cache miss 再去打 API —— **这条错了整件事就白做**）。
- 打印每个缸的：物种数、**立场分布**、**策略分布**、赞同数富化命中数、
  `aiNarrative` 有无。分布退化（某一类 ≥80%）要显眼地警告。
- 可重复执行，重跑覆盖不追加。

### A4. 测试

在 `test/` 下**新增**（不要改现有测试文件）`prebuild-offline.test.mjs`：

- 用一个临时目录 + 2 条构造的 raw 数据跑离线模式，断言：
  - 产出的 key 与 `hashKey(question + '|' + url)` 一致
  - 全程零网络（注入一个会 `throw` 的 fetch 替身，跑完不抛异常即证明没调用）
  - `aiNarrative === null` 且不抛异常
  - 物种数 = 输入回答数

---

## 任务 B ｜ 热榜与搜索缓存磁盘持久化 + 提交快照兜底

### B1. 热榜磁盘持久化

`src/zhihu.js` 的 `hotCache` 目前是纯内存 `{ data: null, ts: 0 }`。
改成与 `eco-cache.json` 同样的落盘机制：`app/server/data/hot-cache.json`，
启动时载入，`fetchHot()` 成功后写盘。

### B2. 提交一份热榜快照当最终兜底

新增 `app/server/data/hot-snapshot.json`（**这个文件要能进 git**，不是 gitignore 的运行时缓存）。

- 先加一个脚本 `scripts/snapshot-hot.mjs`，从**现有的运行时缓存**
  （`hot-cache.json`，或退一步从内存接口 `GET /api/hot`）导出快照，
  **不要为了生成快照去调真实 hot_list**（今天只剩 2 次）。
  > 提示：主仓服务当前在 8787 跑着，`curl http://localhost:8787/api/hot` 拿到的就是
  > 12 小时缓存里的真实热榜，可以直接存成快照。这条**不消耗额度**。
- `fetchHot()` 的降级顺序改为：
  **内存缓存 → 磁盘缓存 → 真实 API → 快照文件 → 演示数据**
- 走到快照时，返回体带 `source: 'snapshot'` 与 `snapshotAt: <采集时间戳>`，
  让前端能如实显示「热榜快照 · 采集于 X」，而不是笼统的「演示数据」。
  **诚信要求：真实采集的历史快照和虚构演示数据是两回事，不能混为一谈。**

### B3. 搜索 / 问题回答缓存同样落盘

`searchCache` 与 `qaCache` 目前也是纯内存，重启即丢。
同样落盘到 `data/search-cache.json` / `data/qa-cache.json`，保留各自 TTL。

### B4. 测试

新增 `test/hot-persist.test.mjs`（同样不要改现有测试）：

- 注入临时 dataDir，断言 `fetchHot()` 成功后磁盘有文件、重新 load 后命中缓存零网络
- 断言降级链：内存空 + 磁盘空 + API 抛错 + 有快照 → 返回快照且 `source === 'snapshot'`
- 断言全都没有时才落到演示数据

---

## 铁律

- **禁止修改 `app/server/test/` 下已有的 5 个测试文件**（`annotator` / `api` /
  `cache-prebuild` / `ecosystem` / `zhida`）。它们是上一轮的验收闸，由另外的模块写的。
  新测试请**新建文件**。
- **改完必须跑全量：`cd app/server && node --test "test/*.test.mjs"`，
  原有 29 条 + 你新增的，全部绿。** 任何一条从绿变红都算失败。
- **不许调用任何真实 API**（今日 `zhida_openai 0`、`zhihu_search 2`、`question_answers 2`、
  `hot_list 2`）。唯一允许的网络动作是 `curl http://localhost:8787/api/hot` 读本机
  已缓存的热榜来生成快照——那是读本地服务，不打上游。
- 不许 `git commit` / `git add -A` / `git stash`，改动留工作区
- 不许新增 npm 依赖
- **不许改 `app/web/` 下任何文件**（前端下一轮单独处理）
- 不许动 `app/server/.env`，不许删 `*.bak.2026-09-13`
- 改任何既有源文件前先存一份 `<文件名>.bak2.2026-09-13`
- 发现 bug 只报告不修
- 新增代码块要有解释「**为什么**」而不是复述代码的中文注释

---

## 交付物

工作区根目录写 `SERVER-ROUND2-REPORT.md`：

1. 全量测试输出（改动前 / 改动后），两段原文
2. `node scripts/prebuild-tanks.mjs --from-raw data/raw-tanks.json` 的完整终端输出
   —— 我要看到 8 个缸各自的立场/策略分布，判断标注是否退化
3. 怎么证明离线模式真的零网络（贴出你的验证方式）
4. 热榜降级链的实测证据
5. 发现但未修的问题

**不要 commit。**
