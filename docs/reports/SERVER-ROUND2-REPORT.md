# 服务端第二轮交付报告：离线预构建 + 热榜持久化

> 执行：Kimi ｜ 2026-09-13 ｜ 工作区 master，未 commit / 未 add
> 改动文件：`app/server/scripts/prebuild-tanks.mjs`、`app/server/src/zhihu.js`、`app/server/src/index.js`、`.gitignore`（均已先存 `.bak2.2026-09-13`）
> 新增文件：`app/server/scripts/snapshot-hot.mjs`、`app/server/test/prebuild-offline.test.mjs`、`app/server/test/hot-persist.test.mjs`、`app/server/data/prebuilt-tanks.json`、`app/server/data/hot-snapshot.json`
> 未动：`app/server/test/` 既有 5 个测试文件、`app/web/`、`app/server/.env`、既有 `*.bak.2026-09-13`

---

## 1. 全量测试输出（原文）

### 改动前（29 绿）

```
✔ classifyQuestion covers the four prior types (0.7809ms)
✔ annotates real Zhihu anchors above the required hit rate (3.3176ms)
✔ annotateAll warns when one distribution collapses (0.469ms)
✔ low evidence text falls back to neutral with explicit low-confidence evidence (0.6655ms)
✔ one sarcasm feature alone is not enough to classify as sarcasm (0.4091ms)
✔ adversarial priors dampen all stance signals for string ctx too (0.1155ms)
✔ adversarial hard authority beats dense numbers (0.1293ms)
✔ adversarial strong story beats emotional wording (0.1064ms)
✔ adversarial evidence uses matched text and adjusted weights (0.1556ms)
✔ adversarial stance ignores author and badge text (0.2893ms)
✔ adversarial pun and absurd proposal are bounded (0.1622ms)
✔ 路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签 (166.9577ms)
✔ loadEcoCache loads fresh eco cache and permanent prebuilt tanks from injected dataDir (6.1663ms)
✔ prebuilt tanks are ready forever even when AI narrative is absent (1.8748ms)
✔ fresh regular cache without AI narrative is ready until TTL expires (1.749ms)
✔ regular cache entries with AI narrative are preserved outside the 100 item trim (3.8589ms)
✔ persistEcoCacheEntry can write to an injected dataDir without touching real cache files (1.5267ms)
✔ prebuildTanks checks quota before each uncached tank and stops when quota is insufficient (6.0227ms)
✔ 真实 Markdown 解析出五派并保留独立优势小节 (1.2131ms)
✔ 无格式文本解析降级，不抛异常；编号标题与空字段可用 (0.5218ms)
✔ 解说只发一次 user 消息，原样保留文本，严格复用附录 prompt (0.2281ms)
✔ 解说失败和不可解析格式均不阻断构建 (2.0976ms)
✔ URL 与搜索两条构建通道均只调用一次解说，证据来自展示文本 (0.7232ms)
✔ 不请求 AI 和无回答时均保持完整空值契约 (0.2718ms)
✔ 放生立场由草稿决定，AI 不参与规则分值/风险/建议 (0.5122ms)
✔ 旧缓存只在内存重标，保留已有 AI；演示证据不伪装成机器命中 (0.3728ms)
✔ 无空格的 Markdown 标题仍能解析五派和优势结论 (0.1086ms)
✔ zhidaChat sends both quota and chat HTTP through injected fetchImpl (0.8709ms)
✔ fetchQuota accepts injected fetchImpl instead of touching the network (1.1864ms)
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 261.3099
```

### 改动后（35 绿 = 原有 29 + 新增 6，无一条由绿变红）

