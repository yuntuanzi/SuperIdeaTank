# 派活单 · 接入知乎 OAuth +「我的观点画像」

> 执行模块：Kimi ｜ 工作区：`C:\Users\bokily\dev\super-eco`（主仓 master，改动留工作区）
> 撰写：Claude Opus 5 ｜ 2026-09-13 23:25
> 前置：39 条测试全绿是基线，**不许弄红任何一条**。

---

## 0. 背景与目标

赛事官方明确：「**推荐接入知乎 OAuth，登录人数会作为人气奖评定之一**」。
而 `user_data` 额度 **1000/日**——是所有开放能力里唯一充裕的，评委可以随便玩不会耗尽
（对比：直答 2/日、热榜 2/日、搜索 10/日）。

**要做的功能：「我的观点画像」**

用户授权知乎账号后，读取他**自己的创作**，用本项目已有的 `annotator.js`
（同一套「立场 × 生存策略」模型）分析**他本人**属于哪种观点物种：

> 你在知乎是一个「**数据论证型**」物种。
> 最近 20 条回答里，7 条靠摆数据、5 条靠讲个人经历、3 条靠抖机灵。
> 你最少用的是「身份站队」——这让你在立场对立强的问题下不容易被贴标签，
> 但在需要唤起共鸣的问题下会吃亏。

**为什么这个功能是对的**：它把产品的核心机制（观点物种识别）从「看别人」
转成「看自己」，是天然可分享的内容；而且完全复用已有的标注器，零新增智能层。

---

## 1. 官方参考实现（**事实源，照着改，不要自己发明流程**）

知乎官方黑客松 Skill 已装在：

```
C:\Users\bokily\.claude\skills\zhihu-hackathon\
```

**必读**（按顺序）：

1. `assets/hello-world-oauth/lib/oauth.mjs` —— **完整的 OAuth 参考实现**，这是核心
2. `assets/hello-world-oauth/server.mjs` —— 路由怎么挂
3. `references/oauth-boundary.md` —— 凭证角色与安全边界
4. 项目里的 `zhihu skill/references/hackathon-oauth.md` —— 协议细节
5. 项目里的 `zhihu skill/references/user-api.md` —— 用户数据接口的参数与返回字段

### 协议要点（从参考实现里提取，照做即可）

- **授权地址**：`https://openapi.zhihu.com/authorize?redirect_uri={uri}&app_id={id}&response_type=code&state={random}`
- **回调参数名是 `authorization_code`**（不是 `code`），但要兼容读 `code`
- **换 Token**：`POST https://openapi.zhihu.com/access_token`，
  `application/x-www-form-urlencoded`，字段 `app_id` / `app_key` /
  `grant_type=authorization_code` / `redirect_uri` / **`code`**
  （表单字段名是 `code`，别跟回调参数名搞混）
- **判成功看有没有 `access_token`**，不要只看 `code: 20000`
- **调用户数据接口**要同时带三个头：
  `Authorization: Bearer <Access Secret>` + `X-OAuth-Token: <OAuth token>` +
  `X-Request-Timestamp: <秒级>`。App Key **不能**作为其中任何一个 header。

---

## 2. 必须做的两处平台改造（参考实现是 macOS 专用的）

| 参考实现 | 问题 | 本项目怎么改 |
|---|---|---|
| `keychain()` 调 `/usr/bin/security` | **Windows 没有** | 用环境变量。参考实现本身就写了 `process.env.ZHIHU_OAUTH_APP_KEY \|\| keychain(...)` 的回退，**直接只保留环境变量分支** |
| `runCurl()` spawn `/usr/bin/curl` | Windows 路径不同且没必要 | 改用 Node 内置 `fetch`（项目 Node 24，原生支持）。**保持同样的超时与错误归一化语义** |

凭证已经配好在 `app/server/.env`（已 gitignore）：

```
ZHIHU_OAUTH_APP_ID=531
ZHIHU_OAUTH_APP_KEY=<已配置，不要读取输出它>
ZHIHU_OAUTH_REDIRECT_URI=          ← 留空，等部署后填
```

服务端 `index.js` 已有 `.env` 加载逻辑，直接用 `process.env` 即可。

---

## 3. 要交付的东西

### 3.1 新建 `app/server/src/oauth.js`

从参考实现移植，保留这些行为：

- **会话**：HttpOnly + SameSite=Lax cookie，`randomBytes(24).toString('base64url')`，
  Token 只存进程内存（`Map`），**不落盘**
- **state CSRF 校验**：用 `timingSafeEqual` 定长比较；回调没带 `state` 时不报错，
  但要在 status 里记 `stateVerified: false`
- **Token 过期处理**：`expires_in` 到点清 Token，status 返回 `TOKEN_EXPIRED`
- **`redirectUri` 为空时**：`start()` 抛 `DEPLOYMENT_REQUIRED`，
  文案「本地地址无法完成知乎登录，请先部署应用并配置公网回调地址」
  —— **绝不能把 localhost/127.0.0.1 当成可用回调**

导出：`status` / `start` / `callback` / `logout` / `fetchUserContents`

