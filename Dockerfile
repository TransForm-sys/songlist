# 构建阶段：装依赖 + 构建前端（前台与后台一起产出）
FROM node:24-alpine AS build
WORKDIR /app
# 固定包管理器版本（package.json 里的 packageManager），并避免 corepack 交互式提问把构建挂住
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# 运行阶段：只留生产依赖 + 前端产物 + 后端代码
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5181 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist \
    LOG_LEVEL=silent \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /app/dist ./dist
COPY server ./server
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 5181

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5181/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
