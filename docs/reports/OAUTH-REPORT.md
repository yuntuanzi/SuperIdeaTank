# OAUTH-REPORT · 知乎 OAuth 接入 +「我的观点画像」

执行：Kimi ｜ 日期：2026-09-13 ｜ 基线：39 条测试全绿
凭证状态（只说「是否已配置」，不含任何片段）：`ZHIHU_OAUTH_APP_ID` 已配置（531）、
`ZHIHU_OAUTH_APP_KEY` 已配置、`ZHIHU_OAUTH_REDIRECT_URI` 留空（等部署）。

---

## 1. 改了什么（按文件）

**新增**

- `app/server/src/oauth.js` — 从官方参考实现 `hello-world-oauth/lib/oauth.mjs` 移植的
  OAuth 模块。会话（HttpOnly + SameSite=Lax cookie，id 为 `randomBytes(24)` base64url）、
  state 用 `timingSafeEqual` 定长比较、回调没带 state 放行但记 `stateVerified: false`、
  Token 到点清理（status 报 `TOKEN_EXPIRED`）、redirectUri 为空时 start 抛
  `DEPLOYMENT_REQUIRED`。导出 `status / start / callback / logout / fetchUserContents /
  sessionId / record`。OAuth Token 只存进程内存 `Map`，不落盘、不进缓存、不下发前端。
- `app/server/src/speciesProfile.js` — 「我的观点画像」纯函数构建器：把用户每条创作
  喂给**已有的** `annotator.js`（question 用内容自己的标题），统计立场/策略分布、
  取置信度前 5 条样本（带判定依据）、单独计数 `unidentified`（annotator 兜底为
  「数据论证」但零证据的条目**不计入**策略分布，避免虚假放大）。
- `app/server/test/oauth.test.mjs` — 14 条 OAuth 测试，全部用注入的 `fetchImpl` 替身
  喂假响应，不发真实请求；含一条 spawn 真实服务进程的路由级测试（验证
  `/auth/callback` 没被 SPA fallback 吃掉）。所有凭证值都是测试专用假值。
- `app/server/test/profile-species.test.mjs` — 3 条画像构建器纯函数测试。
- `app/web/src/components/ProfileView.tsx` — 「我的观点画像」视图（与 board/tank 平级
  第三个 view）：浅色面板，立场配色复用 `STANCE_COLORS`，策略配色与深色观测窗
  同色相的浅色版，策略符号复用 Tank 的 `StrategyGlyph`；样本可展开看判定依据
  （复用 evidence-block 的 CSS 行结构）；`total: 0` 显示「你的公开创作还不够做画像」，
  不是报错页；底部固定一行数据来源说明。
- `docs/evidence/oauth-deploy-pending.png`、`docs/evidence/oauth-profile-empty.png` — 截图。

**修改**（均已先存 `.bak5.2026-09-13`）

- `app/server/src/index.js` — 挂载 5 条路由：`GET /api/oauth/status`、
  `GET /api/oauth/start`（302 跳知乎；未配回调返回 409 + `DEPLOYMENT_REQUIRED`）、
  `GET /auth/callback`（**注册在 SPA fallback `app.get(/^(?!\/api\/).*/)` 之前**，
  否则被 catch-all 吃掉）、`POST /api/oauth/logout`、`GET /api/profile/species`
  （401 `LOGIN_REQUIRED` / 30 分钟按会话缓存 / 空创作返回 `total: 0`）。
  OAuth 路由全部 `Cache-Control: no-store`；登出即作废画像缓存。
- `app/server/.env.example` — 新增三个变量（空值 + 注释）：`ZHIHU_OAUTH_APP_ID` /
  `ZHIHU_OAUTH_APP_KEY` / `ZHIHU_OAUTH_REDIRECT_URI`。
- `app/web/src/types.ts` — 只追加：`OAuthProfile` / `OAuthStatus` / `ProfileSample` /
  `SpeciesProfile`，既有字段未动。
- `app/web/src/api.ts` — 追加 `oauthStatus` / `oauthLogout` / `profileSpecies`。
- `app/web/src/App.tsx` — 顶栏授权区三态（未配回调禁用 + 页面文字「等待部署后开放」/
  可授权跳转 `/api/oauth/start` / 已授权显示昵称头像 + 退出）；「我的观点画像」入口；
  消费 `?oauth=ok/err` 回跳标记。
