# 上线部署方案 · 观点进化缸

> 撰写：Claude Opus 5 ｜ 2026-09-13
> **赛事硬要求**：作品必须有「可公开访问并能实际操作的线上 Demo」，否则初审不过。
> 提交截止 **2026-09-15 10:00**，截止后不接受补交。

---

## 0. 一句话结论

**推荐 Render.com 免费档**（GitHub 登录，不要信用卡，约 5 分钟）。
仓库里已备好 `render.yaml`，连上仓库选 Blueprint、填一个环境变量就完事。

**不要用 Vercel / Netlify / 任何 Serverless。** 理由见第 2 节，这不是偏好问题，是会直接毁掉 Demo 的问题。

---

## 1. 需要你（用户）亲自做的事

我无法代做的只有一件：**在托管平台上登录/授权**。其余全部已经准备好。

| 步骤 | 谁做 | 状态 |
|---|---|---|
| 代码整理、无凭证入库 | Claude | ✅ 已完成 |
| `Dockerfile` / `render.yaml` | Claude | ✅ 已完成 |
| 推送到 GitHub 仓库 | Claude（`gh` 已登录 `ok392637-netizen`） | ⬜ 待你点头（见第 4 节） |
| **在 Render 用 GitHub 登录并授权仓库** | **你** | ⬜ **必须你来** |
| 在 Render 填 `ZHIHU_ACCESS_SECRET` | 你 | ⬜ |
| 把仓库设为 public（选交加分材料） | 你 | ⬜ |

---

## 2. 为什么必须是「长驻进程」，不能是 Serverless

这是本项目最关键的部署约束，写清楚以免后面有人"优化"回去。

本项目每日可用额度（**实测**，远小于官方文档宣称值）：

| 能力 | 日额度 |
|---|---|
| 直答 `zhida_openai` | **2** |
| 热榜 `hot_list` | **2** |
| 知乎搜索 `zhihu_search` | **10** |
| 问题回答 `question_answers` | **10** |

产品靠**五道缓存闸**（内存 TTL 缓存 + 并发去重 + 磁盘持久化 + 直答双层守卫 + stale-while-error）
把这点额度撑成一个可以让评委随便点的 Demo。

**Serverless 的每个实例都是冷启动、无共享内存、无可写磁盘**：

- 热榜缓存失效 → 评委刷两次首页，热榜额度归零
- 生态缸缓存失效 → 评委点两次同一个问题，算两次额度
- 直答本地计数器归零 → 守卫失效

**结论：必须部署成一个长驻的 Node 进程。**

> 补充：即便在长驻进程上，免费档重启也会清空磁盘缓存。
> 所以「演示缸」不能依赖运行时缓存，必须落在
> `app/server/data/prebuilt-tanks.json` 并**随仓库提交**（只读、不受 TTL 影响）。

---

## 3. 方案 A：Render.com（推荐）

### 3.1 步骤

1. 打开 <https://render.com> → **Get Started** → 用 GitHub 登录
2. 授权访问 `super-eco` 仓库
3. Dashboard → **New +** → **Blueprint** → 选中该仓库
   （Render 会自动读取根目录的 `render.yaml`）
4. 在 **Environment** 里填：
   ```
   ZHIHU_ACCESS_SECRET = <你的 Access Secret>
   ```
   > ⚠️ 只填在 Render 控制台，**不要**提交进仓库。
5. **Create** → 等 3–5 分钟构建完成
6. 拿到形如 `https://opinion-evolution-tank.onrender.com` 的公网地址

### 3.2 验收（部署完必跑）

```bash
curl -s https://<你的域名>/api/status
# 期望：{"liveMode":true,...}   liveMode 为 false 说明环境变量没生效
```

浏览器打开首页，走一遍：热榜 → 建缸 → 时间轴 → 干预 → 放生 → 导出报告。

### 3.3 免费档的坑（必须知道）

- **15 分钟无请求会休眠**，下次访问冷启动 **30–50 秒**。
  → 评审当天，在把链接交出去之前**先自己打开一次唤醒**。
  → 或者花 7 美元/月升到 Starter 档，永不休眠。这是最省心的一笔钱。
- **重启会清空磁盘**（`app/server/data/` 里运行时写的缓存会丢）。
  → 所以演示缸必须走随仓库提交的 `prebuilt-tanks.json`。

---

## 4. 方案 B：任意 VPS / 云服务器（Docker）

如果你有自己的服务器（延迟对国内评委更友好，也不会休眠）：

```bash
# 服务器上
git clone <仓库地址> && cd super-eco
docker build -t opinion-tank .
docker run -d --name opinion-tank \
  -p 8787:8787 \
  -e ZHIHU_ACCESS_SECRET='<你的 Access Secret>' \
  -v /opt/opinion-tank-data:/app/server/data \
  --restart unless-stopped \
  opinion-tank
```

挂了持久卷 `-v` 之后，生态缸缓存**跨重启不丢**——这比 Render 免费档更好。

再用 Nginx 反代 + `certbot` 上 HTTPS 即可。
**HTTPS 是必须的**：知乎评委多半从微信/知乎内嵌浏览器打开，纯 HTTP 会被拦或提示不安全。

> 注：本机 `~/.ssh/known_hosts` 里有三台历史主机（`103.79.184.254`、`155.103.159.63`、
> `100.83.150.1`），前两台的 host key 已变更（应该是重装过系统），第三台拒绝密钥认证。
> 我没有可用凭证，所以没动它们。如果你想用自己的服务器，把可登录的那台告诉我即可。

---

## 5. 方案 C：Zeabur（国内友好，备选）

<https://zeabur.com> 支持 GitHub 登录 + 香港区，对大陆访问延迟比 Render 新加坡区更好，
同样是长驻容器。识别根目录 `Dockerfile` 即可部署，环境变量同上。
免费额度有限，如果 Render 冷启动体验不能接受可以换这个。

---

## 6. 明确不推荐

| 平台 | 不推荐原因 |
|---|---|
| Vercel / Netlify Functions | Serverless，无共享内存与可写磁盘 → 缓存失效 → 额度当场烧光（见第 2 节） |
| Cloudflare Workers | 同上，且 Node 运行时兼容性还要额外改造 |
| GitHub Pages | 纯静态，放不下持有 Access Secret 的后端 |
| 本机 + 内网穿透 | 你的电脑一关机 Demo 就死了；评审期跨越两天，风险不可接受 |

---

## 7. 上线后检查清单（对齐赛事官方检查项）

- [ ] 公网地址能打开，核心流程可实际操作（**真机走一遍**，不要用「代码已完成」替代「线上已可用」）
- [ ] `curl /api/status` 返回 `liveMode: true`
- [ ] 前端 bundle 里搜不到 Access Secret：
      `curl -s https://<域名>/assets/index-*.js | grep -c "<secret 前 8 位>"` → 应为 `0`
- [ ] 额度耗尽时页面有**真实的降级提示**，不是白屏也不是假数据冒充实时
- [ ] 「AI 演化重建」「AI 模拟预测」标注在时间轴、放生面板、导出报告三处均在位
- [ ] HTTPS 生效，无混合内容告警
- [ ] 移动端（390px 宽）能正常浏览——评委很可能在手机上点开
