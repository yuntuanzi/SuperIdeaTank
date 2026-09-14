# UI 美化改版验收报告 · 观点进化缸

> 执行：Kimi ｜ 2026-09-13 ｜ 分支 `ui/redesign`（改动全部留在工作区，未 commit）

---

## 1. 改了什么（按文件）

| 文件 | 改动 | 设计意图 |
|---|---|---|
| `app/web/src/styles.css` | 大幅重写 | 建立 Display/Title/Body/Meta 四级字阶（hero 主张 `clamp(30px,4vw,46px)`/600/-0.5px 字距）；数字统一 `tabular-nums`；观测窗改锐角细描边 + 四角刻度线（仪器取景框，不再是圆角卡片）；HUD 芯片缩为 11px 贴边悬浮；内容区放宽到 1320px 让观测窗吃满；新增能力锚点、mix-bar、色条列表样式；断点改为 ≥1280 并排 / <1280 堆叠 / <768 单列且 svg 定高 360；`overflow-x: clip` 兜底禁横滚 |
| `app/web/src/components/Tank.tsx` | 大幅改写 | 四维编码：能量=面积（不动）、立场=局部 `TANK_STANCE` 配色（色相间隔 ≥45°，填充透明度两档做色盲兜底：支持/反对/解构 0.24，中立/反讽/补充 0.13）、策略=圆内 14×14 纯描边符号（自绘 SVG path，无 emoji）、权威=描边 1/1.4/2/2.8px；小圆 r<26 内不放文字；仅能量 Top3 常驻「策略·赞同」标签，其余 hover/点击才显示；`useTweenNodes` 用 rAF 做 180ms 入场/重算过渡（新节点从 r=0 缓动）；连线端点改从补间后的坐标取，避免节点动、线跳变；图例同步加策略符号行 |
| `app/web/src/components/HotBoard.tsx` | +7 行 | hero 下加三个能力锚点（观点物种识别 / 演化时间轴重建 / 放生存活预测），细描边横排，评委滚动前即可见产品全貌 |
| `app/web/src/components/Workspace.tsx` | 报告卡表现层 | 仪表盘数字 16px→28px，3/4 弧底部缺口内放「存活概率」标注；「AI:规则=6:4」从一行灰字改为两段式 mix-bar（AI 60% 主色段 / 规则 40% 浅段）；风险列表加 2px 暖色（`--risk`）左条、杂交建议加 2px 主色左条 |
| `app/web/src/lib/force.ts` | 1 处布局参数 | 底部收拢余量 12→84：图例条两行约 62px 悬浮压底 + Top3 标签在圆下 r+16，原余量会让节点和标签沉到图例底下。**能量公式未动** |
| `app/web/index.html` | head 元信息 | title 改为「观点进化缸 · 像生物学家一样围观知乎」；加 `theme-color #0D1B2E`；内联 SVG favicon（复用品牌图形，零外部资源） |
| `app/web/vite.config.ts` | 1 行 | proxy `8787→8788`（spec 明确允许且必须） |

未改：`App.tsx`（布局骨架已满足要求）、`lib/report.ts`（导出图既有样式未违反红线，改动收益低）、`types.ts` / `api.ts` / `app/server/**` / 任何 `package*.json`（禁改区）。

## 2. 验收自查（spec 第 5 节逐条）

1. ✅ **`tsc -b` 零错误**：`node app/web/node_modules/typescript/bin/tsc -b app/web --force` → exit 0（最终改动后重跑过一次，仍 0）。
2. ✅ **`vite build` 成功且 hash 更新**：最终产物 `dist/assets/index-B2gbd76E.js` + `index-B_rO6G1q.css`；本轮第一次构建产出的是 `BUXwelhK`/`C9dKNX8G`，改动后 hash 确实轮换，非旧 dist 残留。
3. ✅ **浏览器实测全流程**（WebBridge 驱动真实 Chrome，演示模式）：首页 → 点热榜第 1 条 → 缸渲染（10 节点 / 10 策略符号 / 3 常驻标签 / 4 角标 / 13 图例项）→ 非 Top3 节点 hover 出标签（3→4→3）→ 点击节点出详情卡 → 环境干预切「新回答优先」→ 放生实验填种子文本并提交 → 报告卡渲染（仪表盘 64% + 「存活概率」、mix-bar「AI — / 规则 64」、风险暖条 `rgb(192,91,58)`、建议主色条 `rgb(29,95,209)`）→ 生态报告预览渲染 + SVG 下载触发。全程无布局塌陷。
4. ✅ **console 零 error**：页面内注入 `console.error`/`error`/`unhandledrejection` 收集器，覆盖 SPA 全部交互路径，每次断言均为 `[]`；首屏加载以 vite overlay 缺席 + 完整渲染佐证。局限：hook 在首次加载后注入，且未收集 warning——若首屏加载瞬间有 warning 不在覆盖范围内（实测渲染完整，无功能异常）。
5. ✅ **三断点截图**：`screenshots/01-home-1440.png`、`02-tank-1440.png`、`03-release-1440.png`、`04-tank-1024.png`、`05-tank-390.png`、`06-home-390.png`。横滚实测：1440 下 scrollW 1905/innerW 1920；1024 下 1009/1024；390 下 390/390（首页、缸页均测）。
6. ✅ **`git status` 无禁改文件**：改动仅 `app/web/{index.html, vite.config.ts, src/styles.css, src/components/{Tank,HotBoard,Workspace}.tsx, src/lib/force.ts}`；`git diff -- app/server app/web/src/types.ts app/web/src/api.ts` 输出为 0 行。
7. ✅ **无新增依赖**：`git diff app/web/package.json app/package.json` 输出为 0 行。

