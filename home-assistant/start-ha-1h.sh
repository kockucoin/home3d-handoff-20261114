#!/bin/zsh
# 启动 Home Assistant 并在 1 小时后自动停止
# 基于现有的 start-ha.sh 脚本，增加了定时停止功能

cd "$(dirname "$0")"
PID_FILE="ha.pid"
HA_DIR="$(pwd)"

# 1. 检查是否已在运行
if [[ -f $PID_FILE ]] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  PID=$(cat $PID_FILE)
  echo "Home Assistant 已经在运行（PID $PID）：http://localhost:8123"
else
  # 2. 启动 HA
  nohup .venv/bin/hass -c config > ha.log 2>&1 &
  PID=$!
  echo $PID > $PID_FILE
  echo "Home Assistant 启动中（PID $PID）…"

  # 3. 等待就绪（最多 6 分钟）
  for i in {1..180}; do
    if curl -s -o /dev/null http://localhost:8123; then
      echo "已就绪：http://localhost:8123   （iPad / 手机：http://$(ipconfig getifaddr en0):8123）"
      break
    fi
    if ! kill -0 "$PID" 2>/dev/null; then
      echo "启动失败，请查看 ha.log"
      exit 1
    fi
    sleep 2
  done
fi

# 4. 设置 1 小时后自动停止
echo ""
echo "⏰ 已设置 1 小时（3600 秒）后自动停止"
echo "   停止时间：$(date -v+3600S '+%H:%M:%S')"
echo ""
echo "提前停止：运行「停止HA.command」或执行 kill $PID"
echo "查看日志：tail -f \"$HA_DIR/ha.log\""

# 5. 后台等待，到时间自动 kill
(sleep 3600 && kill "$PID" 2>/dev/null && rm -f "$HA_DIR/$PID_FILE" && echo "[$(date)] Auto-stopped after 1 hour" >> "$HA_DIR/ha.log") &
echo "后台定时器已启动，你可以关闭这个终端窗口，HA 会继续运行直到 1 小时后自动停止。"
