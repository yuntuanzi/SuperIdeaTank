# 观点进化缸 · 单容器部署
#
# 设计取舍：前后端合并成一个 Node 进程（Express 托管 web/dist），而不是拆成
# 「静态站 + Serverless API」。原因是本项目的额度极稀缺（直答 2 次/日、热榜 2 次/日、
# 搜索与问题回答各 10 次/日），必须依赖**进程内缓存 + 磁盘持久化**来防止重复消耗；
# Serverless 每次冷启动都丢缓存，等于把额度直接烧光。详见 docs/DEPLOY.md。

FROM node:22-alpine AS build
WORKDIR /app

# 先装依赖再拷源码，利用 Docker 层缓存
COPY app/web/package*.json ./web/
RUN cd web && npm ci --no-audit --no-fund

COPY app/web ./web
RUN cd web && npm run build


FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY app/server/package*.json ./server/
RUN cd server && npm ci --omit=dev --no-audit --no-fund

COPY app/server ./server
COPY --from=build /app/web/dist ./web/dist

# 缓存目录：生态缸结果与 DeepSeek 输出均落盘在这里，容器重启不丢已消耗额度换来的数据。
# 平台若提供持久卷，务必挂载到 /app/server/data。
# ai-cache.json 默认不进仓库，但运行时会由服务自动创建。
RUN mkdir -p /app/server/data

EXPOSE 8787
ENV PORT=8787

# Access Secret 只通过环境变量注入，绝不写进镜像
# docker run -e ZHIHU_ACCESS_SECRET=xxx -p 8787:8787 opinion-tank
CMD ["node", "server/src/index.js"]
