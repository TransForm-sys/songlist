#!/usr/bin/env bash
#
# 一键部署脚本（在 Linux 服务器上以 root 运行）。
#
#   bash deploy/install.sh /path/to/songlist-source
#
# 做的事情：
#   1. 建 songlist 系统用户和 /opt/songlist/{app,data} 目录
#   2. 把源码同步到 /opt/songlist/app（不动 data 目录）
#   3. 装依赖并构建前端（需要 Node >= 22.5，推荐 24）
#   4. 生成 /opt/songlist/app.env（已存在就不覆盖）
#   5. 安装并启动 systemd 服务
#
# 幂等：可以反复运行，用来升级。
set -euo pipefail

SRC="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
APP_DIR="${APP_DIR:-/opt/songlist/app}"
DATA_DIR="${DATA_DIR:-/opt/songlist/data}"
ENV_FILE="${ENV_FILE:-/opt/songlist/app.env}"
SERVICE="${SERVICE:-/etc/systemd/system/songlist.service}"
RUN_USER="${RUN_USER:-songlist}"

log() { printf '\033[36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[31m错误：\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请用 root 运行（sudo bash deploy/install.sh）"
[[ -f "$SRC/package.json" ]] || die "在 $SRC 里找不到 package.json，把源码路径作为参数传进来"

# 版本够不够：需要 >= 22.5（22.x 还得加 --experimental-sqlite），24 直接可用
version_ok() {
  local v="${1#v}"
  local major="${v%%.*}"
  local minor
  minor="$(echo "$v" | cut -d. -f2)"
  [[ "$major" -gt 22 || ( "$major" -eq 22 && "$minor" -ge 5 ) ]]
}

# 找 Node：优先用 1Panel 面板里装好的运行环境（PATH 里通常没有它）
# 用法：NODE_BIN=/path/to/node bash deploy/install.sh  可以手动指定
REQUESTED_NODE="${NODE_BIN:-}"
find_node() {
  if [[ -n "$REQUESTED_NODE" ]]; then
    [[ -x "$REQUESTED_NODE" ]] || die "NODE_BIN=$REQUESTED_NODE 不可执行"
    echo "$REQUESTED_NODE"
    return
  fi

  local candidate
  # 候选位置，按优先级：
  #   1Panel 运行环境：/opt/1panel/runtime/node/<名称>/bin/node
  #                    或 …/<名称>/node-v24.5.0-linux-x64/bin/node（解压官方 tarball 会多一层）
  #   nvm：           ~/.nvm/versions/node/<版本>/bin/node
  # 注意：用 sudo 跑时 PATH 会被重置成安全路径，nvm 里的 node 就不在 PATH 里了；
  # 但 sudo 会留下 SUDO_USER，据此可以去原用户家目录把它找出来。
  local candidates=(
    /opt/1panel/runtime/node/*/bin/node
    /opt/1panel/runtime/node/*/*/bin/node
    /opt/1panel/runtime/node/*/*/*/bin/node
    "$HOME"/.nvm/versions/node/*/bin/node
  )
  if [[ -n "${SUDO_USER:-}" ]]; then
    candidates+=(/home/"$SUDO_USER"/.nvm/versions/node/*/bin/node)
  fi

  for candidate in "${candidates[@]}"; do
    [[ -x "$candidate" ]] || continue
    if version_ok "$("$candidate" -v 2>/dev/null || echo v0)"; then
      echo "$candidate"
      return
    fi
  done

  # 兜底：把面板 runtime 目录整个搜一遍（只认可执行的 node）
  if [[ -d /opt/1panel/runtime ]]; then
    while IFS= read -r candidate; do
      [[ -n "$candidate" && -x "$candidate" ]] || continue
      if version_ok "$("$candidate" -v 2>/dev/null || echo v0)"; then
        echo "$candidate"
        return
      fi
    done < <(find /opt/1panel/runtime -maxdepth 6 -type f -name node 2>/dev/null || true)
  fi

  # 再退回系统 PATH
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  echo ""
}

NODE_BIN="$(find_node)"
[[ -n "$NODE_BIN" ]] || die "找不到 Node。要么用 1Panel 装一个 Node.js 运行环境，要么用 NODE_BIN=/path/to/node 指定"
NODE_DIR="$(dirname "$NODE_BIN")"
NPM_BIN="$NODE_DIR/npm"
NODE_VERSION="$("$NODE_BIN" -v | sed 's/^v//')"
version_ok "$NODE_VERSION" || die "Node 版本太低（当前 $NODE_VERSION）。需要 >= 22.5，推荐 24"
log "使用 Node $NODE_VERSION（$NODE_BIN）"

# 包管理器：优先 pnpm（有 lockfile），没有就用运行环境自带的 npm
if command -v pnpm >/dev/null 2>&1; then
  PKG="pnpm"
elif [[ -x "$NPM_BIN" ]]; then
  PKG="npm"
elif command -v npm >/dev/null 2>&1; then
  PKG="npm"
else
  die "既没有 pnpm 也没有 npm（$NODE_DIR 下也找不到）"
fi
log "包管理器：$PKG"

# 1. 用户与目录
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  log "创建系统用户 $RUN_USER"
  useradd --system --home-dir /opt/songlist --shell /usr/sbin/nologin "$RUN_USER"
fi
mkdir -p "$APP_DIR" "$DATA_DIR"

# 2. 同步源码（排除 node_modules / dist / data / .git）
log "同步源码到 $APP_DIR"
if command -v rsync >/dev/null; then
  rsync -a --delete \
    --exclude node_modules --exclude dist --exclude server/data --exclude .git \
    "$SRC"/ "$APP_DIR"/
else
  tar -C "$SRC" --exclude=node_modules --exclude=dist --exclude=server/data --exclude=.git -cf - . \
    | tar -C "$APP_DIR" -xf -
fi

# 3. 依赖与构建
log "安装依赖"
cd "$APP_DIR"
# 让子进程也用同一个 Node（1Panel 的运行时不在 PATH 里）
export PATH="$NODE_DIR:$PATH"
if [[ "$PKG" == "pnpm" ]]; then
  pnpm install --frozen-lockfile
  log "构建前端"
  pnpm build
else
  # 用 npm 时没有 pnpm-lock.yaml 的锁，直接按 package.json 装
  npm install --no-audit --no-fund
  log "构建前端"
  npm run build
fi
[[ -f "$APP_DIR/dist/admin.html" ]] || die "构建产物里没有 dist/admin.html，前端没构建成功"

# 3.5 构建完就把开发依赖删掉
#
# 线上只需要 dependencies（vue、pinyin-pro 等运行时包）。vite / esbuild / typescript
# 这些只在构建时用，留在服务器上纯占空间，还会让安全扫描按版本报"Vite 漏洞"。
# 想跳过这步：SKIP_PRUNE=1
if [[ "${SKIP_PRUNE:-0}" == "1" ]]; then
  log "SKIP_PRUNE=1，保留开发依赖"
else
  log "清理开发依赖（生产环境用不到 vite/esbuild）"
  if [[ "$PKG" == "pnpm" ]]; then
    # pnpm 没有稳定的 prune 子命令，用「按生产模式重装」达到同样效果
    pnpm install --prod --frozen-lockfile || log "pnpm install --prod 失败，已忽略"
  else
    npm prune --omit=dev --no-audit --no-fund || log "npm prune 失败，已忽略"
  fi
fi

# 4. 配置文件
if [[ -f "$ENV_FILE" ]]; then
  log "$ENV_FILE 已存在，保留不动"
else
  log "生成 $ENV_FILE（请检查里面的路径与开关）"
  cat > "$ENV_FILE" <<EOF
PORT=5181
HOST=127.0.0.1
DATA_DIR=$DATA_DIR
STATIC_DIR=$APP_DIR/dist
BACKUP_KEEP=60
ADMIN_USER=admin
COOKIE_SECURE=1
TRUST_PROXY=1
LOG_LEVEL=silent
EOF
  chmod 600 "$ENV_FILE"
fi

# 5. systemd（想用 1Panel 面板的「Node 项目」来托管进程时，加 SKIP_SERVICE=1 跳过这步）
if [[ "${SKIP_SERVICE:-0}" == "1" ]]; then
  log "SKIP_SERVICE=1，跳过 systemd，进程交给 1Panel 面板托管"
  chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$DATA_DIR" 2>/dev/null || true
  cat <<EOF

已装好依赖并完成构建。接下来在 1Panel 面板里新建「Node 项目」：
  项目目录    $APP_DIR
  启动方式    node
  启动文件    server/index.mjs
  端口        5181
  环境变量    DATA_DIR=$DATA_DIR  STATIC_DIR=$APP_DIR/dist  HOST=127.0.0.1  COOKIE_SECURE=1
（不要和 systemd 同时管同一个进程）

EOF
  exit 0
fi

log "安装 systemd 服务"

# Node 装在 /home 下（nvm 的常见情况）时，unit 里的 ProtectHome=true 会让服务看不见 /home，
# 结果就是 ExecStart 里的 node 根本执行不了。放宽成 read-only 就够用了。
PROTECT_HOME=true
case "$NODE_BIN" in
  /home/*|/root/*)
    PROTECT_HOME=read-only
    log "Node 位于 $NODE_BIN，单元里的 ProtectHome 放宽为 read-only"
    ;;
esac

# 把 unit 里的 node 路径和目录替换成本机实际值（Node 用的是上面找到的那个）
sed -e "s#^WorkingDirectory=.*#WorkingDirectory=$APP_DIR#" \
    -e "s#^EnvironmentFile=.*#EnvironmentFile=$ENV_FILE#" \
    -e "s#^ExecStart=.*#ExecStart=$NODE_BIN server/index.mjs#" \
    -e "s#^User=.*#User=$RUN_USER#" \
    -e "s#^Group=.*#Group=$RUN_USER#" \
    -e "s#^ReadWritePaths=.*#ReadWritePaths=$DATA_DIR#" \
    -e "s#^ProtectHome=.*#ProtectHome=$PROTECT_HOME#" \
    "$APP_DIR/deploy/songlist.service" > "$SERVICE"

chown -R "$RUN_USER:$RUN_USER" "$APP_DIR" "$DATA_DIR"
systemctl daemon-reload
systemctl enable songlist >/dev/null
systemctl restart songlist
sleep 2

log "服务状态"
systemctl --no-pager --lines=15 status songlist || true

cat <<EOF

完成。接下来：

  1. 看启动日志，第一次会打印随机管理员密码（只显示这一次）：
       journalctl -u songlist -n 40 --no-pager

  2. Nginx / 1Panel 反向代理到 127.0.0.1:5181（见 deploy/nginx-site.conf）

  3. 打开 https://你的域名/admin 登录，然后到「账号安全」改密码

  4. 备份只需要管这一个目录：
       $DATA_DIR

EOF