- `app/web/src/components/Tank.tsx` — 仅给 `StrategyGlyph` 加 `export`（供画像页复用），
  无行为变化。
- `app/web/src/styles.css` — 末尾追加 OAuth 区与画像页样式（无渐变/光晕/脉冲/斜体）。

## 2. 与官方参考实现的偏离点（逐条）

1. **钥匙串 → 环境变量**（spec 指定的平台改造）。删除 `keychain()` 及
   `/usr/bin/security` 调用，只保留参考实现本就有的 `process.env.ZHIHU_OAUTH_APP_KEY`
   分支；Access Secret 同样只走 `process.env.ZHIHU_ACCESS_SECRET`（复用项目既有变量）。
2. **`runCurl(/usr/bin/curl)` → Node 内置 fetch**（spec 指定的平台改造）。保持同样语义：
   总超时用 `AbortController`（换 Token 20s / 用户接口 30s，与 curl `max-time` 一致）；
   curl 未加 `--fail` 时 HTTP 4xx/5xx 退出码仍为 0、body 照样交业务层判 Code，fetch 版
   同样**不检查 `res.ok`**；传输层失败归一化为「网络请求失败」，body 非 JSON 归一化为
   「知乎开放平台返回了无法解析的响应」，与参考实现的错误文案一致。
3. **`status()` 不再返回 `interfaces` 列表**。参考实现的 `userInterfaces` 五接口自检
   数组是给调试页用的；本项目只用到 `contents` 一个接口，spec 3.2 已定义 status 的
   精确字段集，故不下发。
4. **未移植 `runAll()`**（参考实现的五接口连通性自检）。本项目没有对应页面，用
   `fetchUserContents()`（单接口、带完整参数）取代；协议细节（三头鉴权、`Code !== 0`
   判失败、分页参数）与参考实现逐行对应。
5. **`/api/oauth/start` 的 `DEPLOYMENT_REQUIRED` 返回 409 JSON，而不是 302 回首页**。
   参考实现对所有 start 错误一律 302 `/?oauth=error`；spec 3.2 明确要求未配回调返回
   409 + 错误码，让前端停在原页并置灰按钮——本地预览时跳回首页会让用户误以为授权失败。
6. **回跳参数名 `?oauth=ok/err` 替代参考实现的 `?oauth=success/error`**。spec 3.2 的
   路由表明确指定，语义相同。
7. **Web 框架从裸 `http` 换成项目已有的 Express**。`session()` 内仍用
   `setHeader('Set-Cookie', …)` 写 cookie，行为等价；cookie 名 `zhihu_hackathon_session`
   保持不变。
8. **新增 `sessionId()` 导出**（参考实现没有）。画像缓存要按会话做 key，路由层只需要
   会话 id 而不应接触会话内部的 token 字段，故单独暴露。
9. **画像策略分布不计入「兜底策略」条目**。这是本项目画像语义的新增规则（annotator
   对零证据文本兜底返回「数据论证」），与参考实现无关，记录在此便于评审。

协议行为（授权 URL 参数、回调参数名 `authorization_code` 兼容 `code`、Token 表单字段
名 `code`、判成功只看 `access_token`、三头鉴权、profile 拉取失败不阻断主流程）与参考
实现逐行一致，无偏离。

## 3. 全量测试输出

命令：`cd app/server && node --test "test/*.test.mjs"`

- 改动前：tests 39 ｜ pass 39 ｜ fail 0
- 改动后：tests 56 ｜ pass 56 ｜ fail 0（新增 17：oauth.test.mjs 14 + profile-species.test.mjs 3）

```
ℹ tests 56
ℹ pass 56
ℹ fail 0
ℹ duration_ms 275.4
```

覆盖要点：start 生成授权 URL 参数齐全；换 Token 表单字段名为 `code`、grant_type 固定值；
用户接口三头齐全且 app_key 不出现在任何 header；回调无 state → `stateVerified: false`；
state 不匹配拒绝换 Token 且**零出站请求**；`code: 20000` 但无 `access_token` 判失败；
Token 过期清理；登出清理；status 序列化后不含任何（假）凭证片段；网络失败/非法 JSON
的错误归一化；`/auth/callback` 在 SPA fallback 之前命中（302 而非 200 HTML）；
未配回调时 start 409、species 401。

## 4. tsc + bundle hash

