#!/bin/zsh
# 干净重启 Home Assistant（不带 1 小时自动停止定时器）
HA_DIR="/Users/pandaking/Desktop/房屋/home-assistant"
URL="http://homeassistant.local:8123/config/dashboard"

cd "$HA_DIR" || exit 1

echo "=== 1. 取消之前的 1 小时自动停止定时器 ==="
FOUND=0
for p in $(pgrep -f "sleep 3600" 2>/dev/null); do
  kill "$p" 2>/dev/null && { echo "  已取消定时器 PID $p"; FOUND=1; }
done
[[ $FOUND -eq 0 ]] && echo "  无残留定时器"

echo ""
echo "=== 2. 停止当前 HA ==="
zsh "./停止HA.command"

# 兜底：确认 8123 端口已释放
for i in {1..5}; do
  BUSY=$(lsof -i :8123 -t 2>/dev/null)
  [[ -z "$BUSY" ]] && break
  echo "  端口 8123 仍被占用，清理 PID $BUSY"
  kill -9 $BUSY 2>/dev/null
  sleep 1
done
rm -f ha.pid

echo ""
echo "=== 3. 启动 HA ==="
zsh ./start-ha.sh

echo ""
echo "=== 4. 检查域名解析 ==="
if dscacheutil -q host -a name homeassistant.local 2>/dev/null | grep -q "127.0.0.1"; then
  echo "  homeassistant.local -> 127.0.0.1  OK"
  open "$URL"
  echo "  已打开 $URL"
else
  echo "  !! homeassistant.local 仍解析不了"
  echo "     需先跑 fix-xiaomi-oauth.sh 加 hosts 映射"
  echo "     临时可用：http://localhost:8123/config/dashboard"
  open "http://localhost:8123/config/dashboard"
fi

echo ""
echo "查看日志：tail -f \"$HA_DIR/ha.log\""
