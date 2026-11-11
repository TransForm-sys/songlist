# 交接文档 · HANDOFF

> **用途**：新会话 / 隔天开工时，只看这一份就能接上，不用翻聊天记录。
> **最后更新**：2026-11-01（明天开工前）
> **下次任务**：① 侧栏式布局改版 ② 付费曲标记

---

## 0. 30 秒速览

| 项目 | 值 |
| --- | --- |
| 本机源码 | `D:\13935\website-opt\songlist`（Vue 3 + Vite + TypeScript） |
| 服务器源码 | `/home/ubuntu/songlist` |
| 服务器运行 | `/opt/songlist/app`（由 `deploy/install.sh` 同步+构建+重启） |
| 数据 | `/opt/songlist/data`（SQLite + 备份 + 上传图片） |
| 线上地址 | `https://example.com`（http 301 → https） |
| 线上数据 | **648 首**，主播名「临小渺」 |
| 另一台项目 | `D:\13935\website-opt\we_sing_laugh_and_live`（Astro，给「临小为」，**与本项目无关，别混**） |

**一句话**：站已经上线可用，明天要做的是**换一套侧栏式布局** + **加"付费曲"标记**。

---

## 1. 三份代码，别搞混

```
本机 D:\...\songlist          ← 改代码的地方
   │  上传（1Panel 文件管理 / rsync）
   ▼
/home/ubuntu/songlist         ← 服务器上的"原料"
   │  sudo bash deploy/install.sh（rsync + npm install + build + 重启）
   ▼
/opt/songlist/app             ← 真正在跑的代码 + dist 产物
```

**铁律：上传 ≠ 生效。** 改完 `src/` 或 `server/` 必须重跑一次 install.sh：

```bash
sudo env NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node RUN_USER=ubuntu \
     bash /home/ubuntu/songlist/deploy/install.sh /home/ubuntu/songlist
```

`scripts/**`、`docs/**`、`*.md` 不影响线上，传不传都行。

---

## 2. 线上现状（2026-11-01 核实过）

| 项目 | 状态 |
| --- | --- |
| `https://example.com/api/health` | ✅ `{"ok":true,"songs":648}` |
| 点歌格式 | ✅ 已是新版 `` `点歌 ${歌名}`（只带歌名） ``（空格，不是全角冒号） |
| SC 相关 UI | ✅ 无 SC 数据时全站隐藏（含公开的 `list.txt` 不再有 SC 列） |
| 构建 | ✅ 线上 chunk = 最新（`main-4HvvFvzP.js` + `style-C22GYLON.js`） |
| 旧域名 `songlist.example.org` | ⚠️ **DNS 已不解析**（A 记录没了，443 TCP 不通）—— 若还要保留跳转需重新加解析 |
| **ICP 备案** | ✅ **已通过**，线上 ICP 号已更新为 `京ICP备0000000号-1` |
| **公安备案** | ✅ **已通过**：`京公网安备00000000000000号`（链接用官方 `#/query/webSearch?code=` 路径，代码已改） |
| 前台布局 | ✅ **已改为侧栏式**（全屏背景 + 520px 侧栏，歌单可左/右切换），移动端空间预算六条已全部落地 |
| 歌单数据 | ✅ `public/list.txt` 已按 **按类型歌单.xlsx** 重新生成：**648 首**（中文625/日语12/粤语7/英文4）；备注里 6 首「付费曲」从旧 TSV 合并保留 |
| 公开内容敏感词扫描 | ✅ `list.txt` / `api/profile` / `api/songs` 均未命中（付费/打赏/礼物/SC 等） |

---

## 3. 已经做完的（别再重做）

**前台**：拼音搜索（全拼/首字母）、分面筛选（语种/曲风/歌手，带数量）、单击复制点歌文本、虚拟滚动、明暗主题记忆、公告条、主播简介弹窗、移动端适配、`?theme=` 与 `#profile` 深链、接口优先+静态回退。

**后台**：登录（scrypt + 会话 cookie + 限流）、曲库 CRUD、拼音搜索、分面筛选、分页、多选批量删/置顶/置底、拖拽排序、批量导入（TSV/CSV、合并列自动拆语种·曲风、整行去重、疑似重复提示）、主播资料（含图片上传）、站点设置（含 ICP/公安备案号）、备份与回滚、导出 `list.txt`、改密码、审计日志。

**部署**：systemd 服务、install.sh（自动探测 nvm/1Panel 的 node、ProtectHome 自适应）、check-site.sh 自检、Docker 方案、DEPLOY.md。

**文档**：`docs/RUNBOOK.md`（运维手册）、`docs/LAYOUT-PLAN.md`（布局方案）、`server/API.md`（接口契约）、`DEPLOY.md`、`README.md`。

---

## 4. 当前进度（2026-11-02）

