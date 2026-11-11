# 部署到 Linux 服务器（1Panel）完整步骤

这套东西是**一个 Node 进程**：同时提供前台页面、管理后台、API 和上传文件。
数据库是 SQLite 单文件，**不需要 MySQL、不需要 PHP、不需要原生编译**（Node 内置 `node:sqlite`）。

```
浏览器 ──HTTPS──> Nginx/1Panel ──http──> 127.0.0.1:5181 (node server/index.mjs)
                                              ├── dist/            前台 + admin.html
                                              ├── /api /uploads   接口与图片
                                              └── /opt/songlist/data  SQLite + 备份 + 上传
```

---

## 0. 部署前准备

| 项目 | 要求 |
| --- | --- |
| Node.js | **≥ 22.5，推荐 24 LTS**（22.x 需要 `--experimental-sqlite`，24 直接可用） |
| 内存 | 512MB 够用（构建前端时建议 1GB） |
| 磁盘 | 代码 + 依赖约 300MB；数据按每 1000 首歌约 1MB 算，备份另计 |
| 依赖服务 | 无（不用数据库、不用 Redis） |

检查服务器上的 Node：

```bash
node -v        # 期望 v24.x 或 v22.5+
which node     # 记下路径，systemd 里要用，例如 /usr/bin/node
```

如果没装或版本太低：1Panel 里「应用商店 → 运行环境」可以装 Node.js；或者用 nvm：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.nvm/nvm.sh && nvm install 24 && nvm alias default 24
```

---

## 1. 上传代码并构建

### 方式 A：用一键脚本（推荐，幂等，可反复用来升级）

把整个项目目录传到服务器（比如 `/root/songlist`），然后：

```bash
sudo bash /root/songlist/deploy/install.sh /root/songlist
```

脚本会：建 `songlist` 系统用户 → 同步代码到 `/opt/songlist/app` → 装依赖 → 构建前端 →
生成 `/opt/songlist/app.env`（权限 600）→ 装并启动 systemd 服务。

跑完看日志拿初始密码：

```bash
journalctl -u songlist -n 40 --no-pager
```

### 方式 B：手工一步步来

```bash
# 1) 建用户和目录
sudo useradd --system --home-dir /opt/songlist --shell /usr/sbin/nologin songlist || true
sudo mkdir -p /opt/songlist/app /opt/songlist/data

# 2) 同步代码（排除本地依赖与数据）
sudo rsync -a --delete \
  --exclude node_modules --exclude dist --exclude server/data --exclude .git \
  /root/songlist/ /opt/songlist/app/

# 3) 装依赖 + 构建（用生产依赖装完再构建，构建需要 devDependencies，所以这步别加 --prod）
cd /opt/songlist/app
sudo -u songlist pnpm install --frozen-lockfile
sudo -u songlist pnpm build

# 4) 配置文件
sudo cp deploy/env.example /opt/songlist/app.env
sudo nano /opt/songlist/app.env        # 至少确认 DATA_DIR / STATIC_DIR / COOKIE_SECURE
sudo chmod 600 /opt/songlist/app.env
sudo chown -R songlist:songlist /opt/songlist
```

构建产物应该包含 `dist/index.html`（前台）和 `dist/admin.html`（后台），确认一下：

```bash
ls -l /opt/songlist/app/dist
```

---

## 2. 配置并启动服务

```bash
# 把 unit 里的路径替换成本机实际值
sudo sed -e "s#^WorkingDirectory=.*#WorkingDirectory=/root/songlist/app#" \
         -e "s#^EnvironmentFile=.*#EnvironmentFile=/root/songlist/app.env#" \
         -e "s#^ExecStart=.*#ExecStart=$(/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node) server/index.mjs#" \
         -e "s#^ReadWritePaths=.*#ReadWritePaths=/root/songlist/data#" \
         /root/songlist/app/deploy/songlist.service | sudo tee /etc/systemd/system/songlist.service

