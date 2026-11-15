#!/bin/zsh
# 启动 Home Assistant（和「启动HA.command」相同，英文文件名方便在终端里输入）
# 后台运行：关掉终端窗口、Claude 退出都不会停；Mac 重启或关机后需要再运行一次
cd "$(dirname "$0")"
PID_FILE="ha.pid"

if [[ -f $PID_FILE ]] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  echo "Home Assistant 已经在运行（PID $(cat $PID_FILE)）：http://localhost:8123"
  exit 0
fi

nohup .venv/bin/hass -c config > ha.log 2>&1 &
echo $! > $PID_FILE
echo "Home Assistant 启动中（PID $!）…"

for i in {1..180}; do
  if curl -s -o /dev/null http://localhost:8123; then
    echo "已就绪：http://localhost:8123   （iPad / 手机：http://$(ipconfig getifaddr en0):8123）"
    exit 0
  fi
  if ! kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
    echo "启动失败，请查看 ha.log"
    exit 1
  fi
  sleep 2
done
echo "等待超时，HA 可能还在初始化，稍后打开 http://localhost:8123 或查看 ha.log"
