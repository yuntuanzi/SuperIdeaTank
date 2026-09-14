# 派活单 · 把 7 条红测试跑绿（智能层重构收尾）

> 执行模块：Kimi ｜ 工作区：`C:\Users\bokily\dev\super-eco`（主仓 master，改动留工作区）
> 撰写：Claude Opus 5 ｜ 2026-09-13 11:45

---

## 0. 现状（必须先理解，否则你会改错东西）

上一个模块（Codex）在重构「智能层」时**跑到一半额度耗尽被强制中断**。
它已经完成的部分质量很好，**不要重写**：

| 已完成 | 状态 |
|---|---|
| `app/server/src/annotator.js`（430 行本地启发式标注器） | ✅ 12 条真实锚点命中：立场 9/12、策略 11/12，超过要求 |
| `app/server/src/ecosystem.js` 改造（本地标注 + 直答生态解说 + 派系解析） | ✅ 主体完成 |
| `app/server/src/zhihu.js` 改造 | 🟡 部分完成 |
| `app/server/src/demoData.js` 补新字段 | ✅ |
| `app/web/src/types.ts` 契约扩展 | ✅ |
| `app/server/scripts/prebuild-tanks.mjs` | 🟡 部分完成 |
| **`app/server/src/index.js`（路由接线）** | ❌ **完全没动** |
| 5 个测试文件 `app/server/test/*.test.mjs` | ✅ 已写好，**29 条，当前 22 绿 7 红** |

**关键事实：测试已经写完并且定义了完整契约。你的任务就是让那 7 条红的变绿。**

这是最好的一种任务形态——验收标准是机器可判定的，不需要任何人主观评价。

---

## 1. 任务

```
cd C:\Users\bokily\dev\super-eco\app\server
node --test "test/*.test.mjs"
```

当前输出：`tests 29 / pass 22 / fail 7`。

**目标：`pass 29 / fail 0`。**

### 7 条红测试

| # | 测试 | 文件 | 大概率要改的地方 |
|---|---|---|---|
| 1 | `adversarial evidence uses matched text and adjusted weights` | `test/annotator.test.mjs:124` | `src/annotator.js` 的 evidence 权重计算 |
| 2 | `无空格的 Markdown 标题仍能解析五派和优势结论` | `test/ecosystem.test.mjs:138` | `src/ecosystem.js` 的派系解析正则（`##一、` 无空格的情况） |
| 3 | `路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签` | `test/api.test.mjs` | **`src/index.js`（尚未接线）** |
| 4 | `prebuilt tanks are ready forever even when AI narrative is absent` | `test/cache-prebuild.test.mjs` | `src/zhihu.js` 缓存就绪判定 |
| 5 | `fresh regular cache without AI narrative is ready until TTL expires` | 同上 | 同上 |
| 6 | `regular cache entries with AI narrative are preserved outside the 100 item trim` | 同上 | 同上（`persistEcoCacheEntry` 的裁剪逻辑） |
| 7 | `prebuildTanks checks quota before each uncached tank and stops when quota is insufficient` | 同上 | `scripts/prebuild-tanks.mjs` |

---

## 2. 铁律（违反即整体打回）

### 2.1 **绝对禁止修改 `app/server/test/` 下任何文件**

测试就是这次任务的**验收闸**，而且是由另一个模块写的（作者 ≠ 审核者）。
你改测试让它变绿 = 把闸拆了，等于零产出。

- 不许改断言
- 不许改期望值
- 不许 `skip` / 注释掉
- 不许新增测试去"覆盖"旧的
- 连格式化都不要动

**如果你认为某条测试本身写错了**：**不要改它**，在报告里单独列一节
「我认为这条测试断言有问题，理由是……」，由我来判。

### 2.2 已经绿的 22 条必须继续绿

改完跑全量，**29 条全绿**才算完成。任何一条从绿变红都算失败。

特别注意 `annotates real Zhihu anchors above the required hit rate`——
这条断言标注器在 12 条真实语料上的命中率（立场 ≥8、策略 ≥9）。
改 evidence 权重时很容易把命中率带崩。**改完必须复跑确认。**

### 2.3 不许调用任何真实 API

- 今日额度：`zhida_openai 0`、`zhihu_search 2`、`question_answers 2`、`hot_list 2`。**基本见底。**
- 测试都用了可注入的 fetch / 数据源替身，照着现有模式写。
- **不许起服务去"手动验证"**（会打真实接口）。全部靠测试。
- 不许动 `app/server/.env`。

### 2.4 其它

- **不许 git commit / git add -A / git stash**，改动留工作区
- **不许新增 npm 依赖**（测试用 Node 内置 `node:test` + `node:assert`）
- **不许改 `app/web/` 下任何文件**（前端另有模块在处理）
- 不许删 `*.bak.2026-09-13`（那是 Codex 留的改动前备份）
- 发现 bug 只报告不修
- 不引入 BOM，也不主动删已有 BOM

---

## 3. 上下文：这次重构在做什么

（读代码前先看这段，否则容易改歪方向）

原设计把知乎**直答 API** 当成「输出 JSON 的分类器」，实测发现它是**问答/检索产品**，
完全无视格式指令，导致所有回答被标成同一个默认值「中立·数据论证」，可视化全灰。

重构后按能力分工：

- **逐条标注** → `annotator.js` 本地启发式（中文词典 + 规则 + 问题类型先验），**零 API 额度**，
  每个判定都带 `evidence`（命中了哪些词 + 权重），可解释
- **整缸生态解说** → 直答，**自然语言提问，不加格式约束**，
  返回的 markdown 再用正则解析出「派系」（`aiFactions` / `aiDominant`）
- **预构建缸** → `prebuilt-tanks.json` 永久有效（不受 TTL 影响），
  评委点这些问题零额度秒开

**为什么额度这么关键**：实测直答 2 次/日、热榜 2 次/日、搜索和问题回答各 10 次/日。
任何「每次交互都实时调 API」的设计都会在评审当天当场失败。

参考文档（按需读，不必全读）：
- `docs/dispatch/ANNOTATOR-SPEC.md` — 完整设计（含附录 A：已验证的直答 prompt）
- `docs/evidence/zhida-explain-2026-09-13.json` — 直答真实响应，派系解析的 fixture 来源
- `docs/evidence/annotator-fixtures.json` — 12 条人工标注锚点

---

## 4. 交付物

工作区根目录写 `WIRING-REPORT.md`：

1. **`node --test "test/*.test.mjs"` 的完整输出**（改动前 22/7 → 改动后 29/0），两段都要贴原文
2. **每条红测试你改了什么、为什么**（一句话即可，重点是 why）
3. **锚点命中率复核**：改完后立场 x/12、策略 x/12 分别是多少（不许低于 9/11）
4. **你认为写错了的测试**（如果有）—— 不要改它，列出来我判
5. **发现但未修的问题**

**不要 commit。**