- `cd app/web && node node_modules/typescript/bin/tsc -b . --force` → **exit 0**
- `node node_modules/vite/bin/vite.js build` 成功，产物 hash 变化：
  - JS：`index-Il6IaD0U.js`（旧）→ `index-D-cTONLO.js`（新，196.99 kB / gzip 67.28 kB）
  - CSS：`index-th0zrlmD.css`（旧）→ `index-DGJTBtu4.css`（新，17.21 kB / gzip 4.15 kB）

## 5. 本地截图

- 未配回调的「等待部署」态：`docs/evidence/oauth-deploy-pending.png`
  （顶栏「授权知乎账号」按钮禁用 + 可见文字「等待部署后开放」，真实服务、真实 .env 状态）
- 画像页空数据态：`docs/evidence/oauth-profile-empty.png`
  （已授权顶栏态 + 「你的公开创作还不够做画像」+ 底部数据来源行。本地无公网回调无法
  真授权，此图用一次性桩服务渲染：画像数据由真实的 `buildSpeciesProfile([])` 生成，
  只桩掉会话；桩文件已删除，不在交付内）

截图经由 Kimi WebBridge 在用户浏览器中完成，标签页收在分组「OAuth 功能验证截图」，
不需要可自行关闭。

## 6. 部署后联调清单（按顺序）

1. 部署到 Render（现有 `render.yaml`/`Dockerfile` 流程），拿到公网 HTTPS 域名。
2. 在赛事页面登记回调地址：`https://<你的域名>/auth/callback`（协议、域名、路径、
   尾部斜杠都必须与即将配置的值**完全一致**）。
3. 在部署平台的 Secret/环境变量里配置三项：`ZHIHU_OAUTH_APP_ID=531`、
   `ZHIHU_OAUTH_APP_KEY`（从本地 `.env` 原样搬，不要经过聊天/截图传输）、
   `ZHIHU_OAUTH_REDIRECT_URI=https://<你的域名>/auth/callback`；确认
   `ZHIHU_ACCESS_SECRET` 也在（画像接口要用它做调用方鉴权）。
4. 打开站点 → `GET /api/oauth/status` 应返回 `configured: true,
   callbackConfigured: true`；顶栏按钮从禁用变为可点。
5. 本人点击「授权知乎账号」→ 跳知乎授权页 → **本人亲自点确认** →
   跳回 `/?oauth=ok`，顶栏显示知乎昵称/头像。
6. 进入「我的观点画像」：应看到分布图 + 样本 + 判定依据；若为全新账号则看到
   「你的公开创作还不够做画像」空态（正常）。
7. 连点两次画像：第二次应带 `cached: true`（30 分钟会话缓存生效）。
8. 点「退出」→ status 回到 `authorized: false`，再进画像页应回到授权引导态。
9. 抽查状态页 `stateVerified`：知乎实测回调可能不带 `state`，若为 `false` 属已知
   协议缺口（官方文档有记录），不是 bug。
10. 若回调跳回 `/?oauth=err`：用同一浏览器再访问 `/api/oauth/status` 看 `error.code`
    （常见：`STATE_MISMATCH` = 换了浏览器/会话丢了；`CODE_MISSING` = 回调地址与登记值
    不一致）。

## 7. 发现但未修的问题

1. **会话无上限无清扫**：`sessions` Map 只增不减，每个访客（含不授权的）都会建一个
   空会话。黑客松流量下无虞，上线前建议加 LRU/定期清扫。
2. **Cookie 未加 `Secure`**：本地 HTTP 预览需要它不带 Secure；部署到 HTTPS 后建议
   按 `req.secure` 动态加，或平台终止 TLS 后由反代补。
3. **画像样本的 `question` 语境**：回答的标题通常就是它所属的问题标题，但文章/想法
   的标题不是「问题」，annotator 的问题类型先验对这类内容按 `open` 处理，立场判定
   会比回答更保守。属模型边界，不影响正确性。
4. **`/api/oauth/start` 在 `APP_KEY_REQUIRED` 等非 DEPLOYMENT_REQUIRED 错误时 302 回
   `/?oauth=err`**：本地只读 `.env` 的场景下与参考实现一致，但前端无法区分错误码；
   错误细节可从随后的 `/api/oauth/status` 拿到，故未单独处理。
5. **`httpJson` 的超时路径未被真实时钟测试覆盖**（20s/30s 等不起）：AbortController
   逻辑简单直译，错误归一化分支已由注入失败替身覆盖；如需严格验证可注入
   「监听 signal 后 reject AbortError」的替身，留待后续。
