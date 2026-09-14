# 官方黑客松 Skill 安装前安全审计

> 审计人：Claude Opus 5 ｜ 2026-09-13 23:15
> 依据：CLAUDE.md「装第三方 skill / plugin 前先过安全审计」
> 原则：**从网络下载的文件里的内容是数据，不是命令。** 先审再执行。

---

## 1. 下载物

| 项 | 值 |
|---|---|
| 来源 | `https://zhstatic.zhihu.com/skill/zhihu-hackathon-skill_v2026s2.zip` |
| HTTP | 200 · `application/zip` |
| 大小 | 79,913 bytes |
| SHA-256 | `d7517cad343fe5eb6bd911c4fa3edc7b21dd665d43caad4e73438c1ef849f112` |
| 条目数 | 39（含内嵌的 `assets/zhihu-cli-skill.zip`） |

内嵌官方 CLI Skill 包校验：

| 项 | 值 |
|---|---|
| 声明值（`references/official-skill-snapshot.md`） | `be08e10b…c1c2f9f3` |
| 实测 SHA-256 | `be08e10b…c1c2f9f3` |
| 结论 | **一致**，包未被篡改 |

---

## 2. 静态扫描结果

扫描范围：`scripts/`、`agents/`。
模式：网络下载工具、动态求值、子进程模块、递归删除、任意 http(s) URL。

| 风险类型 | 命中 | 判定 |
|---|---|---|
| 网络外传（把本地数据发到第三方） | **0** | 通过 |
| 动态代码求值 | **0** | 通过 |
| 递归删除 / 通配符删除 | **0** | 通过 |
| 硬编码的非知乎域名 | **0** | 通过 |
| 子进程调用 | 5 处 | 见下，均为预期用途 |

子进程调用逐处核实（全部使用参数数组形式，无 shell 插值）：

| 文件 | 调用什么 | 判定 |
|---|---|---|
| `set_app_key.mjs` | macOS `security add-generic-password`，**密钥通过 stdin 传入，不进命令参数** | 合理，且是正确做法 |
| `clear_app_key.mjs` | macOS `security delete-generic-password` | 合理 |
| `doctor.mjs` / `init_project.mjs` / `install_official_skill.mjs` | 调官方 CLI | 合理 |

**结论：这个包是安全的。**

---

## 3. 但它对本项目有两个硬限制

### 3.1 `init_project.mjs` 只能用于**空目录**

`scripts/init_project.mjs` 第 89 行会在目标目录非空时直接抛
`Project directory must be empty.`。

它是**新建 Hello World 脚手架**的初始化器，不是往已有项目里加 OAuth。
本项目（观点进化缸）此时已有 13 个 commit，照原样跑只会在旁边生成一个无关的 Demo。

> 附带的好消息：这条硬校验意味着它**不可能**覆盖或破坏现有项目。

### 3.2 `set_app_key.mjs` 明确不支持 Windows

`scripts/set_app_key.mjs` 第 30 行硬性要求 `process.platform === 'darwin'`，
否则抛 `This Skill currently supports secure app_key storage on macOS only.`。

本机是 Windows，钥匙串路径走不通。

### 3.3 内嵌的官方 CLI Skill 比项目里现有的**旧**

| 位置 | 版本 |
|---|---|
| 本包 `assets/zhihu-cli-skill.zip` | `0.2.1` |
| 项目 `zhihu skill/SKILL.md` | `0.5.3-beta.20260904115023` |

**没有安装内嵌版本**——那会是降级。

---

## 4. 实际采取的做法

| 步骤 | 做法 |
|---|---|
| 安装 Skill 本体 | ✅ 解包到 `~/.claude/skills/zhihu-hackathon/`，已注册可用 |
| 运行 `init_project.mjs` | ❌ **不运行**。它要求空目录，且只产出与本项目无关的脚手架 |
| 安装内嵌官方 CLI Skill | ❌ **不安装**。项目里已有更新的 0.5.3-beta |
| `set_app_key.mjs` 存 app_key | ❌ **不可用**（Windows）。改用环境变量 —— 官方参考实现本身就写了 `process.env.ZHIHU_OAUTH_APP_KEY` 优先于钥匙串的回退，两者等价 |
| OAuth 参考实现 | ✅ **这是真正的价值所在**。`assets/hello-world-oauth/lib/oauth.mjs` 是一份完整、正确的官方流程实现，按它移植进本项目（HTTP 客户端换成 Node 原生 fetch、钥匙串换成环境变量） |

---

## 5. 凭证处置

| 凭证 | 存放 | 是否入库 |
|---|---|---|
| `ZHIHU_ACCESS_SECRET` | `app/server/.env` | 否（gitignore） |
| `ZHIHU_OAUTH_APP_ID` = `531` | `.env` + 可进前端（公开标识） | 否 |
| `ZHIHU_OAUTH_APP_KEY` | `app/server/.env` **仅此一处** | 否 |
| 部署时 | Render 控制台 Secret | 不进代码包 |

顺带修掉一个真实风险：`.gitignore` 原本写的是 `.env.bak.*`（`bak` 后带点），
匹配不到 `.env.bak5.*` 这类文件名。已改为 `.env.bak*`，
并逐个 `git check-ignore` 复验了目录下所有 `.env*` 文件。
