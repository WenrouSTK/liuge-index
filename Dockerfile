# ============================================================
# 六哥指数 — Dockerfile for Coolify
# Node.js + Express + sql.js
# ============================================================
FROM node:20-alpine

# 设置时区（容器内也能用 date 命令看北京时间，但代码仍用 bjNow()）
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

WORKDIR /app

# 先拷贝依赖描述文件，利用 Docker 缓存层
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 拷贝源码
COPY server.js ./
COPY public/ ./public/

# 数据目录（Coolify volume 会挂载到这里）
RUN mkdir -p /data
ENV DATA_DIR=/data

# 暴露端口（Coolify 会自动映射）
EXPOSE 3000
ENV PORT=3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
