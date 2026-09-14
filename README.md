
<div align="center">

# 超级生态缸
### Opinion Evolution Tank

把一个知乎问题，变成一座可观察、可干预、可放生的观点生态系统。

[![Demo]([https://img.shields.io/badge/Demo-zh.starsalt.cc-blue?style=flat-square](https://img.shields.io/badge/Demo-zh.starsalt.cc-blue?style=flat-square))]([https://zh.starsalt.cc](https://zh.starsalt.cc))
[![Repo]([https://img.shields.io/badge/GitHub-](https://img.shields.io/badge/GitHub-)仓库-green?style=flat-square)]([https://github.com/yuntuanzi/SuperIdeaTank](https://github.com/yuntuanzi/SuperIdeaTank))
[![Hackathon]([https://img.shields.io/badge/](https://img.shields.io/badge/)知乎黑客松-2026校园创新大赛-orange?style=flat-square)]([https://zh.starsalt.cc](https://zh.starsalt.cc))

</div>

---

## 项目简介 📖

知乎把回答按热度排列，却没有告诉我们：为什么某些观点能够留下？

**观点进化缸**把问题下的回答视作生态中的不同物种，将赞同、内容特征、立场、表达策略与权威等级转化为一套可观察的生态模型。用户可以像生物学家一样观察观点如何进入生态位、竞争注意力，并通过改变环境参数，模拟不同规则下的观点演化。

> 赞同是能量，评论是繁殖，热榜是气候突变。
>
> 高赞回答不一定是最正确的，而可能是最适应当时生态位的物种。

## 核心体验 ✨

| 模块 | 能力 |
| --- | --- |
| **热榜选题台** | 从知乎热榜选择问题，或输入问题标题与链接 |
| **观点物种识别** | 将回答识别为立场与生存策略，展示判定依据与来源 |
| **生态缸观测窗** | 用力导向图观察回答之间的结构关系与生态分布 |
| **演化时间轴** | 按回答时间回放观点进入生态的过程；时间轴为 AI 演化重建，不是知乎历史记录 |
| **环境干预** | 调整推荐权重、情绪气候与权威加权，观察结果如何变化 |
| **观点放生实验** | 输入尚未发布的回答，预测其在当前生态中的存活概率 |
| **观点画像** | 授权知乎账号后，分析公开创作内容的观点分布 |

## AI 与数据诚信 🛡️

项目使用 DeepSeek 官方 API 完成语义识别与生态解说：

- `deepseek-flash`：逐条观点识别、问题类型识别
- `deepseek-v4-pro`：整缸派系归纳与观点点评
- AI 输出使用严格 JSON 契约解析，非法标签会整条回退到本地可解释模型
- AI 思考过程通过流式接口实时展示，生成完成后自动呈现结果
- DeepSeek 请求支持内存缓存、并发去重与磁盘持久化，重复请求不会重复消耗额度
- 缓存键包含模型、参数与完整提示词，提示词变化不会读取旧结果
- 放生存活概率、风险与改写建议由规则模型计算，**AI 不参与数值计算**
- 时间轴明确标注为「AI 演化重建·非历史记录」
- 放生结果明确标注为「AI 模拟预测」
- 演示数据与知乎真实数据严格区分

API Key 只存储在服务端环境变量中，不进入前端、仓库、镜像或日志。

## 赛事与团队 👥

### 参赛赛事
- **赛事**：知乎黑客松 2026 · 校园新锐季
- **活动代码**：`zhihu_hackathon_2026_p2`
- **参赛赛道**：知识炼金场
- **作品定位**：将知乎问题转化为可观察、可干预的观点生态系统
- **在线 Demo**：[[https://zh.starsalt.cc](https://zh.starsalt.cc)]([https://zh.starsalt.cc](https://zh.starsalt.cc))

### 团队信息
- **队伍名称**：云航沐言
- **队员**：云团子、Bokily

## 技术方案 ⚙️
```

知乎开放平台 API
        │
        ├── 热榜 / 搜索 / 问题回答
        │
        ▼
Express 服务端 ── DeepSeek 官方 API
        │              ├── JSON 语义识别
        │              ├── 流式思考过程
        │              └── 内存 + 磁盘调用缓存
        │
        ▼
React + TypeScript + Vite
        │
        ├── 生态缸可视化
        ├── 时间轴回放
        ├── 环境参数干预
        └── 放生预测报告

```

**技术栈**
- 前端：React 18、TypeScript、Vite、D3 Force
- 服务端：Node.js 22、Express
- AI：DeepSeek 官方 OpenAI 兼容接口
- 数据可视化：SVG、D3 Force Layout
- 部署：Docker 多阶段构建、Node 长驻进程、Nginx HTTPS 反向代理

## 本地运行 🚀
### 环境要求
- Node.js 22+
- Docker（仅容器部署需要）
- 可选：知乎开放平台 Access Secret
- 可选：DeepSeek API Key

### 启动开发环境
```bash
cd app/server
npm install
# 创建 app/server/.env，并按需填写：
# ZHIHU_ACCESS_SECRET=your_secret
# DEEPSEEK_API_KEY=your_key
# DEEPSEEK_MODEL=deepseek-flash
# DEEPSEEK_MODEL_PRO=deepseek-v4-pro
npm start
```

另开终端构建前端：

```
cd app/web
npm install
npm run build
```

访问：[](%5Bhttp://localhost:8787%5D(http://localhost:8787))[http://localhost:8787](http://localhost:8787)

没有配置凭证时，系统会进入演示模式，不会伪装成实时数据。

## Docker 部署 🐳

```
docker build -t opinion-tank .
docker run -d \
  --name opinion-tank \
  -p 8787:8787 \
  --env-file app/server/.env \
  -v /opt/opinion-tank-data:/app/server/data \
  --restart unless-stopped \
  opinion-tank
```

`/app/server/data` 用于保存生态缸缓存、AI 输出缓存与预构建数据。生产环境必须使用持久化卷，以避免容器重启后重复消耗 API 额度。

## 目录结构 📂

```
.
├── app
│   ├── server
│   │   ├── src/              # Express API、知乎客户端、AI 编排与规则模型
│   │   └── test/             # 服务端契约、缓存、OAuth 与规则测试
│   ├── web
│   │   └── src/              # React 页面、生态缸、进度流与可视化组件
│   └── docs/                  # 开发记录与提交清单
├── docs/                     # 赛事材料、部署说明与演示脚本
├── Dockerfile                # Docker 多阶段构建
└── render.yaml               # Render 部署配置
```

## 测试与质量检查 ✅

```
cd app/server
node --test test/*.test.mjs
cd ../web
npm run build
```

当前版本已验证：服务端全量测试 75/75 通过，前端 TypeScript 检查与生产构建通过。

## 开源说明 📜

本项目为知乎黑客松 2026 · 校园新锐季参赛作品，版权所有。

---

> 
> 🌟 如果觉得本项目对您有帮助，欢迎Star！

```

直接全选复制上面代码块里面的全部内容，粘贴到仓库的 `README.md` 即可。
需要我再帮你增加目录跳转（锚点链接）版本吗？
