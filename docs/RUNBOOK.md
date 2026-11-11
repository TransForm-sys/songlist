# 歌单站 · 后续操作手册

> 照着从上往下做，**每一步都有「怎么做 / 怎么验证」**。做过的就跳到下一步，不用回头看聊天记录。
> 涉及服务器的地方，项目源码在 `/home/ubuntu/songlist`，真正在跑的在 `/opt/songlist/app`。

---

## 0. 现状（已核对）

| 项目 | 状态 |
| --- | --- |
| 服务器 | 腾讯云 `<你的服务器IP>`，1Panel，站点目录 `/www/sites/<域名>/` |
| Node | v24.21.0（nvm：`/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node`） |
| 服务 | systemd 服务 `songlist`，监听 `127.0.0.1:5181`，数据在 `/opt/songlist/data` |
| 旧域名 | `songlist.example.org` ✅ 已备案、HTTPS 正常、648 首歌 |
| 新域名 | `example.com` ⚠️ DNS 已解析、**HTTP 已通**、HTTPS 未配；备案/实名待确认 |
| 后台数据 | 主播名「临小渺」、直播间、公告、ICP、公安备案号（**都是旧域名的号**） |
| 待清理 | 主播资料里的标签还留着占位文字「示例标签」 |

### 已经修好、不用再管的问题

`/` 返回 404 · 导入丢歌（779→777）· 语种不显示 · 公告条配色 · 后台下拉白底 · Cloudflare 526 · npm 的 `install-scripts` 警告 · 日志刷堆栈 · systemd `StartLimit` 告警 · **SC（付费礼物）相关字眼全部按数据自动隐藏** —— **这些全部已解决**，再看到相关旧信息可以直接忽略。

> **关于 SC**：现在的规则是「**歌单里没有 SC 数据，界面上就不出现 SC**」——
> 前台列、筛选项、复制文本、后台表格列、编辑表单、批量改字段、导入页，以及公开的
> `list.txt` 文件，全都不会出现「SC / 需要SC」字样。
> 哪天换的主播需要 SC 点歌，**只要导入的表格里带上「需要SC」列**，这些界面会自动回来，不用改代码。

---

## 阶段一：现在就能做（不依赖备案）

### ✅ 步骤 0：把这次的改动传上去（一次性）

把本地这些文件传到服务器对应路径（`D:\13935\website-opt\songlist\` → `/home/ubuntu/songlist/`）：

```
package.json                              消除 npm 警告（前面提过但还没传）
server/lib/export.mjs                     导出的 list.txt 不再出现 SC 列
src/composables/useSongList.ts            SC 数据检测
src/App.vue                               前台隐藏 SC 筛选
src/components/SongList.vue               前台隐藏 SC 列
src/admin/views/SongsView.vue             后台隐藏 SC 列 / 筛选 / 统计 / 批量字段
src/admin/components/SongEditor.vue       编辑表单隐藏 SC 字段
src/admin/views/ImportView.vue            导入页隐藏 SC 预览列与统一选项
scripts/verify.ts                         新增测试（可选）
docs/RUNBOOK.md                           这份手册（可选，方便服务器上查）
deploy/nginx-site.conf                    配置参考（可选）
```

懒得挑就**整个项目重传**覆盖。然后跑一次部署：

```bash
sudo env NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node RUN_USER=ubuntu \
     bash /home/ubuntu/songlist/deploy/install.sh /home/ubuntu/songlist
```

**验证**（浏览器 **Ctrl+F5 强刷**）：

```bash
bash /opt/songlist/app/deploy/check-site.sh https://example.com
curl -s https://example.com/list.txt | head -3     # 表头里不该有「需要SC」
```

---

### ✅ 步骤 1：传 `package.json`，消掉 npm 警告

1. 把本地 `D:\13935\website-opt\songlist\package.json` 传到服务器 **`/home/ubuntu/songlist/package.json`** 覆盖
2. 验证：

```bash
grep -A2 allowScripts /home/ubuntu/songlist/package.json
```

应看到 `"allowScripts": { "esbuild": true }`。

> 这一步只是让下次部署日志干净，**不做也不影响任何功能**。

---

### ✅ 步骤 2：给新域名配 HTTPS

1Panel → **网站** → 点 `example.com` → **HTTPS** 标签：

1. **申请证书**：选 Let's Encrypt（域名已解析、80 可达，条件满足）
   - 如果申请失败：改用 **DNS 验证**，或签一张 Cloudflare Origin Certificate 上传
2. 打开 **HTTPS** 开关，并打开 **强制 HTTPS**
3. 保存 → **重载**

**验证**（三条都要过）：

```bash
# ① HTTPS 能通
curl -sI https://example.com/api/health | head -3