```
✔ classifyQuestion covers the four prior types (0.7394ms)
✔ annotates real Zhihu anchors above the required hit rate (3.2769ms)
✔ annotateAll warns when one distribution collapses (0.5115ms)
✔ low evidence text falls back to neutral with explicit low-confidence evidence (0.8908ms)
✔ one sarcasm feature alone is not enough to classify as sarcasm (0.259ms)
✔ adversarial priors dampen all stance signals for string ctx too (0.1494ms)
✔ adversarial hard authority beats dense numbers (0.1875ms)
✔ adversarial strong story beats emotional wording (0.1064ms)
✔ adversarial evidence uses matched text and adjusted weights (0.1706ms)
✔ adversarial stance ignores author and badge text (0.157ms)
✔ adversarial pun and absurd proposal are bounded (0.1529ms)
✔ 路由列出永久预构建缸，无凭证也可复用；演示放生使用本地草稿标签 (184.6717ms)
✔ loadEcoCache loads fresh eco cache and permanent prebuilt tanks from injected dataDir (6.6423ms)
✔ prebuilt tanks are ready forever even when AI narrative is absent (2.495ms)
✔ fresh regular cache without AI narrative is ready until TTL expires (2.5015ms)
✔ regular cache entries with AI narrative are preserved outside the 100 item trim (5.4223ms)
✔ persistEcoCacheEntry can write to an injected dataDir without touching real cache files (2.5043ms)
✔ prebuildTanks checks quota before each uncached tank and stops when quota is insufficient (8.8403ms)
✔ 真实 Markdown 解析出五派并保留独立优势小节 (1.1798ms)
✔ 无格式文本解析降级，不抛异常；编号标题与空字段可用 (0.5553ms)
✔ 解说只发一次 user 消息，原样保留文本，严格复用附录 prompt (0.236ms)
✔ 解说失败和不可解析格式均不阻断构建 (2.6839ms)
✔ URL 与搜索两条构建通道均只调用一次解说，证据来自展示文本 (0.7066ms)
✔ 不请求 AI 和无回答时均保持完整空值契约 (0.3041ms)
✔ 放生立场由草稿决定，AI 不参与规则分值/风险/建议 (0.5325ms)
✔ 旧缓存只在内存重标，保留已有 AI；演示证据不伪装成机器命中 (0.3713ms)
✔ 无空格的 Markdown 标题仍能解析五派和优势结论 (0.1183ms)
✔ fetchHot persists to disk and a cold process serves it with zero network (9.5305ms)          ← 新增
✔ fallback chain: empty memory + empty disk + failing API + snapshot present → snapshot (4.0083ms)  ← 新增
✔ fallback chain: nothing available at all → demo data as last resort (1.7116ms)              ← 新增
✔ search and question-answers caches survive a cold restart via disk (9.8031ms)               ← 新增
✔ offline prebuild turns raw captures into loadable tanks with zero network (11.8599ms)       ← 新增
✔ offline prebuild reruns overwrite instead of appending (5.7411ms)                           ← 新增
✔ zhidaChat sends both quota and chat HTTP through injected fetchImpl (1.4937ms)
✔ fetchQuota accepts injected fetchImpl instead of touching the network (0.6081ms)
ℹ tests 35
ℹ suites 0
ℹ pass 35
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 285.192
```

## 2. `--from-raw` 完整终端输出（8 缸分布）

命令：`cd app/server && node scripts/prebuild-tanks.mjs --from-raw data/raw-tanks.json`