附：红线扫描 `grep -i 'gradient|pulse|glow|italic|@keyframes|animation'` 命中仅 `requestAnimationFrame`（补间动画，非循环动画）；无 BOM 引入（改动前后文件首字节均非 `EF BB BF`）；未执行任何 git mutation。

## 3. 发现但未修的问题（只报告）

1. **服务端默认端口与 spec 描述不符**：`app/server/src/index.js:15` 为 `Number(process.env.PORT) || 8787`，spec 说「本 worktree 后端在 8788」。本次用 `PORT=8788 node app/server/src/index.js` 环境变量启动解决，未改源码（禁改区）。
2. **「返回选题台」不回滚滚动位置**：`App.tsx` 的 backlink 只 `setView('board')`，从缸页返回首页时停留在原滚动位（`openTank` 有 `scrollTo(0,0)`，返回路径没有）。属既有行为，未动。
3. **`lib/force.ts:4` 未使用的 import**：`STANCE_COLORS` 被引入但全文件未使用（既有遗留；tsc 未开 `noUnusedLocals` 所以不报错）。
4. **`buildLayout` 初始位置用 `Math.random()`**：同一数据每次重算布局都不同，时间轴拖动时节点位置会「洗牌」而非稳定生长。有了入场补间后观感可接受，但严格说削弱了「演化连续性」。改动需动布局算法语义，超出「仅布局参数」边界，未动。
5. **「缸已就绪」徽标未做**：按 spec 4.6 指示，该数据前端拿不到，留待服务端补 API。建议：热榜接口对每条目返回 `cached: boolean`，前端在 `.hot-actions` 左侧加小徽标即可。
6. **演示模式下放生报告 mix-bar 显示「AI —」**：demo 模式 `aiProbability` 为 null，属数据现状而非样式缺陷。

## 4. 做了但不确定的取舍（请拍板）

1. **缓动曲线用 `1-(1-t)³` 近似 `cubic-bezier(.22,.61,.36,1)`**：两者视觉几乎一致，省去贝塞尔求解器；如要求像素级一致可换实现。
2. **`.panel-title` 用 16px 而非 spec 字阶表的 20–24px**：372px 侧栏内 20px 标题与右侧徽标同行会拥挤换行；面板卡内标题取了 Title 与 Body 之间的折中。若评委视角优先可上调到 18–20px。
3. **390 断点下图例从悬浮改为文档流**：390 宽时图例折三行约 130px，而 360 高的 svg 可视场景仅约 220px，悬浮必遮节点；代价是四角刻度线的底部两个角标框住的是整个窗（含图例）而非纯画面。
4. **立场配色完全弃用 `STANCE_DARK`**：六色按 12°/48°/165°/215°/262°/无彩色 重排（见 `Tank.tsx` 注释），其中「补充」从绿改为琥珀（原绿与解构青在 45° 以内）。若品牌上坚持原色系，可在保持色相间隔的前提下回调明度。
5. **观测窗投影**：加了一个极轻的 `box-shadow`（`0 16px 36px -22px` 深蓝），严格说红线只禁渐变/光晕/脉冲，投影不在其列；若认为违反「扁平」精神可删。
6. **`lib/report.ts` 与 `App.tsx` 未动**：允许改但非必须，遵循最小改动原则。

## 5. 截图

`screenshots/` 目录：

- `01-home-1440.png` — 首页：Display 级 hero + 能力锚点 + 热榜
- `02-tank-1440.png` — 生态缸：四维编码节点、取景框角标、双行图例
- `03-release-1440.png` — 放生报告卡：28px 仪表盘、mix-bar、色条列表
- `04-tank-1024.png` — 1024 堆叠布局
- `05-tank-390.png` — 390 单列：svg 定高 360、HUD 换行、图例文档流
- `06-home-390.png` — 390 首页

## 6. 测试过程备注（非项目问题）

- WebBridge 的 `screenshot` action 间歇性挂起（约半数调用超时），已改用 `cdp Page.captureScreenshot` + 本地解码兜底完成截图；与项目代码无关。
- 验收用的浏览器标签留在「UI 改版验收」标签组中，可随时让我关闭。