# ② 证书覆盖了新域名
echo | openssl s_client -connect 127.0.0.1:443 -servername example.com 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName

# ③ 整条链路自检（期望：通过 11 项，全部正常）
bash /opt/songlist/app/deploy/check-site.sh https://example.com
```

> `app.env` 里的 `COOKIE_SECURE=1` **不用改**（还是 HTTPS）。

---

### ✅ 步骤 3：后台收尾三件事

打开 `https://example.com/admin`（要重新登录一次，换域名后会话会失效）

1. **账号安全**：确认初始密码已经改掉（没改就现在改）
2. **主播资料**：标签里删掉「示例标签」，换成真实标签；顺便看简介文案（现在 bio 和公告内容重复了）
3. **批量导入**：如果歌单有更新，粘贴新表格 → 解析预览 → 选**覆盖** → 提交（覆盖前会自动备份）

---

### ✅ 步骤 4：加每日备份

1Panel → **计划任务** → 创建任务：

| 字段 | 填 |
| --- | --- |
| 类型 | Shell 脚本 |
| 名称 | 歌单站每日备份 |
| 执行周期 | 每天 04:00 |
| 脚本内容 | 见下 |

```bash
mkdir -p /root/backup
tar czf /root/backup/songlist-$(date +\%F).tar.gz -C /opt/songlist data
# 只保留最近 14 份
ls -1t /root/backup/songlist-*.tar.gz | tail -n +15 | xargs -r rm -f
```

**验证**：手动执行一次，然后 `ls -lh /root/backup/` 看到压缩包即成功。

> **只需要备份 `/opt/songlist/data` 这一个目录** —— 数据库、自动备份、上传的图片都在里面。
> 恢复方法：把解压出来的 `data` 放回 `/opt/songlist/`，再 `systemctl restart songlist`。

---

## 阶段二：等两个审核通过后再做

### ⏳ 步骤 5：确认两处状态

| 查什么 | 在哪看 | 为什么重要 |
| --- | --- | --- |
| **域名实名认证** | 注册商后台 → 我的域名 → 实名认证状态 | 未完成会被 `serverHold` **停止解析**（注册后有期限） |
| **ICP 备案** | 云厂商备案控制台 → 我的备案 | 未通过时国内云的 **80/443 会被拦**并返回"未备案"提示页 |

**两者都确认通过后**，再往下做。

---

### ⏳ 步骤 6：把备案号换成新域名的

**ICP 备案号是按域名发的**，新域名会拿到自己的号（同一主体下常见 `晋ICP备xxxxxxxx号-2` 这种后缀）；**公安备案号也是每个域名一个**。

后台 → **站点设置** → 改成新域名的 ICP + 公安备案号。

**验证**：

```bash
curl -s https://example.com/api/songs | head -c 300
```

`meta` 里的 `icp` / `police` 应变成新号码，前台页脚刷新后同步。

---

### ⏳ 步骤 7：办理新域名的公安备案

全国互联网安全管理服务平台 <https://beian.mps.gov.cn/> → 新增网站备案，填 `example.com`。要求是**网站开通后 30 日内**办理。

办下来后，把号码填回后台「站点设置」（就是步骤 6 那个位置）。

---

## 阶段三：正式切换

### ⏳ 步骤 8：旧域名 301 跳到新域名

等新域名 HTTPS + 备案号都正常、自己用几天没问题之后再做。

1Panel → 网站 → 点 `songlist.example.org` → **配置文件**，整个替换成：

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name songlist.example.org;

    ssl_certificate     /www/sites/songlist.example.org/ssl/fullchain.pem;
    ssl_certificate_key /www/sites/songlist.example.org/ssl/privkey.pem;

    return 301 https://example.com$request_uri;
}
```

保存 → 重载。

**验证**：

```bash
curl -sI https://songlist.example.org/ | head -3     # 期望 301 + Location: https://example.com/
curl -sIL https://songlist.example.org/ | head -3    # 跟随跳转应到 200
```

> 旧域名的证书**要保留**，否则访问旧域名会先报证书错误，跳转还没发生就断了。

---

### ⏳ 步骤 9：切换后的最终检查

```bash
# 服务与数据
curl -s https://example.com/api/health
bash /opt/songlist/app/deploy/check-site.sh https://example.com

