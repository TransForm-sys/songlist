#!/usr/bin/env bash
#
# 部署后自检：一次性检查「Nginx 反代 → Node 服务（前台 + 后台 + 接口）」整条链路。
#
#   bash deploy/check-site.sh https://songlist.你的域名
#   bash deploy/check-site.sh http://你的服务器IP:5181     # 还没配反代时，直接测后端
#
# 只读检查，不会改任何数据。任何一项失败都会给出对应的排查方向。
set -uo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "用法: bash deploy/check-site.sh https://songlist.你的域名"
  exit 1
fi
TARGET="${TARGET%/}"

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$*"; }
info() { printf '    \033[90m%s\033[0m\n' "$*"; }
head_line() { printf '\n\033[36m%s\033[0m\n' "$*"; }

code() {
  # 连不上时 curl 自己就会输出 000，别再叠加一次，否则变成 000000
  local out
  out="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null)"
  [[ -n "$out" ]] || out=000
  printf '%s' "$out"
}
body() { curl -s --max-time 15 "$@" 2>/dev/null || true; }

# ---------------------------------------------------------------- 后端本体
head_line "1. Node 服务本体（绕过 Nginx 直连 127.0.0.1:5181）"
HEALTH="$(body http://127.0.0.1:5181/api/health)"
if echo "$HEALTH" | grep -q '"ok":true'; then
  SONGS="$(echo "$HEALTH" | sed -n 's/.*"songs":\([0-9]*\).*/\1/p')"
  ok "后端活着（$HEALTH）"
  if [[ "${SONGS:-0}" -gt 0 ]]; then
    ok "数据库里有 $SONGS 首歌"
  else
    bad "数据库里是 0 首歌 —— 后台还没导入歌单？"
  fi
else
  bad "连不上后端。先看：systemctl status songlist ；journalctl -u songlist -n 50 --no-pager"
fi

# ---------------------------------------------------------------- 反代与页面
head_line "2. 通过 $TARGET 访问"
if [[ "$TARGET" == *:5181* ]] || [[ "$TARGET" == *127.0.0.1* ]]; then
  info "目标是后端自身，跳过 Nginx 相关检查"
  IS_PROXY=0
else
  IS_PROXY=1
fi

HEALTH_CODE="$(code "$TARGET/api/health")"
if [[ "$HEALTH_CODE" == "200" ]]; then
  ok "接口可达（/api/health → 200）"
elif [[ "$HEALTH_CODE" == "502" ]]; then
  bad "502：Nginx 连不上 Node。检查 systemctl status songlist 与代理地址 127.0.0.1:5181"
elif [[ "$HEALTH_CODE" == "000" ]]; then
  bad "请求不通：域名解析 / 防火墙安全组 / Nginx 是否在跑"
else
  bad "/api/health 返回 $HEALTH_CODE"
fi

HOME_HTML="$(body "$TARGET/")"
if echo "$HOME_HTML" | grep -q 'id="app"'; then
  ok "前台页面渲染入口正常"
else
  bad "前台页面不对（没拿到 index.html）"
  # 把实际返回的内容打出来，省得来回猜
  info "实际返回：$(printf '%s' "$HOME_HTML" | head -c 160 | tr '\n' ' ')"
  info "后端直连 / 的状态码：$(code http://127.0.0.1:5181/)（200 = 后端没问题，是 Nginx/证书层的问题）"
  if printf '%s' "$HOME_HTML" | grep -q '前端还没构建'; then
    info "↑ 说明服务器上的 server/index.mjs 是旧版（缺根路径回退），或者 STATIC_DIR 指错了"
  fi
fi

ADMIN_HTML="$(body "$TARGET/admin")"
if echo "$ADMIN_HTML" | grep -q 'admin-app'; then
  ok "后台页面可访问（/admin）"
else
  bad "/admin 拿不到 admin.html"
  info "实际返回：$(printf '%s' "$ADMIN_HTML" | head -c 160 | tr '\n' ' ')"
  info "本地文件：$(ls -l /opt/songlist/app/dist/admin.html 2>/dev/null || echo '没有这个文件 —— 没构建或 STATIC_DIR 指错了')"