```
SAVE 罗永浩称野人先生冰激凌很一般，野人先生该如何回应这场突发舆情？ species=10 stance={"中立":10} strategy={"数据论证":6,"情绪共鸣":2,"故事叙事":2} enriched=1/10 aiNarrative=false
⚠️ 警告 罗永浩称野人先生冰激凌很一般，野人先生该如何回应这场突发舆情？ :: stance 退化：「中立」占 10/10（≥80%）
SAVE HYROX 北京站比赛选手失禁仍完成比赛，比赛规则和卫生安全引争议，如何看待此事？ species=10 stance={"中立":9,"反对":1} strategy={"故事叙事":1,"抖机灵":2,"数据论证":6,"情绪共鸣":1} enriched=2/10 aiNarrative=false
⚠️ 警告 HYROX 北京站比赛选手失禁仍完成比赛，比赛规则和卫生安全引争议，如何看待此事？ :: stance 退化：「中立」占 9/10（≥80%）
SAVE 男生去年考上北大医学部放弃，2026 年又考进北大图灵班，做到这点有多难？怎样看待他的选择？ species=10 stance={"中立":9,"反对":1} strategy={"情绪共鸣":3,"数据论证":5,"故事叙事":1,"抖机灵":1} enriched=3/10 aiNarrative=false
⚠️ 警告 男生去年考上北大医学部放弃，2026 年又考进北大图灵班，做到这点有多难？怎样看待他的选择？ :: stance 退化：「中立」占 9/10（≥80%）
SAVE 清朝人口为何从1400万迅速长到4亿？呈现爆发式增长，是何原因？ species=10 stance={"中立":9,"反对":1} strategy={"数据论证":10} enriched=1/10 aiNarrative=false
⚠️ 警告 清朝人口为何从1400万迅速长到4亿？呈现爆发式增长，是何原因？ :: stance 退化：「中立」占 9/10（≥80%）
⚠️ 警告 清朝人口为何从1400万迅速长到4亿？呈现爆发式增长，是何原因？ :: strategy 退化：「数据论证」占 10/10（≥80%）
SAVE Anthropic 掌门人呼吁放缓 AI 模型迭代，马斯克、奥尔特曼响应，此举背后出于哪些考量？ species=10 stance={"中立":9,"支持":1} strategy={"数据论证":5,"引用权威":1,"抖机灵":2,"身份站队":1,"情绪共鸣":1} enriched=3/10 aiNarrative=false
⚠️ 警告 Anthropic 掌门人呼吁放缓 AI 模型迭代，马斯克、奥尔特曼响应，此举背后出于哪些考量？ :: stance 退化：「中立」占 9/10（≥80%）
SAVE 职场上为什么有能力的人爬不上去？ species=10 stance={"中立":7,"解构":1,"反对":2} strategy={"数据论证":8,"故事叙事":1,"情绪共鸣":1} enriched=0/10 aiNarrative=false
⚠️ 警告 职场上为什么有能力的人爬不上去？ :: strategy 退化：「数据论证」占 8/10（≥80%）
SAVE 预感将被裁员且能力不足，该主动辞职吗？ species=10 stance={"中立":7,"反对":3} strategy={"故事叙事":2,"数据论证":7,"情绪共鸣":1} enriched=2/10 aiNarrative=false
SAVE 为什么酒店标间两张床的价格反而会低于一张床的大床房的价格，这背后的定价逻辑是什么？ species=10 stance={"中立":8,"支持":2} strategy={"数据论证":9,"抖机灵":1} enriched=0/10 aiNarrative=false
⚠️ 警告 为什么酒店标间两张床的价格反而会低于一张床的大床房的价格，这背后的定价逻辑是什么？ :: stance 退化：「中立」占 8/10（≥80%）
⚠️ 警告 为什么酒店标间两张床的价格反而会低于一张床的大床房的价格，这背后的定价逻辑是什么？ :: strategy 退化：「数据论证」占 9/10（≥80%）
{
  "total": 8,
  "saved": 8,
  "failed": 0,
  "warnings": [ ...9 条退化警告，同上... ],
  "message": "offline prebuild complete: saved=8 failed=0"
}
```

### 分布判读（你要的「标注有没有退化」）

**结论：管线没有退化，但 stance 词典在这批真实热榜语料上明显欠拟合——6/8 缸触发立场退化警告。**

- 8 缸全部 10 物种、`aiNarrative=false`（预期，直答额度为 0，不是失败）。
- **立场**：6 缸「中立」占比 8–10/10。抽查第 1 缸：10 个物种 `confidence` 全为 0，evidence 均为「特征不足」——即不是标注器判错，而是 stance 词典几乎没命中，全部走了「低置信回退中立」。对明显带立场的文本直接单测 `annotateOne`（如「不需要任何公关，搭理他干嘛……」「罗这种顺杆爬的人不能惯他」）同样返回 `中立/confidence 0`。上一轮验收只保证锚点语料命中率，这批真实语料的表态方式（口语化劝诫、阴阳、反话）不在词典里。详见第 5 节问题①。
- **策略**：相对健康。8 缸均有 2–4 类，但「数据论证」系统性偏多（2 缸 ≥80%），主因是数字密度特征 `/\d+/` 权重 0.9 而阈值仅 0.35，真实回答里年份/数量词很密。
- **富化命中低**：enriched 0–3/10。`question_answers` 的 Summary 与搜索结果摘要都带各自的截断省略，LCS ≥20 连续字很难达成——能量（赞同数）大多按热序近似，前端展示时注意。

