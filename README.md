# 六哥指数 — 部署指南

## 项目结构

```
├── server.js          # 后端服务（Node.js + Express + SQLite）
├── package.json       # 依赖配置
├── public/            # 前端静态文件
│   ├── index.html     # 主页面
│   └── app.js         # 前端逻辑（API 驱动）
├── data/              # 数据库文件（自动创建）
│   └── liuge.db       # SQLite 数据库
└── index.html         # 旧版纯前端版本（可忽略）
```

## 本地运行

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start
# 或
node server.js

# 3. 打开浏览器
# http://localhost:3000
```

## 部署到服务器

### 方式一：直接部署（推荐）

```bash
# 1. 将项目上传到服务器
scp -r ./* root@你的服务器IP:/opt/liuge-index/

# 2. SSH 登录服务器
ssh root@你的服务器IP

# 3. 安装依赖
cd /opt/liuge-index
npm install --production

# 4. 使用 PM2 后台运行（推荐）
npm install -g pm2
pm2 start server.js --name liuge-index
pm2 save
pm2 startup  # 开机自启

# 5. 配置 Nginx 反向代理（可选，用于绑定域名+HTTPS）
```

### Nginx 配置示例

```nginx
server {
    listen 80;
    server_name liuge.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 方式二：Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t liuge-index .
docker run -d -p 3000:3000 -v ./data:/app/data --name liuge liuge-index
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 服务端口 |
| `JWT_SECRET` | 内置密钥 | JWT 签名密钥（生产环境务必自定义） |

## 注意事项

- **首个注册用户**自动成为管理员
- 数据库文件在 `data/liuge.db`，备份这个文件即可备份所有数据
- 密码使用 bcrypt 加密存储
- JWT Token 有效期 30 天
