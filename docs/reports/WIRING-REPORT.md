# WIRING-REPORT · 智能层重构收尾（7 红 → 29 绿）

执行：Kimi ｜ 2026-09-13 ｜ 工作区 `C:\Users\bokily\dev\super-eco`（未 commit，改动留工作区）

## 1. 测试输出原文

### 改动前（22 绿 7 红）

```
✔ classifyQuestion covers the four prior types (0.8596ms)
✔ annotates real Zhihu anchors above the required hit rate (3.2448ms)
✔ annotateAll warns when one distribution collapses (0.4658ms)
✔ low evidence text falls back to neutral with explicit low-confidence evidence (1.0506ms)
✔ one sarcasm feature alone is not enough to classify as sarcasm (0.2408ms)
✔ adversarial priors dampen all stance signals for string ctx too (0.3025ms)
✔ adversarial hard authority beats dense numbers (0.1289ms)
✔ adversarial strong story beats emotional wording (0.1027ms)
✖ adversarial evidence uses matched text and adjusted weights (3.1316ms)
✔ adversarial stance ignores author and badge text (0.2118ms)
✔ adversarial pun and absurd proposal are bounded (0.1709ms)
✖ 路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签 (162.631ms)
✔ loadEcoCache loads fresh eco cache and permanent prebuilt tanks from injected dataDir (5.9409ms)
✖ prebuilt tanks are ready forever even when AI narrative is absent (2.8088ms)
✖ fresh regular cache without AI narrative is ready until TTL expires (2.6588ms)
✖ regular cache entries with AI narrative are preserved outside the 100 item trim (6.3484ms)
✔ persistEcoCacheEntry can write to an injected dataDir without touching real cache files (1.9022ms)
✖ prebuildTanks checks quota before each uncached tank and stops when quota is insufficient (6.028ms)
✔ 真实 Markdown 解析出五派并保留独立优势小节 (1.0648ms)
✔ 无格式文本解析降级，不抛异常；编号标题与空字段可用 (0.5088ms)
✔ 解说只发一次 user 消息，原样保留文本，严格复用附录 prompt (0.2209ms)
✔ 解说失败和不可解析格式均不阻断构建 (2.038ms)
✔ URL 与搜索两条构建通道均只调用一次解说，证据来自展示文本 (1.2079ms)
✔ 不请求 AI 和无回答时均保持完整空值契约 (0.253ms)
✔ 放生立场由草稿决定，AI 不参与规则分值/风险/建议 (0.6592ms)
✔ 旧缓存只在内存重标，保留已有 AI；演示证据不伪装成机器命中 (0.6157ms)
✖ 无空格的 Markdown 标题仍能解析五派和优势结论 (0.6486ms)
✔ zhidaChat sends both quota and chat HTTP through injected fetchImpl (0.9355ms)
✔ fetchQuota accepts injected fetchImpl instead of touching the network (1.3ms)
ℹ tests 29
ℹ suites 0
ℹ pass 22
ℹ fail 7
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

✖ failing tests:

test at test\annotator.test.mjs:116:1
✖ adversarial evidence uses matched text and adjusted weights
  AssertionError: assert.ok(result.evidence.strategy.some((hit) => hit.weight > 3.6))
  （actual: false —— 单条证据权重最高只有 3.6，不超 3.6）

test at test\api.test.mjs:12:1
✖ 路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签
  AssertionError: 404 !== 200（GET /api/tanks 路由不存在，index.js 未接线）

test at test\cache-prebuild.test.mjs:62:1
✖ prebuilt tanks are ready forever even when AI narrative is absent
  AssertionError: undefined !== 'no ai prebuilt'
  （isEcoCacheEntryReady 强制要求 aiNarrative，无 AI 的预构建缸根本没被 loadEcoCache 恢复）

test at test\cache-prebuild.test.mjs:79:1
✖ fresh regular cache without AI narrative is ready until TTL expires
  AssertionError: false !== true（同上，无 AI 叙事被判为未就绪）

test at test\cache-prebuild.test.mjs:95:1
✖ regular cache entries with AI narrative are preserved outside the 100 item trim
  AssertionError: assert.ok(saved.length > 100)
  （persistEcoCacheEntry 一刀切 slice(0, 100)，带 AI 叙事的条目没有豁免）

test at test\cache-prebuild.test.mjs:126:1
✖ prebuildTanks checks quota before each uncached tank and stops when quota is insufficient
  AssertionError: built 数组第一条是 'cached' 而不是 'new one'
  （cached 缸无 AI 叙事被判为未就绪 → readyKeys 不含它 → 没被跳过）

test at test\ecosystem.test.mjs:138:1
✖ 无空格的 Markdown 标题仍能解析五派和优势结论
  AssertionError: undefined !== 5
  （parseAiNarrative 的标题正则 /^##[ \t]+/ 强制要求空格，"##一、" 不匹配）
```