### ✅ A. 侧栏式布局改版 —— 已完成并全绿

- 桌面 ≥1024px：全屏背景 + **520px 侧栏**，左下/右下箭头切换左右（`localStorage` 记忆 + 首屏内联脚本防闪）
- 768–1023px：侧栏 46vw
- <768px：单列、背景压暗、**滚动时标题/公告自动折叠**、筛选变贴底弹层
- 列表项：编号 + 歌名（大字）+ 副行（歌手 · 语种 · 曲风）；**无表头**
- 新增：背景图（后台上传 + 焦点 top/center/bottom）、随机一首（滚动定位 + 高亮 + 复制）、筛选聚合面板（语种/曲风/歌手/SC，歌手默认前 60 位可搜）
- 保留：虚拟滚动、搜索、筛选、复制格式、SC「无数据即隐藏」
- 移动端空间预算：列表占屏 **46% → 71%**
- 页脚：`数据来自后台 · ICP备案号 · 🛡️公安备案号`（图标在号码前、同一链接，官方 `#/query/webSearch` 路径）

关键文件：`src/app-shell.css`（新增，加载在 style.css 之后）、`src/components/FilterPanel.vue`（新增）、`src/composables/useSide.ts`（新增）

### ✅ B. 付费曲标记 —— 已完成（方案 A）

**语义**：点这首歌本身要付费 / 需要礼物（与 SC 同类，不是"平台会员才能听"）。
**数据**：备注列里 **6 首**（阿刁 / 百万个吻 / 好汉歌 / 好运来 / 情歌王 / 达拉崩吧）。

**做法（方案 A：图标无文字）**
- 判定：`src/utils/flags.ts` 的 `isPaidSong(note)` —— 备注含「付费 / 收费」即视为需要额外条件
- 呈现：列表行歌名后一个**礼物盒图标**，`title` / `aria-label` 写「点歌有额外要求」，**页面上没有任何文字**
- 说明：`hasPaidSongs` 为真时，公告下面多一行「带此图标的曲目点歌有额外要求，详见直播间规则」
- 后台：编辑歌曲 → 备注写「付费曲」即生效（输入框占位提示已注明）
- **不做筛选**（会带出"付费曲"字样）；不改剪贴板内容（仍是 `点歌 歌名`）

**验证**：`layout-shots` 断言「有额外要求的曲目带礼物图标」+「页面不出现 付费/礼物/打赏/价格/购买」→ **23/23 通过**

---

## 5. 备案相关（影响 UI 措辞）

- 表单已填/建议：**服务名称 = 歌单整理分享**（个人备案不能含人名/地名/公司/经营性词；`临小渺` 是网名，**不能**用）
- 网站类型 = **Z 其他**（千万别选 D8 网络文化类，会牵出《网络文化经营许可证》前置审批）
- 「是否提供互联网交互服务」= **否**（访客只能搜索/复制，无注册/评论/上传）
- 个人备案只能做**非经营性**：页面上不要出现"购买/付费/价格/交易/打赏"等字眼
- 公安备案：新域名上线后 30 天内办理

---

## 6. 代码地图

| 文件 | 作用 |
| --- | --- |
| `src/App.vue` | 前台整页结构（改版主战场） |
| `src/components/SongList.vue` | 列表 + 虚拟滚动（行结构要改） |
| `src/components/FilterSelect.vue` | 多选下拉（可复用成"筛选面板"） |
| `src/components/SearchField.vue` / `ProfileModal.vue` | 搜索框 / 简介弹窗 |
| `src/composables/useSongList.ts` | 数据加载、筛选、分面统计、`hasScSongs` |
| `src/composables/useVirtualList.ts` | 虚拟滚动（要补 `scrollToIndex` 给"随机一首"） |
| `src/composables/useTheme.ts` | 主题（左右切换可照抄这套） |
| `src/config.ts` | **点歌文本模板**（唯一一处，改格式只改这里） |
| `src/style.css` | 前台样式（~1100 行，改版会大改布局段） |
| `server/index.mjs` | 后端入口：静态服务 + API + 启动自检 |
| `server/routes.mjs` | 全部接口 |
| `server/lib/db.mjs` | 表结构与设置项（新增 `background` 改这里） |
| `server/lib/export.mjs` | 导出 `list.txt`（无 SC 数据时省略该列） |
| `server/lib/importList.mjs` | 服务端解析器（与前端 `src/utils/parse.ts` 口径必须一致） |
| `src/admin/**` | 后台界面（设置页要加"背景图"上传） |
| `scripts/e2e.mjs` | 前台端到端（改版后需重写） |
| `scripts/e2e-admin.mjs` | 后台端到端 |
| `scripts/api-test.mjs` | 接口测试（临时实例，不碰真实数据） |
| `scripts/verify.ts` | 解析器/导出/搜索自检 |

