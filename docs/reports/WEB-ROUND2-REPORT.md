# WEB-ROUND2-REPORT · 前端第二轮交付报告

> 执行：Kimi ｜ 2026-09-13 ｜ 工作区 master，未 commit / add / stash
> 基线遵守：未改 `app/server/**` 任何文件；未改 `app/web/src/types.ts`；未新增依赖；
> 所有改动的既有文件均已先存 `<文件名>.bak3.2026-09-13`。

---

## 1. 改了什么（按文件 + 设计意图）

### `app/web/src/lib/force.ts`（.bak3 已存）—— 【最高优先级】能量标度 bug

- 根因：`maxVotes` 算了没用，`votesPart = s.votes ?? heatRank/maxHeat` 把赞同数原值（880）
  和归一化热序值（0~1）两种量纲混进同一公式，`maxEnergy≈880` 把未富化节点全部压到
  `√(1/880)≈0.034` → 半径贴下限，「一颗恒星加九颗尘埃」。
- 修法（严格按 spec）：两种来源各自归一化到 0..1 再进公式——
  `s.votes != null ? s.votes / maxVotes : (s.heatRank ?? 0) / maxHeat`。
  对有赞同数的节点这是线性缩放，**相对大小关系不变**（真实数据保真，spec 红线 4）。

### `app/web/src/lib/questionType.ts`（新增）—— 问题类型判定

- 服务端 `annotator.js` 的 `QUESTION_PATTERNS` / `classifyQuestion` 的**前端副本**
  （判断型 / 归因型 / 求解型 / 开放型），文件头注释已注明两边同步的要求。
  服务端不透出问题类型且不许改，A1/A3 都依赖它，只能在前端复刻同一套句式规则。
- 附带 `isExplanationType()`：归因/求解型 = 立场维度不成立的两类。

### `app/web/src/components/Tank.tsx`（.bak3 已存）—— 缸内可视化的主体改动

- **虚线内环**（spec 2.2）：`votes == null` 的节点加 1px 低透明度 `strokeDasharray="3 3"` 内环，
  与真实赞同换算的半径在视觉上可区分；图例加「虚线内环 = 无公开赞同数，按热序近似」。
- **色轴自适应（A1）**：归因/求解型缸节点改按**生存策略**上色。新增 `TANK_STRATEGY` 六色
  （色相 12/60/120/180/240/300，间隔 ≥45°，低饱和半透明填充 + 亮描边，透明度分两档做
  色盲明暗兜底，质感与既有立场色一致）。策略色轴下圆内符号改为立场首字（仅非中立时），
  文字位显示策略名；缸顶加小字「本题为归因型提问，不预设对立立场 —— 颜色按生存策略编码」；
  图例主标题改为「颜色 = 生存策略（本题不预设对立立场）」。
- **零证据策略 → 未识别态（A2）**：`isStrategyUnidentified()`（evidence.strategy 为空或
  首条 term 为「特征不足」；demo 预设标签除外）。未识别节点不画策略符号、外描边改细虚线
  `4 4`（与内环区分）、颜色回落无彩色（策略色轴下无可编码值）；HUD 加「未识别 N」计数；
  图例加「虚线外描边 = 未识别出显著生存策略」；节点标签与 tooltip 显示「未识别」而非
  兜底的假「数据论证」。
- **低置信角标（spec 3）**：`confidence < 0.15` 的节点右上角加空心小问号（灰蓝，不用红色）；
  详情卡标题旁加 `低置信` 徽标（badge-warn 样式族）+ 诚实文案
  「特征不足，已回落为中立 · 不代表该回答真的中立」。
- **判定依据块（spec 3）**：详情卡 meta-line 下方新增 `EvidenceBlock`——命中词 + 权重 +
  按行内最大权重归一的纯色细条（无渐变），立场/策略各最多 5 条；占位词「特征不足」
  过滤掉不带条展示；来源标注三态：`本地可解释模型 · 零 API 消耗` /
  `演示预设标签 · 非机器判定` / `标注缺失 · 无判定来源`。
  （摘要高亮命中词为加分项，按 spec「做不了就算了，不重构摘要渲染」未做。）

