#!/bin/zsh
# 在“离唱片机近、带蓝牙”的 Mac 上安装 whatplus-bridge 为开机常驻（LaunchAgent）。
#
#   ./install.sh                 # HA 和桥接在同一台 Mac：只监听 127.0.0.1
#   ./install.sh --lan           # HA 在另一台 Mac：监听 0.0.0.0（仍需令牌）
#   ./install.sh --port 8765
#
# 结束时打印要粘到 HA 的 config/secrets.yaml 里的七行。
set -euo pipefail
cd "${0:A:h}"

HOST=127.0.0.1
PORT=8765
while (( $# )); do
  case $1 in
    --lan) HOST=0.0.0.0 ;;
    --port) PORT=$2; shift ;;
    *) echo "未知参数 $1"; exit 1 ;;
  esac
  shift
done

LABEL=local.home3d.whatplus-bridge
APP_DIR="$HOME/Applications"
APP="$APP_DIR/WhatPlusBridge.app"
CONF_DIR="$HOME/.config/whatplus-bridge"
TOKEN_FILE="$CONF_DIR/token"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/whatplus-bridge.log"

./build.sh
mkdir -p "$APP_DIR" "$CONF_DIR" "$HOME/Library/LaunchAgents"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
rm -rf "$APP"
cp -R build/WhatPlusBridge.app "$APP"

if [[ ! -s "$TOKEN_FILE" ]]; then
  umask 077
  openssl rand -hex 24 > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$APP/Contents/MacOS/whatplus-bridge</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>WHATPLUS_HOST</key><string>$HOST</string>
    <key>WHATPLUS_PORT</key><string>$PORT</string>
    <key>WHATPLUS_TOKEN_FILE</key><string>$TOKEN_FILE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$UID" "$PLIST"
sleep 2
if curl -s "http://127.0.0.1:$PORT/health" | grep -q '"ok":true'; then
  echo "✅ 已启动，日志：$LOG"
else
  echo "⚠️ 没有响应，看日志：$LOG"
fi
echo "第一次运行会弹出「WhatPlusBridge 想使用蓝牙」，请点允许。"

if [[ $HOST == 127.0.0.1 ]]; then
  BASE="http://127.0.0.1:$PORT"
else
  IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "<这台Mac的IP>")
  BASE="http://$IP:$PORT"
fi
cat <<EOF

—— 把下面七行加到 HA 的 config/secrets.yaml ——
whatplus_auth: "Bearer $(cat "$TOKEN_FILE")"
whatplus_light_url: "$BASE/v1/light"
whatplus_music_url: "$BASE/v1/music"
whatplus_state_url: "$BASE/v1/state"
whatplus_refresh_url: "$BASE/v1/state?refresh=1"
whatplus_mac_music_url: "$BASE/v1/mac/music"
whatplus_mac_state_url: "$BASE/v1/mac/state"
EOF
