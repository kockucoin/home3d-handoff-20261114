#!/bin/zsh
# 修复小米 Home OAuth 回调域名解析 + 重启 HA
# 原理：/etc/hosts 是本地静态映射，优先级最高，不产生任何外部 DNS 查询

HA_DIR="/Users/pandaking/Desktop/房屋/home-assistant"

echo "========================================"
echo " 步骤 1/5  备份 /etc/hosts"
echo "========================================"
sudo cp /etc/hosts /etc/hosts.bak.ha-oauth
echo "已备份到 /etc/hosts.bak.ha-oauth"

echo ""
echo "========================================"
echo " 步骤 2/5  添加 homeassistant.local 本地映射"
echo "========================================"
if grep -q "homeassistant.local" /etc/hosts 2>/dev/null; then
  echo "已有映射："
  grep "homeassistant.local" /etc/hosts
else
  sudo sh -c 'printf "\n# Xiaomi Home OAuth redirect (local only, no DNS query)\n127.0.0.1 homeassistant.local\n" >> /etc/hosts'
  echo "已添加：127.0.0.1 homeassistant.local"
fi

echo ""
echo "========================================"
echo " 步骤 3/5  刷新 macOS DNS 缓存"
echo "========================================"
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
echo "缓存已刷新"

echo ""
echo "========================================"
echo " 步骤 4/5  验证解析"
echo "========================================"
dscacheutil -q host -a name homeassistant.local
echo ""
echo "--- curl 测试 ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" --connect-timeout 5 --noproxy '*' http://homeassistant.local:8123 2>/dev/null || echo "(HA 还没启动，下一步会启动)"

echo ""
echo "========================================"
echo " 步骤 5/5  重启 Home Assistant"
echo "========================================"
cd "$HA_DIR" || exit 1
if [[ -f ha.pid ]] && kill -0 "$(cat ha.pid)" 2>/dev/null; then
  echo "停止旧进程 PID $(cat ha.pid) ..."
  kill "$(cat ha.pid)" 2>/dev/null
  sleep 3
  kill -9 "$(cat ha.pid)" 2>/dev/null
fi
rm -f ha.pid
echo "启动 HA ..."
zsh ./start-ha.sh

echo ""
echo "========================================"
echo " 完成"
echo "========================================"
echo "请用浏览器打开：http://homeassistant.local:8123"
echo "（注意：这次必须用 homeassistant.local，不要用 localhost）"
echo ""
echo "如果 Chrome 仍报 NXDOMAIN，重启一下 Chrome 清它自己的 DNS 缓存。"