### 3.2 服务端路由（挂进 `app/server/src/index.js`）

| 路由 | 行为 |
|---|---|
| `GET /api/oauth/status` | 返回 `{configured, callbackConfigured, authorized, appId, redirectUri, profile, stateVerified, expiresAt, error}` |
| `GET /api/oauth/start` | 302 跳转到知乎授权页；未配回调则返回 409 + `DEPLOYMENT_REQUIRED` |
| `GET /auth/callback` | 换 Token → 302 回首页（带 `?oauth=ok` 或 `?oauth=err`）。**注意这个路径不带 `/api` 前缀**，要放在现有 SPA fallback 路由**之前**，否则会被吃掉 |
| `POST /api/oauth/logout` | 清会话 |
| `GET /api/profile/species` | **核心功能**，见 3.3 |

### 3.3 `GET /api/profile/species` —— 我的观点画像

1. 未授权 → 401 `LOGIN_REQUIRED`
2. 调 `GET https://developer.zhihu.com/api/v1/user/contents`
   （`ContentType=all&Limit=20&Offset=0&SortField=ts&SortOrder=desc`）
   拿该用户最近的创作
3. 把每条内容的正文/摘要喂给**已有的** `annotator.js`：
   - 逐条 `annotateOne()`（question 用该内容自己的标题）
   - 统计 stance / strategy 分布
4. 返回：
   ```js
   {
     total: number,               // 实际分析的条数
     dominantStrategy: string,    // 占比最高的生存策略
     dominantStance: string,
     strategyDist: {...},
     stanceDist: {...},
     samples: [{ title, url, stance, strategy, confidence, evidence }],  // 最多 5 条，带证据
     unidentified: number,        // 没识别出策略的条数
     analyzedAt: number,
   }
   ```
5. **结果缓存 30 分钟**（按 session id），避免重复消耗 user_data 额度
6. 内容为空（新号/无公开创作）→ 返回 `total: 0` 并明确文案，**不是错误，也不许编造**

### 3.4 前端

- 顶栏加「**授权知乎账号**」按钮：
  - 未配回调 → 按钮禁用 + tooltip「等待部署后开放」
  - 已授权 → 显示头像/昵称 + 「退出」
- 新增「我的观点画像」视图（可以做成第三个 view，与 `board` / `tank` 平级）：
  - 用**与生态缸同一套配色和策略符号**渲染用户自己的分布
  - 展示 3~5 条样本，每条能展开看判定依据（复用已有的证据组件）
  - 底部一行：`基于你最近 N 条公开创作 · 数据来自知乎开放平台用户数据接口 · 仅你本人可见`
- `total: 0` 时显示「你的公开创作还不够做画像」，不是报错页

---

## 4. 安全铁律（**违反任何一条都是赛事红线**）

- **绝不**在响应体、日志、终端输出、报告、截图里出现
  `app_key` / `access_token` / `authorization_code` / Access Secret 的**任何片段**
- 诊断信息只能说「是否已配置」「长度」「SHA-256 前 8 位」
- OAuth Token 只存服务端进程内存，**不写磁盘、不进缓存文件、不进前端**
- `app_id` 可以进前端（它是公开标识），`app_key` **绝对不行**
- 前端拿到的只有 `authorized: true/false` 和 profile 的展示字段
- 用户必须**亲自**点知乎授权页的最终确认，**不许代点、不许自动化授权流程**

## 5. 流程铁律

- **不许改 `app/web/src/types.ts` 已有字段**（可新增）
- **不许改 `app/server/test/` 下已有的 7 个测试文件**（新测试新建文件）
- 改完必须：
  - `cd app/server && node --test "test/*.test.mjs"` → **原有 39 条 + 新增，全绿**
  - `cd app/web && node node_modules/typescript/bin/tsc -b . --force` → exit 0
  - `node node_modules/vite/bin/vite.js build` → 产出**新 hash**
- **不许真的发起 OAuth 请求做验证** —— 回调地址还没配（等部署），
  而且授权必须用户本人点。测试全部用注入的 fetch 替身喂假响应。
- 不许 git commit / add / stash；不许新增 npm 依赖
- 更新 `app/server/.env.example`，把三个新变量**以空值**列进去并加注释
- 改既有文件前先存 `<文件名>.bak5.2026-09-13`
- 设计红线不变：禁渐变 / 霓虹光晕 / 脉冲动画 / 斜体
- 新增代码块要有解释「**为什么**」的中文注释

## 6. 交付物

工作区根目录写 `OAUTH-REPORT.md`：

1. 改了什么（按文件）
2. 与官方参考实现的**偏离点**逐条列出 + 理由
   （我知道的有两处：钥匙串→环境变量、curl→fetch。如果你还改了别的，说清楚）
3. 全量测试输出（改动前 39 / 改动后 N，全绿）
4. tsc exit code + 新旧 bundle hash
5. 本地截图：未配回调时的「等待部署」态、画像页的空数据态
6. **部署后我需要做的联调清单**（按顺序列出，我照着走）
7. 发现但未修的问题

**不要 commit。**