### key 一致性验证（`hashKey(question + '|' + url)`）

```
ready tanks: 11
HIT 1853516810 罗永浩称野人先生…  prebuilt=true
HIT 4259163695 HYROX 北京站…     prebuilt=true
HIT 2759175480 男生去年考上北大…  prebuilt=true
HIT 2262451224 清朝人口…         prebuilt=true
HIT 2125468569 Anthropic…        prebuilt=true
HIT 2653567048 职场上为什么…      prebuilt=true
HIT 2498273903 预感将被裁员…      prebuilt=true
HIT 3436309438 为什么酒店标间…    prebuilt=true
```

端到端复核：另起新实例（PORT=8790，新代码，真实 data/），`POST /api/ecosystem` 第 1 个问题返回 `cached: true | species: 10 | aiNarrative: null | dataSource: question_answers` —— 预构建缸被精确命中，未走构建管线。`/api/tanks` 列出 11 个就绪缸（8 个预构建 + 3 个既有）。

## 3. 离线模式零网络的证明

1. **结构层面**：`prebuildFromRaw` 不调用 `fetchQuota`/quota 守卫；给 `buildEcosystem` 注入 `search`/`answers` 两个替身（数据全部来自 `raw-tanks.json`），并传 `includeAi: false` —— `explainEcosystem` 在 `includeAi === false` 时直接返回空契约，`zhidaChat` 根本没有被调用的代码路径。`ecosystem.js` 接口零改动。
2. **测试层面**：`test/prebuild-offline.test.mjs` 注入 `throwingFetch = () => { throw new Error('offline mode must not touch network') }`，2 条构造 raw 全程跑完不抛异常即证明零网络；断言 key === `hashKey(question + '|' + url)`、`aiNarrative === null`、物种数 === 输入回答数、重跑覆盖不追加。
3. **真实运行层面**：第 2 节的真实运行与 PORT=8790 端到端复核均未发起任何上游请求（8790 实例日志干净；且命中的是预构建缓存，构建管线未执行）。

**必须如实披露的一次意外**：第一次做 8790 端到端复核时，我用 Git Bash 内联 `curl -d "{\"question\":\"中文…\"}"`，Windows 下 curl 把 UTF-8 中文转成乱码，服务端收到的 question 是乱码 → key 与预构建不符 → cache miss → **真实构建管线被执行，消耗了 1 次 `question_answers` 和 1 次 `zhihu_search` 额度**（今日各余 2 → 各余 1；直答 0 消耗、热榜 0 消耗）。乱码 key 的缸落在了 `eco-cache.json` / `search-cache.json`（均为 gitignore 的运行时缓存，未入库）。改用 `--data-binary @文件`（node 写 UTF-8 文件）后复测命中 `cached: true`，未再消耗。前端浏览器发请求无此问题，这是本机 curl 的编码坑。

## 4. 热榜降级链实测证据

降级链实现为 **内存 → 磁盘（hot-cache.json）→ 真实 API → 快照（hot-snapshot.json）→ 演示数据**。用生产代码 `fetchHot` + 注入「调用即抛异常」的 fetch 替身实测（零网络）：

```
场景1 快照兜底: source=snapshot snapshotAt=2026-09-13T16:59:15.633Z items=30
场景2 磁盘恢复: cached=true stale=false source=live items=30        ← 全新模块实例（模拟冷启动）从磁盘恢复
场景3 stale磁盘优先于快照: stale=true title=过期真实热榜              ← 过期真实数据仍优先于快照
场景4 演示兜底: source=demo items=8                                  ← 全都没有才落到虚构演示
```