# 系统服务
systemctl status songlist --no-pager | head -5
journalctl -u songlist -n 30 --no-pager
```

浏览器（**手机用 4G/5G 流量再测一遍**，排除本机缓存）：

- [ ] 首页标题是「临小渺的歌单」，总数正确
- [ ] 搜索能用拼音（输入 `dukou` 能搜到「渡口」）
- [ ] 语种/曲风筛选能出选项、能筛
- [ ] 单击一行能复制「点歌 歌名」（不带歌手）（**「点歌」后面是空格**，点歌机按这个前缀识别）
- [ ] 页脚两个备案号都是**新域名**的
- [ ] `/admin` 能登录、能改一首歌、能上传头像
- [ ] 简介弹窗头像/封面正常显示

---

## 附一：常用命令速查

```bash
# 重启服务
sudo systemctl restart songlist

# 看日志
journalctl -u songlist -n 50 --no-pager

# 改/重置管理员密码（★ 不要加 sudo）
cd /opt/songlist/app
/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node scripts/reset-password.mjs \
  --data-dir /opt/songlist/data --generate

# 换歌单（命令行方式）
cd /opt/songlist/app
/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node scripts/reset-data.mjs \
  --data-dir /opt/songlist/data --import /home/ubuntu/歌单.tsv --replace --yes --streamer "主播名"

# 部署/更新（改了代码之后）
sudo env NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node RUN_USER=ubuntu \
     bash /home/ubuntu/songlist/deploy/install.sh /home/ubuntu/songlist

# 部署后自检
bash /opt/songlist/app/deploy/check-site.sh https://example.com
```

---

## 附二：遇到问题对照表

| 现象 | 原因 / 处理 |
| --- | --- |
| 浏览器报 **526** | Cloudflare 回源证书不覆盖当前域名 → 换 Origin Certificate 或改用 Full 模式 |
| **502 Bad Gateway** | 后端没跑：`systemctl status songlist` + `curl 127.0.0.1:5181/api/health` |
| **504 / 导入超时** | 站点配置里少了 `proxy_read_timeout 120s;` |
| **上传图片 413** | 站点配置里少了 `client_max_body_size 12m;` |
| **密码对却登不上 / 刷新掉线** | `COOKIE_SECURE` 和实际协议不一致（https 要 `1`，http 要 `0`） |
| 外网打不开、内网 curl 正常 | 云厂商**安全组**没放行 80/443 |
| 首页空白、控制台报 404 | 前端构建产物旧了：重跑一次 `install.sh` |
| 前台显示「数据来自 list.txt」 | `/api` 没转发过去：检查站点反代配置 |
| 忘了管理员密码 | 用附一的 reset-password 命令；**不要加 sudo** |

---

## 附三：不要做的事

1. **不要把 5181 端口开到公网** —— `app.env` 里保持 `HOST=127.0.0.1`，对外只走 Nginx 的 80/443。
2. **Cloudflare 不要用 Flexible 模式** —— 源站开强制 HTTPS 时会变成无限重定向。
3. **不要 `sudo` 跑 `reset-password.mjs`** —— 会把数据库文件属主变成 root，服务用户之后写不进去。
4. **不要手写 `ssl_certificate` 路径** —— 让 1Panel 申请/上传证书后自动写入。
5. **不要让 systemd 和面板「Node 项目」同时管这个进程** —— 会抢端口重复启动。
6. **不要直接用 `npm install` 改 `/opt/songlist/app` 的依赖** —— 那里是部署产物目录，改依赖要改源码再重跑 `install.sh`。

---

## 附四：这套东西的结构（备查）

```
/home/ubuntu/songlist/        源码（你上传、改代码的地方）
    └── 改动后要重跑 install.sh 才会生效

/opt/songlist/
├── app/                      真正在跑的代码 + dist 前端产物
├── app.env                   配置（端口、数据目录、COOKIE_SECURE…，权限 600）
└── data/                     ★ 唯一需要备份的目录
    ├── songlist.db           SQLite（歌曲、设置、资料、会话、审计）
    ├── backups/              自动备份（可在后台回滚）
    └── uploads/              头像、封面等上传图片

/www/sites/<域名>/            1Panel 站点配置（反向代理规则在 proxy/ 子目录）
```

**数据流**：浏览器 → Nginx(80/443) → Node(5181) → SQLite。
Node 每次写库后会同步再生 `dist/list.txt` 和 `dist/profile.json`，所以就算后端挂了，前台也能退回读静态文件。
