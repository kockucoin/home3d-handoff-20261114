#!/bin/zsh
# 停止 Home Assistant
cd "$(dirname "$0")"
PID_FILE="ha.pid"

if [[ -f $PID_FILE ]] && kill -0 "$(cat $PID_FILE)" 2>/dev/null; then
  PID=$(cat $PID_FILE)
  kill "$PID"
  for i in {1..30}; do
    kill -0 "$PID" 2>/dev/null || { rm -f $PID_FILE; echo "Home Assistant 已停止"; exit 0; }
    sleep 1
  done
  kill -9 "$PID" 2>/dev/null
  rm -f $PID_FILE
  echo "Home Assistant 已强制停止"
else
  rm -f $PID_FILE
  echo "Home Assistant 没有在运行"
fi