对应自动化断言见 `test/hot-persist.test.mjs`（磁盘写入、冷启动零网络命中、snapshot 腿带 `source:'snapshot'`+`snapshotAt`、演示腿）。

**快照采集**：`node scripts/snapshot-hot.mjs` → 首选读 `hot-cache.json`（尚不存在），自动退到 `curl http://localhost:8787/api/hot`（本机 12h 缓存，`upstreamSource=live`，**未打上游**），写入 `data/hot-snapshot.json`：30 条真实热榜，`snapshotAt=2026-09-13T16:59:15.633Z`。脚本会拒绝把 `source:'demo'` 的演示数据存成快照（诚信红线）。该文件不在 `.gitignore`，可入库；`hot-cache.json` / `search-cache.json` / `qa-cache.json` 三个运行时缓存已加入 `.gitignore`。

**附带的行为变更（主动说明，非暗改）**：`fetchHot` 现在把「API 返回空列表」（额度耗尽时官方的实际表现）当作失败继续走兜底链，而不是当作成功结果返回——否则空列表会覆盖内存缓存且前端只能看演示。`index.js` 里原有的空列表 → 演示降级分支保留，互为冗余。

**搜索/问答缓存**：`search-cache.json` / `qa-cache.json` 与 eco-cache 同机制落盘（`[{k,ts,data}]`，各自 TTL 不变，100 条封顶），内存 miss 先查磁盘再发 API。第 3 节那次意外构建留下的两个文件正好实证了写盘路径可用。

## 5. 发现但未修的问题（按铁律只报告）

1. **【重要】annotator stance 词典对真实热榜语料欠拟合**：8 缸 stance 6 缸坍缩为「中立」，单测明显带立场的真实回答也是 `中立/confidence 0/evidence 特征不足`。根因是词典按上一轮锚点语料调校（阈值 1.15 + 低置信强制回退中立），口语化表态（「搭理他干嘛」「不能惯他」「搁这要优惠券呢」）无对应特征。策略侧的 `/\d+/` 数字密度权重也让「数据论证」系统性偏多。这直接影响评审当天 8 个演示缸的立场分布观感，建议下一轮优先处理（我只报告未修）。
2. **【已不得不修，特此报备】`prebuild-tanks.mjs` 的 CLI 主入口守卫在 Windows 永不生效**：`import.meta.url === \`file://${process.argv[1]}\`` 在 Windows 上因盘符+反斜杠恒为 false，`node scripts/prebuild-tanks.mjs …` 实际什么都不执行。这不修任务 A 的命令根本无法交付，故改为 `pathToFileURL(path.resolve(argv1)).href` 比较（`snapshot-hot.mjs` 同款）。如这算越权，可从 `.bak2` 还原。
3. **富化（赞同数）命中率低**：0–3/10，LCS ≥20 连续字对两套各自截断的摘要太苛刻，能量大多退化为热序近似。
4. **Windows/Git Bash 下 curl 内联中文 JSON 会变乱码**（环境坑，非代码 bug），已导致一次意外额度消耗（见第 3 节披露）。建议团队在本机验证一律用 `--data-binary @file`。
5. `fetchHot` 的 `dedup('hot', …)` key 不含 `dataDir`：同一进程内用两个不同 dataDir 并发调 fetchHot 会互相等对方的结果。当前所有调用点（index.js、测试）都不触发，仅记录在案。

## 6. 合规自检

- 未 commit / add / stash；`git status --porcelain` 仅见上述 4 个修改 + 新文件。
- 未改 `app/server/test/` 既有 5 文件、未改 `app/web/`、未动 `.env`、未删任何 `*.bak.2026-09-13`；改动文件均已先存 `.bak2.2026-09-13`。
- 未新增 npm 依赖。
- 额度消耗：直答 0、热榜 0；搜索/问答各意外消耗 1 次（第 3 节已披露），其余全部为本地缓存/离线数据。