### 改动后（29 绿 0 红）

```
✔ classifyQuestion covers the four prior types (0.7567ms)
✔ annotates real Zhihu anchors above the required hit rate (3.1688ms)
✔ annotateAll warns when one distribution collapses (0.5825ms)
✔ low evidence text falls back to neutral with explicit low-confidence evidence (0.5932ms)
✔ one sarcasm feature alone is not enough to classify as sarcasm (0.4912ms)
✔ adversarial priors dampen all stance signals for string ctx too (0.1099ms)
✔ adversarial hard authority beats dense numbers (0.1289ms)
✔ adversarial strong story beats emotional wording (0.1131ms)
✔ adversarial evidence uses matched text and adjusted weights (0.1824ms)
✔ adversarial stance ignores author and badge text (0.1879ms)
✔ adversarial pun and absurd proposal are bounded (0.1649ms)
✔ 路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签 (179.1046ms)
✔ loadEcoCache loads fresh eco cache and permanent prebuilt tanks from injected dataDir (5.2164ms)
✔ prebuilt tanks are ready forever even when AI narrative is absent (2.0847ms)
✔ fresh regular cache without AI narrative is ready until TTL expires (2.2399ms)
✔ regular cache entries with AI narrative are preserved outside the 100 item trim (3.2005ms)
✔ persistEcoCacheEntry can write to an injected dataDir without touching real cache files (2.1417ms)
✔ prebuildTanks checks quota before each uncached tank and stops when quota is insufficient (5.3623ms)
✔ 真实 Markdown 解析出五派并保留独立优势小节 (0.9869ms)
✔ 无格式文本解析降级，不抛异常；编号标题与空字段可用 (0.533ms)
✔ 解说只发一次 user 消息，原样保留文本，严格复用附录 prompt (0.2281ms)
✔ 解说失败和不可解析格式均不阻断构建 (2.3972ms)
✔ URL 与搜索两条构建通道均只调用一次解说，证据来自展示文本 (0.8554ms)
✔ 不请求 AI 和无回答时均保持完整空值契约 (0.5383ms)
✔ 放生立场由草稿决定，AI 不参与规则分值/风险/建议 (0.559ms)
✔ 旧缓存只在内存重标，保留已有 AI；演示证据不伪装成机器命中 (0.3876ms)
✔ 无空格的 Markdown 标题仍能解析五派和优势结论 (0.1227ms)
✔ zhidaChat sends both quota and chat HTTP through injected fetchImpl (0.9288ms)
✔ fetchQuota accepts injected fetchImpl instead of touching the network (1.1612ms)
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 277.086
```

## 2. 每条红测试改了什么、为什么