---

## 7. 测试设施与基线（2026-11-02）

```bash
pnpm verify                # 数据管道 + 解析器 + 导出列      → 全部通过
node scripts/api-test.mjs  # 接口                            → 67/67
node scripts/e2e.mjs       # 前台（自带临时实例 + 截图）      → 28/28
node scripts/e2e-admin.mjs # 后台（自带临时实例，端口 5191）  → 54/54
node scripts/layout-shots.mjs # 布局视觉 + 备案合规断言        → 23/23
```

测试自带临时实例（`.tmp/` 下、端口 5191/5197/5199），不会碰 `server/data`；截图落在 `.shots/`。
两者都已加进 `.gitignore`。

---

## 8. 踩过的坑（别再踩）

1. **上传 ≠ 生效**：必须重跑 `install.sh`（rsync → npm install → build → 重启）。
2. **`sudo` 会重置 PATH**：nvm 的 node 找不到 → 用 `sudo env NODE_BIN=...` 显式指定。
3. **`ProtectHome=true`** 会让服务看不见 `/home` 下的 node → 单元里要 `read-only`（install.sh 已自适应）。
4. **`pnpm` 有时不在 PATH** → 用 `node node_modules/vite/bin/vite.js build`。
5. **npm `allowScripts` 按版本固定会失效**：lockfile 里没有 `resolved` 时 npm 无法匹配 `esbuild@0.28.2` → 必须用**按名字**的 `"esbuild": true`。
6. **本机 curl 的 schannel 坏了**（`SEC_E_NO_CREDENTIALS`）：验证 https 请用 **node fetch** 或 `web_fetch`，别用 curl 下结论。
7. **1Panel 站点目录是 `/www/sites/<域名>/`**，反向代理规则在 `proxy/*.conf`（主配置里看不到 `proxy_pass` 是正常的）。
8. **看 bundle 判断"某个 UI 是否可见"会误判**：`v-if` 编译后字符串仍在包里。要验证可见性，用浏览器读 DOM（我之前用临时实例 + CDP 做过）。
9. **导出去重按整行**；同名同歌手只提示"疑似重复"，不会丢数据。
10. **解析器两端必须一致**：`src/utils/parse.ts` 与 `server/lib/importList.mjs`，`verify.ts` 里有断言守着。
11. **`list.txt` 是公开可访问的**，别往里塞敏感字样。
12. 改 DNS/证书后浏览器要 **Ctrl+F5**，否则看到的是旧缓存。

---

## 9. 常用命令

```bash
# 部署/更新
sudo env NODE_BIN=/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node RUN_USER=ubuntu \
     bash /home/ubuntu/songlist/deploy/install.sh /home/ubuntu/songlist

# 站点自检（11 项）
bash /opt/songlist/app/deploy/check-site.sh https://example.com

# 服务日志 / 状态
journalctl -u songlist -n 50 --no-pager
systemctl status songlist --no-pager

# 改/重置管理员密码（★ 不要 sudo）
cd /opt/songlist/app
/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node scripts/reset-password.mjs \
  --data-dir /opt/songlist/data --generate

# 换歌单（命令行）
cd /opt/songlist/app
/home/ubuntu/.nvm/versions/node/v24.21.0/bin/node scripts/reset-data.mjs \
  --data-dir /opt/songlist/data --import /home/ubuntu/歌单.tsv --replace --yes --streamer "临小渺"

# 本机开发预览
cd D:\13935\website-opt\songlist
pnpm dev:all      # 前台 5180 + 后端 5181
```

---

## 10. 明天开工的第一步（建议顺序）

1. **先问用户**：付费曲用哪个方案（A/B/C/D，见 4.B）——这条决定 UI 措辞，也影响备案
2. **再确认**：侧栏改版是否仍在 `songlist` 这个项目做（不是 Astro 那个）
3. **然后按 `docs/LAYOUT-PLAN.md` 实施第一步**：静态布局 + 背景图 + 左右切换（数据/筛选/复制逻辑不动），交付截图给用户验收
4. 验收通过后再做：随机一首、筛选面板、付费曲标记、移动端打磨
5. 每轮结束跑 `pnpm build` + `verify` + `test:api` + `e2e`（重写后）+ `e2e:admin`，绿了再交付

---

## 11. 文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/HANDOFF.md` | ← 本文件，开工先看这个 |
| `docs/LAYOUT-PLAN.md` | 侧栏改版方案（截图拆解 + CSS 架构 + 风险） |
| `docs/RUNBOOK.md` | 运维手册（部署/备份/切换域名/排障） |
| `server/API.md` | 后端接口契约 |
| `DEPLOY.md` | 1Panel 部署完整步骤 |
| `README.md` | 项目总览 |