### `app/web/src/components/Workspace.tsx`（.bak3 已存）—— AI 生态解说区块（spec 4）

- 右栏四个 tab 之外、panel-card 下方常驻 `NarrativeBlock`，填掉 1440 下右栏空白。三态：
  - ① `aiFactions` 非空：派系卡片纵排（大号 tabular-nums 序号，与热榜编号同风格族）+
    「谁占上风」区块 + 底部小字「由知乎直答生成 · 与左侧逐条标注为两条独立路径，可互相印证」；
  - ② 只有原文：`AI 解说原文（结构解析未命中）」标注 + `white-space: pre-wrap` 原文；
  - ③ 无解说：如实显示「今日直答额度已用尽……左侧逐条标注不受影响」，
    有 `aiNarrativeError` 时附小字真实原因。不隐藏、不放假内容。

### `app/web/src/App.tsx`（.bak3 已存）—— 告警措辞 + 三态来源徽标

- **annotationWarning 告警条（spec 5 + A3）**：缸标题下方 `.warn-banner` 常驻展示，不藏。
  措辞按问题类型分情况：归因/求解型 + 立场告警 → 改写为
  「本题为归因型提问，回答以解释为主而非站队 —— 立场维度参考价值有限」
  （不说「标注可信度低」，那不是事实）；判断/开放型立场告警与策略告警一律原样显示。
- **数据来源徽标三态（spec 7）**：`实时 · 知乎开放平台`（live 且非缓存）/
  `缓存 · 采集于 {时间}`（live 且 cached，含预构建缸，新增蓝灰 `.cache` 样式）/
  `热榜快照 · 采集于 {snapshotAt}` / `演示数据集 · 未接入开放平台`。
  缸视图取 `eco.cached/createdAt`，选题台取 HotBoard 上报的热榜元信息——
  「真实历史缓存」与「虚构演示数据」不再共用徽标。

### `app/web/src/components/HotBoard.tsx`（.bak3 已存）—— 缸已就绪（spec 6）

- 启动时并行请求 `GET /api/tanks`，按问题 id（从 URL 提取，抗格式漂移）匹配热榜条目；
  命中项标题旁加绿色描边芯片「缸已就绪」，并排入列表最前；
  `.section-head` hint 追加「标『缸已就绪』的问题为赛前预构建，点开秒出、不消耗接口额度」；
  `/api/tanks` 失败静默降级（无徽标、不改排序、不报错）。
- 新增 `onMeta` 上报热榜 `source/cached/fetchedAt/snapshotAt` 给 App 顶栏徽标用。

### `app/web/src/api.ts`（.bak3 已存）

- `hot()` 响应类型补上 `source: 'snapshot'` / `snapshotAt` / `warning`（服务端兜底链本就会透传）；
  新增 `tanks()`。

### `app/web/src/styles.css`（.bak3 已存）

- 新增：`.source-badge.cache`、`.ready-badge`、`.axis-note`、`.legend-title`、
  `.evidence-block` 一族（`.ev-head/.ev-row/.ev-bar…`）、`.narrative-block` 一族
  （`.faction/.faction-idx/.faction-dominant/.narrative-raw/.narrative-empty`）。
  全部遵守设计红线：无渐变、无霓虹光晕、无脉冲动画、无斜体、无大面积纯白块。

---

## 2. 能量 bug 修复前后对比（同一真实缸：胖东来 10 物种）

- 修复前：`docs/evidence/round2-energy-before.png`
  —— 1 个大圆（880 赞同），其余 9 个全部同样最小尺寸。
  （拍法：临时换回 `.bak3` 旧 force.ts + `vite dev`（/api 代理 8787），拍完即还原并重建，
  还原后 bundle hash 与最终交付一致。）
- 修复后：`docs/evidence/round2-energy-after-1440.png`
  —— 10 个节点半径层次清晰：880 赞同最大，热序 9/8/7… 依次递减可辨；
  未富化节点带细虚线内环，图例有两条新虚线条目，HUD 有「未识别 1」。

## 3. 三断点截图（均无横向滚动）

- 1440：`docs/evidence/round2-energy-after-1440.png`（另：`round2-board-1440.png` 选题台）
- 1024：`docs/evidence/round2-tank-1024.png`（scrollWidth 1009 ≤ innerWidth 1024 ✓）
- 390：`docs/evidence/round2-tank-390.png`（scrollWidth 390 = innerWidth 390 ✓，
  图例转文档流、布局堆叠正常）

## 4. 构建与测试

- `cd app/web && node node_modules/typescript/bin/tsc -b . --force` → **exit 0**
- `vite build` bundle hash：**旧 `index-B2gbd76E.js` / `index-B_rO6G1q.css`
  → 新 `index-Il6IaD0U.js` / `index-th0zrlmD.css`**（hash 已变，非旧 dist 残留）
- `cd app/server && node --test "test/*.test.mjs"` → **39 pass / 0 fail**（未受影响）

## 5. AI 生态解说三态截图

- ① 有派系：`docs/evidence/round2-narrative-factions-a3.png`
  （同图可见 A3 归因型告警改写措辞。今日无真实 aiFactions 缸，按 spec 9.5 用浏览器
  fetch 拦截改写响应构造，未改服务端源码与数据文件）
- ② 只有原文：`docs/evidence/round2-narrative-raw.png`（同上构造方式，
  显示「AI 解说原文（结构解析未命中）」+ 保留换行的原文）
- ③ 无解说：`docs/evidence/round2-energy-after-1440.png` 右栏
  （胖东来缸真实状态：`aiNarrative` 为 null，如实显示额度已用尽）

另：`docs/evidence/round2-strategy-axis-why.png`（A1 归因型策略色轴全览）、
`docs/evidence/round2-warning-open-original.png`（A3 另一分支：开放型缸立场告警
原样显示「立场特征稀疏……标注可信度低」）、`docs/evidence/round2-detail-evidence.png`
（详情卡「判定依据」：命中词 + 权重条 + 本地可解释模型标注）。

## 6. 发现但未修的问题（只报告）

1. **缸内 HUD 的 sourceLabel 与缓存状态不一致**：从缓存打开的缸，HUD 芯片仍显示
   「知乎问题回答 · 实时直取」/「知乎搜索 · 实时检索」（`App.tsx` 传 `sourceLabel` 时
   只看 `eco.source/dataSource`，不看 `cached`）。与第 7 节三态徽标的诚信口径有出入，
   但涉及 sourceLabel 语义设计，按「发现 bug 只报告不修」未动。
2. **节点标签与图例条边缘相贴**：`buildLayout` 底部预留 84px，能量最高的节点
   「数据论证 · 10」标签（画在圆下 r+16 处）在 1440 下与两行图例条上沿几乎相切
   （见 `round2-warning-open-original.png` 底部）。不遮节点本体，属既有布局参数问题，未动。
3. **`/api/tanks` 仅列出 3 个缸**（胖东来 10 物种 + 无效加班 4 + 读研 5），
   与「9 个预构建缸」的预期不符；其中两个无 URL，无法通过热榜 id 匹配获得
   「缸已就绪」徽标（只能靠标题搜索框命中缓存）。服务端行为，未动。
4. **无效加班缸一物种 `votes: 0`**：归一化后能量贴下限 0.02，半径最小——
   公式行为正确，但「0 赞同」与「无赞同数按热序近似」在视觉上都接近最小圆，
   仅靠虚线内环区分，评委可能会误读。可在后续轮次考虑文案说明。
5. **WebBridge 元素级截图对滚动后元素裁剪有偏移**（截 `.detail-card` 两次得到的是
   缸区域像素），改用整视口截图规避；与产品代码无关，供后续用浏览器工具链时参考。

## 附：本轮未做

- 摘要命中词高亮（spec 3 加分项，明确允许不做）。
- 任何 `app/server/**`、`types.ts` 改动；任何 git 操作；新增依赖——均无。
