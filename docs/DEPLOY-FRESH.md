# 全新服务器部署指南（重装系统后照这个做）

> 适用：刚重装完系统的空机器（Ubuntu 22.04 / 24.04）。
> 全流程约 20–30 分钟，除了证书和后台设置，其余都能一条条复制执行。
>
> **不需要 1Panel**。只用 Node + systemd + Nginx，比面板省内存，也不会出现"面板挂了整机摸不着"的情况。
> 想继续用 1Panel 的话，只需要替换第 6 步（反代）的配置路径，其余完全一样。

---

## 0. 重装后要先确认的三件事

| # | 事项 | 说明 |
| --- | --- | --- |
| 1 | **公网 IP 有没有变** | 轻量应用服务器通常不变；CVM 重装一般也不变，但**务必确认**。变了就去 DNSPod 把 `example.com` 和 `www` 的 A 记录改成新 IP |
| 2 | **安全组/防火墙放行 22 / 80 / 443** | 云控制台的安全组 + 系统内 ufw 都要放行 |
| 3 | **备案信息仍然有效** | ICP：`京ICP备0000000号-1`；公安：`京公网安备00000000000000号`。换 IP 不影响备案 |

---

## 1. 基础环境（必做）

```bash
# 更新 + 基础工具
sudo apt update && sudo apt -y upgrade
sudo apt -y install curl git unzip ca-certificates ufw nginx

# 时区（日志/备份时间才对）
sudo timedatectl set-timezone Asia/Shanghai

# 2G swap：构建和突发内存都靠它兜底（这次机器被拖垮，很大程度就是因为没 swap）
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h

# 防火墙（只放这三个）
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
sudo ufw status
```

---

## 2. 装 Node（必须 ≥ 22.5，推荐 24）

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
node -v      # 期望 v24.x
npm -v
```

> 为什么必须 ≥22.5：后端用的是 Node 内置的 `node:sqlite`，低版本没有。

---

## 3. 把代码传上去

**方式 A（推荐，最省事）**：在本地把整个项目打包，用 SFTP / 1Panel 文件管理 / `scp` 传到服务器：

```bash
# 本地（Windows PowerShell）
Compress-Archive -Path .\songlist\* -DestinationPath .\songlist.zip
# 然后：
scp songlist.zip ubuntu@<服务器IP>:/home/ubuntu/
```

```bash
# 服务器
cd /home/ubuntu
unzip -o songlist.zip -d songlist
ls songlist            # 应该能看到 package.json、deploy/、server/、src/
```

**方式 B（有仓库）**：

```bash
cd /home/ubuntu
git clone <你的仓库地址> songlist
```

---

## 4. 一键部署

```bash
cd /home/ubuntu
sudo bash songlist/deploy/install.sh /home/ubuntu/songlist
```

脚本会依次做：建 `songlist` 系统用户 → 同步代码到 `/opt/songlist/app` → `npm install` → 构建前端 → 生成 `/opt/songlist/app.env`（已存在则不覆盖）→ 安装并启动 systemd 服务。

**如果 Node 不在标准路径**（比如用 nvm 装的），显式指定：

```bash
sudo env NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node \
     RUN_USER=ubuntu bash /home/ubuntu/songlist/deploy/install.sh /home/ubuntu/songlist