| # | 测试 | 改动 | 为什么 |
|---|---|---|---|
| 1 | `adversarial evidence uses matched text and adjusted weights` | `src/annotator.js` 的 `topEvidence`：同一段文本被多个特征命中时（如 `《劳动合同法》` 与 `劳动合同法`），合并到最长命中文本并累加权重 | 前端展示的是"这一段文字总共贡献了多少证据"；两条重叠证据分开列会让单条权重都卡在 3.6，且语义上重复。只动证据展示层，不碰打分，避免带崩锚点命中率 |
| 2 | `无空格的 Markdown 标题仍能解析五派和优势结论` | `src/ecosystem.js` 的 `parseAiNarrative`：标题正则 `[ \t]+` → `[ \t]*` | 附录 A 已验证 prompt 允许 `##一、` 无空格写法，轻微排版漂移不应丢掉整组真实派系 |
| 3 | `路由列出永久预构建缸…演示放生使用本地草稿标签` | `src/index.js`（主缺口）：新增 `GET /api/tanks`（返回 `listReadyTanks()`）；支持 `TANK_DATA_DIR` 注入并传给 `loadEcoCache`/`persistEcoCacheEntry`；`/api/ecosystem` 缓存检查移到演示降级**之前**，预构建缸（`hit.prebuilt`）免 TTL；命中时用 `refreshLocalAnnotations` 只在内存重标；`/api/release` 演示路径改用 `annotateOne` 本地标注草稿立场/策略并显式 `aiComment: null` | 预构建缸是赛前花额度换来的永久资产，无凭证也必须可复用，所以缓存命中要优先于 `!live()` 的演示降级；旧缓存的全灰标签只在内存重标、不回写磁盘；演示放生的标签必须与 live 路径同源（annotator），否则演示和真实结果对不上 |
| 4 | `prebuilt tanks are ready forever even when AI narrative is absent` | `src/zhihu.js` 的 `isEcoCacheEntryReady`：去掉 `aiNarrative` 必填，就绪 = question + 非空 species | AI 叙事是可选增强，本地标注已构成可展示的缸；常规缓存的新鲜度由 TTL 负责（loadEcoCache 本来就按 TTL 过滤常规条目），就绪判定不该重复承担这个职责 |
| 5 | `fresh regular cache without AI narrative is ready until TTL expires` | 同上，随 #4 修复 | 同上 |
| 6 | `regular cache entries with AI narrative are preserved outside the 100 item trim` | `src/zhihu.js` 的 `persistEcoCacheEntry`：带 AI 叙事的条目永远保留在 100 条上限之外，普通条目仍封顶 100 | 带 AI 叙事的条目消耗过真实直答额度（2 次/日），裁掉等于白烧额度；普通条目继续封顶防文件膨胀 |
| 7 | `prebuildTanks checks quota before each uncached tank…` | 无直接改动，随 #4 修复 | 根因是 `isEcoCacheEntryReady` 把无 AI 的已缓存预构建缸判为"未就绪"，导致 `readyKeys` 漏掉它、没有跳过；#4 修好后跳过/配额检查/落盘链路全部按预期工作 |

## 3. 锚点命中率复核

改动后用 `docs/evidence/annotator-fixtures.json` 12 条真实锚点单独复核（非测试断言口径，逐条比对）：

- **立场 9/12**（要求 ≥8，spec 复核底线 9）
- **策略 11/12**（要求 ≥9，spec 复核底线 11）

与 Codex 交接时的水平（9/12、11/12）完全一致，没有带崩。未命中的 3 条：fx05（立场/策略均偏）、fx11（立场偏）、fx12（立场偏）。

## 4. 我认为写错了的测试

无。7 条红测试的断言全部合理，均指向实现缺口。

## 5. 发现但未修的问题（按铁律只报告）

1. **`persistEcoCacheEntry` 的豁免无上限**：带 AI 叙事的条目永久豁免 100 条裁剪，长期来看如果 AI 叙事条目持续累积，缓存文件会缓慢膨胀（今天额度 2 次/日，实际增速极慢，暂不构成问题）。
2. **`/api/ecosystem` 命中即重标的开销**：缓存命中时无条件跑 `refreshLocalAnnotations`，对刚构建的新鲜缓存是一次幂等的重复计算。正确性没问题，只是少量 CPU 浪费；若在意可加 `annotationSource !== 'local-heuristic'` 判断再重标。
3. **`data/` 目录下的真实缓存未做迁移**：`isEcoCacheEntryReady` 语义放宽后，`loadEcoCache` 会恢复出更多旧条目（以前因无 AI 叙事被丢弃的）。这是语义变更的自然结果，测试已覆盖，但未对线上真实 `data/eco-cache.json` 做人工核对（铁律禁止起服务验证）。

## 铁律遵守确认

- 未改 `app/server/test/` 下任何文件；未改 `app/web/`；未删 `*.bak.2026-09-13`；未动 `.env`
- 未调用任何真实 API，未起服务手动验证（api 测试用子进程 + 注入临时数据目录 + 空凭证，是测试自身机制）
- 未 git commit / add / stash；未新增 npm 依赖
- 新增代码块均带中文"为什么"注释