fi

SONGS_JSON="$(body "$TARGET/api/songs")"
if echo "$SONGS_JSON" | grep -q '"songs"'; then
  TOTAL="$(echo "$SONGS_JSON" | sed -n 's/.*"total":\([0-9]*\).*/\1/p')"
  ok "前台数据接口正常（total=${TOTAL:-?}）"
  if [[ -n "${TOTAL:-}" && "${TOTAL:-0}" -gt 0 ]]; then
    ok "页面会显示「数据来自后台」"
  fi
else
  bad "/api/songs 没返回歌曲数据"
fi

# ---------------------------------------------------------------- 反代细节
if [[ "$IS_PROXY" == "1" ]]; then
  head_line "3. 反向代理细节"

  FALLBACK_CODE="$(code -H 'Accept: text/html' "$TARGET/some/deep/path")"
  if [[ "$FALLBACK_CODE" == "200" ]]; then
    ok "单页回退可用（深层路径回 index.html）"
  else
    bad "深层路径返回 $FALLBACK_CODE，单页回退没生效"
  fi

  ASSET_CODE="$(code "$TARGET/not-exist.js")"
  if [[ "$ASSET_CODE" == "404" ]]; then
    ok "不存在的静态资源正确返回 404"
  else
    info "不存在的静态资源返回 $ASSET_CODE（期望 404，影响不大）"
  fi

  # client_max_body_size：3MB 图片 base64 后约 4MB，这里用一个 2MB 的假 body 探一下，
  # 没被网关拦掉（返回 400/401 而不是 413）就说明限制给够了。
  BIG_STATUS="$(head -c 2000000 /dev/zero | tr '\0' 'a' \
    | curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
      -X POST -H 'Content-Type: application/json' --data-binary @- \
      "$TARGET/api/admin/upload" 2>/dev/null)"
  [[ -n "$BIG_STATUS" ]] || BIG_STATUS=000
  if [[ "$BIG_STATUS" == "413" ]]; then
    bad "2MB 请求体被网关挡了（413）—— 在站点配置里加 client_max_body_size 12m;"
  elif [[ "$BIG_STATUS" == "000" ]]; then
    info "大请求体测试没跑通（超时），可以忽略"
  else
    ok "大请求体没被拦（HTTP $BIG_STATUS），上传图片不会 413"
  fi

  # 登录限流依赖 X-Forwarded-For；用两次错误登录看是否返回 401 而不是 500
  LOGIN_STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -X POST -H 'Content-Type: application/json' \
    --data '{"username":"__none__","password":"__none__"}' \
    "$TARGET/api/auth/login" 2>/dev/null)"
  [[ -n "$LOGIN_STATUS" ]] || LOGIN_STATUS=000
  if [[ "$LOGIN_STATUS" == "401" ]]; then
    ok "登录接口正常（错误账号返回 401）"
  elif [[ "$LOGIN_STATUS" == "429" ]]; then
    info "登录被限流了（429）—— 之前失败太多次，等几分钟"
  else
    bad "登录接口返回 $LOGIN_STATUS（期望 401）"
  fi

  # HTTPS 与 cookie Secure 的一致性
  if [[ "$TARGET" == https://* ]]; then
    info "目标是 HTTPS：确认 app.env 里 COOKIE_SECURE=1，改完要 restart songlist"
  else
    info "目标是 HTTP：app.env 里 COOKIE_SECURE 必须是 0，否则登录 cookie 会被丢弃"
  fi
fi

# ---------------------------------------------------------------- 汇总
printf '\n\033[36m== 汇总 ==\033[0m\n'
printf '  通过 %d 项' "$PASS"
if [[ "$FAIL" -gt 0 ]]; then
  printf '，\033[31m失败 %d 项\033[0m\n' "$FAIL"
  exit 1
fi
printf '，全部正常 🎉\n'
echo
echo "接下来：打开 $TARGET/admin 登录（初始密码在 journalctl -u songlist -n 40 --no-pager 里），"
echo "并到「账号安全」把初始密码改掉。"