sudo systemctl daemon-reload
sudo systemctl enable --now songlist
sudo systemctl status songlist --no-pager
```

本机自测（还没配 Nginx 时）：

```bash
curl -s http://127.0.0.1:5181/api/health
# {"ok":true,"songs":779,"time":...}
```

`app.env` 里几个关键项：

| 变量 | 说明 |
| --- | --- |
| `HOST=127.0.0.1` | **保持本机监听**，对外只通过 Nginx；改成 `0.0.0.0` 会让 5181 直接暴露在公网 |
| `COOKIE_SECURE=1` | 全站 HTTPS 时必须为 1；如果你先用 http 测试，先设 0，否则登录 cookie 会被浏览器丢掉、怎么都登不上 |
| `ADMIN_PASSWORD` | **只在本机第一次启动建账号时生效**，登录后改完密码就把这行删掉（数据库里只存 scrypt 哈希） |
| `BACKUP_KEEP` | 保留备份份数，默认 60 |

---

## 3. 配 Nginx 反向代理（1Panel）

1Panel 面板里：

1. **网站 → 创建网站**：选「反向代理」，域名填你的域名，代理地址 `http://127.0.0.1:5181`。
2. 打开该网站的配置文件，确认有这些头（1Panel 默认会给大部分）：

```nginx
client_max_body_size 12m;          # 上传图片走 base64，要给够
location / {
    proxy_pass http://127.0.0.1:5181;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;       # 批量导入几千行时别让网关先超时
}
```

完整示例见 `deploy/nginx-site.conf`（包含"整站反代"和"静态交给 Nginx"两种方案）。

3. **网站 → HTTPS**：申请 Let's Encrypt 证书并开启强制 HTTPS。
4. 开启 HTTPS 后，把 `app.env` 里的 `COOKIE_SECURE` 改成 `1`，然后 `systemctl restart songlist`。

访问：

| 地址 | 用途 |
| --- | --- |
| `https://你的域名/` | 前台歌单（观众用） |
| `https://你的域名/admin` | 管理后台 |
| `https://你的域名/api/health` | 健康检查（可用于面板监控） |

---

## 4. 也可以走 Docker（1Panel 的容器 → 编排）

项目里带了 `Dockerfile` 与 `docker-compose.yml`：

```bash
cd /opt/songlist/app
# 容器里以 uid 1000 的 node 用户运行，数据目录要是它能写的
mkdir -p data && sudo chown -R 1000:1000 data
docker compose up -d --build
docker compose logs -f          # 第一次会打印随机管理员密码
```

数据落在宿主机的 `./data`（compose 里做了卷映射）。
反向代理同样指到 `127.0.0.1:5181`。

> 如果你把 `data` 目录的属主弄错了，会看到写入失败 / SQLite 打不开数据库的报错。
> 修正：`sudo chown -R 1000:1000 ./data`，或改成挂到一个已经属于 1000 的目录。
>
> 容器内的 Node 版本是 24-alpine，`node:sqlite` 直接可用，不需要额外编译步骤。

---

## 5. 日常运维

### 备份（只需要管一个目录）

```bash
# 手动打一份（数据库 + 备份文件 + 上传图片）
sudo tar czf /root/songlist-$(date +%F).tar.gz -C /opt/songlist data

# 定时任务（1Panel 的「计划任务」里加，或 crontab）
0 4 * * * tar czf /root/backup/songlist-$(date +\%F).tar.gz -C /opt/songlist data
```

另外后台自带三层保护，别关掉：

1. **写操作自动备份**（同类操作 5 分钟内合并成一份）；
2. 覆盖导入、清空曲库、回滚前**必定**单独备份；
3. 「备份与导出」页可以一键回滚、下载某份备份、或导出 `list.txt` / 完整 JSON。

### 升级

```bash
# 代码有更新时（方式 A 重跑一次脚本最省事）
sudo bash /root/songlist/deploy/install.sh /root/songlist

# 手工方式
sudo rsync -a --delete --exclude node_modules --exclude dist --exclude server/data --exclude .git \
  /root/songlist/ /opt/songlist/app/
cd /opt/songlist/app && sudo -u songlist pnpm install --frozen-lockfile && sudo -u songlist pnpm build
sudo systemctl restart songlist
```

> `data/` 目录**不要**被 rsync --delete 波及：脚本和上面的命令都显式排除了 `server/data`，
> 而生产数据实际在 `/opt/songlist/data`（由 `DATA_DIR` 指定），与代码目录分离。

### 改密码 / 忘记密码