```

**构建阶段如果卡很久或整机变卡**：先 `free -h` 看内存，确认 swap 已开（第 1 步）。仍然吃紧就临时限制：

```bash
cd /opt/songlist/app && NODE_OPTIONS=--max-old-space-size=768 npm run build
```

---

## 5. 拿到初始管理员密码

```bash
sudo journalctl -u songlist -n 80 --no-pager | grep -A2 -i '管理员'
```

> 如果启动日志里没打印密码，说明 `app.env` 里配置了 `ADMIN_PASSWORD`，去 `/opt/songlist/app.env`（root 600）看。
> 想直接重置成新密码：
> ```bash
> cd /opt/songlist/app
> /usr/bin/node scripts/reset-password.mjs --data-dir /opt/songlist/data --generate
> ```

先确认服务本身是通的：

```bash
curl -s http://127.0.0.1:5181/api/health      # 期望 {"ok":true,"songs":N}
```

---

## 6. Nginx 反向代理

```bash
sudo tee /etc/nginx/sites-available/songlist >/dev/null <<'EOF'
server {
    listen 80;
    server_name example.com www.example.com;

    # 后台上传：图片 ≤3MB、视频 ≤8MB（走 base64，体积会膨胀 1/3）
    client_max_body_size 16m;

    location / {
        proxy_pass http://127.0.0.1:5181;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;   # 批量导入几千行时别让网关先超时
        proxy_send_timeout 120s;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/songlist /etc/nginx/sites-enabled/songlist
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

**验证反代通了**：

```bash
curl -sI http://127.0.0.1/ | head -3
curl -s  http://127.0.0.1/api/health
```

---

## 7. HTTPS

### 方案 A：Let's Encrypt（不用 Cloudflare 时）

```bash
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d example.com -d www.example.com
# 按提示选：同意条款 → 不接收推广 → 自动把 http 跳到 https
sudo certbot renew --dry-run      # 验证自动续期
```

### 方案 B：Cloudflare 代理 + 源站证书

1. CF 里给 `example.com` 签 Origin Certificate（覆盖 `*.example.com`）
2. 把证书和私钥存成 `/etc/nginx/ssl/origin.pem` / `origin.key`（权限 600）
3. Nginx 里加 `listen 443 ssl;` + `ssl_certificate` / `ssl_certificate_key`
4. CF 的 SSL 模式设 **Full (strict)**

### 无论哪种，最后都要开「强制 HTTPS」

```bash
sudo sed -i 's|listen 80;|listen 80;\n    return 301 https://$host$request_uri;|' /etc/nginx/sites-available/songlist
sudo nginx -t && sudo systemctl reload nginx
```

---

## 8. 首次配置后台（必做）

浏览器打开 `https://example.com/admin`，用第 5 步的密码登录。

### 8.1 立刻改密码
**账号安全** → 改成一个强密码。

### 8.2 站点设置
| 字段 | 值 |
| --- | --- |
| 主播名 | 临小渺 |
| 直播间链接 | `https://live.bilibili.com/123456` |
| ICP 备案号 | `京ICP备0000000号-1` |
| 公安备案号 | `京公网安备00000000000000号` |
| 公告 | 会唱一点歌，配一点音，一点点游戏（fps除外） |
| 背景图 | 上传你的插画（可选） |
| 背景视频 | 上传 `壁纸文件.mp4`（1.41MB，≤8MB） |

### 8.3 导入歌单（覆盖模式）
**批量导入** → 粘贴 `好像是全部的？）.csv` 的全部内容 → 点**解析预览** → 模式选**覆盖** → 提交。

- 会导入 **648 首**（中文625 / 日语12 / 粤语7 / 英文4）
- 备注里的 **6 首「付费曲」**（阿刁 / 百万个吻 / 好汉歌 / 好运来 / 情歌王 / 达拉崩吧）会带上，前台显示礼物图标
- 覆盖前会自动备份一份（`before-replace`）

### 8.4 主播资料（可选）
头像、简介、标签（注意：标签里别留「示例标签」这种占位）。

---

## 9. 每日备份（强烈建议，这次就是吃了没有异地备份的亏）

一次备份三样东西：**歌单数据 + Halo 数据 + 配置文件**。

```bash
sudo tee /usr/local/bin/site-backup.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date +%F)"
DEST=/home/ubuntu/songlist-backup
mkdir -p "$DEST"

# 1) 歌单站数据：SQLite + 备份目录 + 上传的图片/视频
tar czf "$DEST/songlist-data-$STAMP.tar.gz" -C /opt/songlist data

# 2) Halo 数据（没装就跳过）
if [ -d /opt/halo ]; then
  tar czf "$DEST/halo-data-$STAMP.tar.gz" -C /opt halo
fi

# 3) 配置文件（换机器时靠它快速还原；里面含 app.env，注意权限）
tar czf "$DEST/configs-$STAMP.tar.gz" -C / \
  etc/nginx/sites-available \
  etc/systemd/system/songlist.service \
  opt/songlist/app.env 2>/dev/null || true

# 4) 只保留最近 14 天
find "$DEST" -maxdepth 1 -name '*.tar.gz' -mtime +14 -delete

echo "[$(date '+%F %T')] 备份完成"
ls -lh "$DEST" | tail -n +2
EOF

sudo chmod 700 /usr/local/bin/site-backup.sh

# 每天 04:10 跑
( sudo crontab -l 2>/dev/null | grep -v 'site-backup.sh'; \
  echo '10 4 * * * /usr/local/bin/site-backup.sh >> /var/log/site-backup.log 2>&1' ) | sudo crontab -

# 立刻手动跑一次验证
sudo /usr/local/bin/site-backup.sh
```

应该看到三个包：

```
songlist-data-2026-11-08.tar.gz
halo-data-2026-11-08.tar.gz
configs-2026-11-08.tar.gz
```

### 9.1 验证备份是好的（别只看文件在不在）

```bash
# 歌单库能不能解出来
tar tzf /home/ubuntu/songlist-backup/songlist-data-$(date +%F).tar.gz | head -5
# 期望：data/songlist.db、data/songlist.db-wal、data/uploads/...

# 配置文件里有没有 nginx / systemd / app.env
tar tzf /home/ubuntu/songlist-backup/configs-$(date +%F).tar.gz
```

### 9.2 把备份拉回本地（关键一步）

服务器上的备份只防"误操作/数据库坏"，**不防整机丢失**。定期拉回本地：

```powershell
# 你电脑上（PowerShell）
ssh-keygen -R <你的服务器IP> 2>$null
scp ubuntu@<你的服务器IP>:/home/ubuntu/songlist-backup/*`(Get-Date -Format 'yyyy-MM-dd')`.tar.gz D:\backup\
```

建议每周日拉一次。想省事可以写个 `D:\backup\pull.ps1` 挂到任务计划程序。

### 9.3 备份内容对照表

| 包 | 内容 | 什么时候用 |
| --- | --- | --- |
| `songlist-data-*.tar.gz` | SQLite（含 -wal/-shm）、`data/backups/`、`data/uploads/`（头像/背景图/背景视频） | 歌单丢了、换机器 |
| `halo-data-*.tar.gz` | Halo 的数据库和附件 | 博客内容丢了 |
| `configs-*.tar.gz` | nginx 站点配置、systemd 服务、`app.env` | 换机器时不用重新配 |

> ⚠️ `configs-*.tar.gz` 里有 `app.env`（可能含管理员密码），**别外发**。
> 恢复流程见 [附录 B](#附录-b从备份恢复演练用)。

---
## 10. 部署后自检

```bash
bash /opt/songlist/app/deploy/check-site.sh https://example.com
```

期望 `通过 11 项`。然后浏览器**强制刷新**（Ctrl+F5）逐项看：

- [ ] 标题「临小渺的歌单」+ 歌曲数 648
- [ ] 宽屏下背景是**视频**在动；手机宽度下只有背景图（这是设计如此）
- [ ] 侧栏在右，点左下 `‹` 能切到左侧，刷新后位置记得住
- [ ] 搜索 `dukou` 能出「渡口」
- [ ] 筛选面板里 语种/曲风/歌手 有分组；点「日语」筛到 12 首
- [ ] 单击一行复制出 `点歌 阿刁`（**只带歌名**）
- [ ] 「阿刁」等 6 首带 🎁 图标，公告下方有「带此图标的曲目点歌有额外要求」
- [ ] 页脚：`京ICP备0000000号-1 · 🛡️京公网安备00000000000000号`，图标可点

---

## 11. 常见故障

| 现象 | 排查 |
| --- | --- |
| `curl 127.0.0.1:5181` 没反应 | `systemctl status songlist --no-pager`；`journalctl -u songlist -n 50` |
| 502 Bad Gateway | 后端没起，同上；或端口不是 5181（看 `app.env` 的 PORT） |
| 首页能开但列表空 | 数据库没导入 → 后台导入歌单 |
| 后台登录不上 | `COOKIE_SECURE` 要和协议一致：https 用 `1`，纯 http 用 `0` |
| 上传图片/视频报 413 | Nginx 的 `client_max_body_size` 太小（本文档设的 16m） |
| 视频不显示 | `curl -sI https://域名/uploads/xxx.mp4 \| grep -i content-type` 必须是 `video/mp4` |
| 构建时整机卡死 | 没 swap 或内存不足 → 第 1 步的 swap + `NODE_OPTIONS=--max-old-space-size=768` |
| 服务器上 `npm run build` 报找不到 vite | `install.sh` 构建完会删掉开发依赖，先 `cd /opt/songlist/app && npm install` 再构建 |
| 安全扫描报 Vite 漏洞 | 生产环境不跑 dev server，属版本误报；`install.sh` 已用 `npm prune --omit=dev` 把 vite 从服务器移除 |
| 端口 5181 被公网访问到 | `app.env` 里 `HOST` 必须是 `127.0.0.1` |

---

## 12. 以后怎么升级（建议：本地构建，服务器不构建）

服务器只负责跑，构建在本地做，能彻底避免"构建把机器拖垮"：

```bash
# 本地
pnpm build                     # 生成 dist/
# 把 dist/ 打包上传（连同改过的 server/*.mjs）
scp -r dist ubuntu@<IP>:/home/ubuntu/songlist/

# 服务器：只同步 + 重启，不跑 npm install / build
sudo rsync -a --delete --exclude node_modules --exclude data \
     /home/ubuntu/songlist/ /opt/songlist/app/
sudo systemctl restart songlist
```

> 改了 `package.json` 依赖时才需要在服务器上 `npm install`。

---

## 附：目录结构（排障时对照）

```
/home/ubuntu/songlist/      源码（上传到这里）
/opt/songlist/app/          实际运行 + dist 前端产物
/opt/songlist/app.env       配置（PORT / HOST / DATA_DIR / COOKIE_SECURE…，600）
/opt/songlist/data/         ★ SQLite + backups/ + uploads/（唯一需要备份的目录）
/etc/systemd/system/songlist.service
/etc/nginx/sites-available/songlist
/home/ubuntu/songlist-backup/  每日备份（ubuntu 可读，记得同步到本地）
```

---

## 附录 A：同一台机器再挂一个 Halo 博客

> 前提：**先确认歌单站已经跑通**（第 10 步自检全过），再来装博客。
> 两个站互不干扰：歌单站走 Node 5181，Halo 走 8090，Nginx 按域名分流。

### A1. 用 Docker 装 Halo（最省事）

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo mkdir -p /opt/halo

sudo docker run -d --name halo --restart always \
  -p 127.0.0.1:8090:8090 \
  -v /opt/halo:/root/.halo2 \
  -e JAVA_OPTS="-Xmx512m" \
  halohub/halo:2
```

- `-p 127.0.0.1:8090` 只监听本机，对外统一走 Nginx（别把 8090 直接开到公网）
- `-v /opt/halo` 是**数据目录**（数据库 + 附件），以后备份就备这个
- `JAVA_OPTS=-Xmx512m` 限制 Java 堆 —— 4G 机器上很关键，不加 Halo 可能吃到 1G+

首次初始化建议用 SSH 隧道，别把管理页面裸奔在公网：

```bash
# 在你自己电脑上
ssh -L 8090:127.0.0.1:8090 ubuntu@<服务器IP>
# 浏览器打开 http://127.0.0.1:8090 完成初始化
```

### A2. Nginx 加博客的 vhost

```nginx
server {
    listen 443 ssl;
    server_name <你的博客域名>;
    ssl_certificate     /etc/nginx/ssl/blog.pem;
    ssl_certificate_key /etc/nginx/ssl/blog.key;

    client_max_body_size 64m;   # 博客要传图，给小了传不上去
    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### A3. Cloudflare 侧

| 项 | 两个域名都要做 |
| --- | --- |
| DNS | A 记录指向服务器 IP（重装后 IP 变了要改） |
| 证书 | 各签一张 Origin Certificate（或一张通配证书覆盖两个域名） |
| SSL 模式 | **Full (strict)** |
| 缓存 | 博客可开缓存；歌单站别开 Cache Everything（会连 `/admin` 一起缓存） |

### A4. 内存预算（4G 机器）

| 进程 | 大致占用 |
| --- | --- |
| Halo（Java，限 512m 堆） | 600MB ~ 1GB |
| 歌单站（Node） | 60 ~ 120MB |
| Nginx + Docker 守护进程 | ~150MB |

再叠加一次前端构建，**不做 swap 很容易见底**：
1. 第 1 步的 2G swap 必做
2. **不在服务器上构建**（第 12 节的做法）

### A5. 博客也纳入每日备份

```bash
# 追加到已有的备份脚本里
sudo tar czf "/home/ubuntu/songlist-backup/halo-$(date +%F).tar.gz" -C /opt halo
```
---

## 附录 B：从备份恢复（演练用）

> 触发场景：误删歌单、数据库损坏、换服务器。
> 前提：手上有一份 `songlist-YYYY-MM-DD.tar.gz`（服务器 `/home/ubuntu/songlist-backup/` 或你本地 `D:\backup\`）。

### B1. 把备份放到服务器上

```bash
# 如果备份在你本地，先传上去
scp D:\backup\songlist-2026-11-08.tar.gz ubuntu@<服务器IP>:/home/ubuntu/
```

### B2. 恢复

```bash
# 1) 停服务（避免恢复过程中还在写库）
sudo systemctl stop songlist

# 2) 解压到临时目录
cd /tmp && tar xzf /home/ubuntu/songlist-2026-11-08.tar.gz
ls /tmp/data          # 应看到 songlist.db / uploads/ / backups/

# 3) 旧数据先留一份（万一是拿错备份，还能回退）
sudo mv /opt/songlist/data "/opt/songlist/data.bak-$(date +%F-%H%M)"

# 4) 放回新数据
sudo cp -a /tmp/data /opt/songlist/data

# 5) 属主必须是服务用户（install.sh 建的是 songlist 用户）
sudo chown -R songlist:songlist /opt/songlist/data

# 6) 起服务
sudo systemctl start songlist
```

### B3. 验证

```bash
curl -s http://127.0.0.1:5181/api/health        # songs 数应该和备份时一致

# 抽查几首歌还在不在
curl -s http://127.0.0.1:5181/api/songs | head -c 300

# 后台能登录、曲库能打开
```

浏览器 **Ctrl+F5** 打开前台，确认：

- [ ] 歌曲数正确
- [ ] 后台能登录（密码是备份时那个）
- [ ] 头像 / 背景图 / 背景视频都还在（`/uploads/` 跟着备份一起回来了）

### B4. 恢复后清理

```bash
# 确认没问题后，删掉临时解压目录（项目外，按需清理）
sudo rm -rf /tmp/data

# 旧数据留几天再删，别急着删
ls -d /opt/songlist/data.bak-*
```

### B5. 备份里到底有什么

```
data/songlist.db          SQLite 主库（歌曲、设置、资料、会话、审计）
data/songlist.db-wal      未落盘的写入（必须一起恢复，别只拷 .db）
data/songlist.db-shm      共享内存索引（同上）
data/backups/*.json       后台「备份与导出」里的历史备份
data/uploads/*            头像、背景图、背景视频
```

> **重要**：恢复时 `.db`、`.db-wal`、`.db-shm` 三个要**一起**放回去。只拷 `.db` 可能丢掉最后一次写入。