```bash
# 推荐：交互式（不回显），会用 scrypt 哈希后写库并踢掉所有旧会话
cd /opt/songlist/app && sudo -u songlist node scripts/reset-password.mjs --data-dir /opt/songlist/data

# 生成随机密码
sudo -u songlist node scripts/reset-password.mjs --data-dir /opt/songlist/data --generate
```

登录状态下也可以直接在后台「账号安全」页改。

### 换歌单（示例数据 → 你自己的）

后台「批量导入」页：粘贴表格内容 → 预览 → 选**覆盖** → 二次确认（会先自动备份）。
或者用命令行：

```bash
cd /opt/songlist/app
sudo -u songlist node scripts/reset-data.mjs --data-dir /opt/songlist/data --status
sudo -u songlist node scripts/reset-data.mjs --data-dir /opt/songlist/data \
  --import /root/我的歌单.txt --replace --yes --streamer "主播名" --live "https://live.bilibili.com/xxx"
```

---

## 6. 安全清单（上线前逐条确认）

- [ ] **已改掉初始管理员密码**（后台「账号安全」），且 `app.env` 里的 `ADMIN_PASSWORD` 已删除
- [ ] 密码库存在数据库里是 `scrypt$...` 哈希（`server/data/songlist.db` 里搜不到明文）
- [ ] `HOST=127.0.0.1`，5181 端口没有暴露到公网（1Panel 安全组 / 防火墙只放 80、443）
- [ ] 全站 HTTPS 且 `COOKIE_SECURE=1`
- [ ] `/admin` 已在 Nginx 加了 `X-Robots-Tag: noindex`（`deploy/nginx-site.conf` 里有）
- [ ] `app.env` 权限 600，属主 songlist
- [ ] 后台「备份与导出」能正常下载备份（说明备份目录可写）
- [ ] 已配置至少每日一次的外部备份（tar 到别的机器/对象存储）

---

## 7. 排障

| 现象 | 原因与处理 |
| --- | --- |
| 启动即退出，日志写 `需要 Node 22.5 及以上` | 升级 Node；22.x 用 `node --experimental-sqlite server/index.mjs` |
| `当前 Node 无法加载 node:sqlite` | 同上；确认不是用很老的 Node 跑的 |
| `/admin` 返回 404，提示"还没有构建后台页面" | 忘了 `pnpm build`，或者 `STATIC_DIR` 指错了目录 |
| 登录点了没反应 / 登录后立刻掉线 | 用了 HTTPS 但 `COOKIE_SECURE=0`，或 http 却设成 `1`。两边保持一致后重启 |
| 登录提示"尝试次数过多" | 同一 IP 10 分钟失败 8 次会限流，等几分钟或重启服务 |
| 上传图片报 413 | Nginx 的 `client_max_body_size` 太小（给到 12m），或图片超过 3MB |
| 批量导入报错/超时 | 网关 `proxy_read_timeout` 太短；一次别贴超过几千行 |
| 前台一直显示"数据来自 list.txt" | 说明 `/api/songs` 拿不到：后端没起、Nginx 没转发 `/api`、或有缓存规则挡住了 |
| 数据库被锁 / 写入失败 | 检查 `/opt/songlist/data` 属主是不是 `songlist`，磁盘是否满了 |
| 想看每个请求 | 临时把 `LOG_LEVEL` 改成 `info` 再重启 |

查看日志：

```bash
journalctl -u songlist -f              # 实时
journalctl -u songlist -n 200 --no-pager
```

---

## 8. 目录与端口速查

```
/opt/songlist/
├── app/                    代码 + dist/（前台 index.html、后台 admin.html）
│   ├── server/             后端：index.mjs 入口、lib/、routes.mjs、API.md
│   ├── scripts/            自检与维护脚本（api-test / e2e / reset-password / reset-data）
│   └── deploy/             本部署相关文件
├── app.env                环境变量（600）
└── data/                   ★ 唯一需要备份的目录
    ├── songlist.db         SQLite（歌曲、设置、资料、会话、审计）
    ├── backups/            自动与手动备份（JSON，可下载/回滚）
    └── uploads/            头像、封面等上传的图片
```

| 端口 | 用途 |
| --- | --- |
| 5181 | Node 服务（仅本机监听，由 Nginx 反代） |
| 80 / 443 | Nginx / 1Panel 对外 |
| 5180 | 仅本地开发用的 Vite dev server，服务器上不需要 |
