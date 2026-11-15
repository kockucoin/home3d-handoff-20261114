#!/bin/zsh
# 诊断 Home Assistant 连接小米服务器的网络问题

echo "========================================"
echo "  Home Assistant x 小米 连接诊断"
echo "========================================"
echo ""

echo "=== 1. 当前 DNS 服务器 ==="
echo "Wi-Fi:"
networksetup -getdnsservers Wi-Fi 2>/dev/null
echo ""
echo "系统 DNS (scutil):"
scutil --dns 2>/dev/null | grep "nameserver\[" | head -10
echo ""
echo "/etc/resolv.conf:"
cat /etc/resolv.conf 2>/dev/null || echo "  (不可读)"
echo ""

echo "=== 2. 测试小米服务器 DNS 解析 ==="
echo "--- account.xiaomi.com (OAuth 登录) ---"
dig +short account.xiaomi.com 2>/dev/null || nslookup account.xiaomi.com 2>/dev/null | tail -5
echo ""
echo "--- api.io.mi.com (米家 API) ---"
dig +short api.io.mi.com 2>/dev/null || nslookup api.io.mi.com 2>/dev/null | tail -5
echo ""
echo "--- mihome.com ---"
dig +short mihome.com 2>/dev/null || nslookup mihome.com 2>/dev/null | tail -5
echo ""

echo "=== 3. 测试 .local 域名解析 ==="
echo "--- homeassistant.local ---"
dig +short homeassistant.local 2>/dev/null || nslookup homeassistant.local 2>/dev/null | tail -5
echo ""

echo "=== 4. 测试小米服务器连通性 ==="
echo "--- account.xiaomi.com HTTPS ---"
curl -sI --connect-timeout 5 https://account.xiaomi.com 2>/dev/null | head -5 || echo "  连接失败"
echo ""
echo "--- api.io.mi.com HTTPS ---"
curl -sI --connect-timeout 5 https://api.io.mi.com 2>/dev/null | head -5 || echo "  连接失败"
echo ""

echo "=== 5. HA 日志中的小米相关错误 ==="
grep -i "xiaomi\|miio\|micloud\|oauth\|account.xiaomi" "/Users/pandaking/Desktop/房屋/home-assistant/ha.log" 2>/dev/null | tail -20 || echo "  日志中暂无小米相关记录"
echo ""

echo "=== 6. HA 配置摘要 ==="
echo "Country: $(python3 -c "import json; d=json.load(open('/Users/pandaking/Desktop/房屋/home-assistant/config/.storage/core.config')); print(d['data']['country'])" 2>/dev/null)"
echo "Timezone: $(python3 -c "import json; d=json.load(open('/Users/pandaking/Desktop/房屋/home-assistant/config/.storage/core.config')); print(d['data']['time_zone'])" 2>/dev/null)"
echo ""

echo "=== 7. 测试用公共 DNS 解析小米 ==="
echo "--- 用 223.5.5.5 (阿里DNS) 解析 account.xiaomi.com ---"
dig +short @223.5.5.5 account.xiaomi.com 2>/dev/null || echo "  无法通过阿里DNS解析"
echo ""
echo "--- 用 8.8.8.8 (Google DNS) 解析 account.xiaomi.com ---"
dig +short @8.8.8.8 account.xiaomi.com 2>/dev/null || echo "  无法通过Google DNS解析"
echo ""

echo "=== 8. 代理/VPN 检测 ==="
echo "HTTP_PROXY: ${HTTP_PROXY:-未设置}"
echo "HTTPS_PROXY: ${HTTPS_PROXY:-未设置}"
echo "http_proxy: ${http_proxy:-未设置}"
echo "https_proxy: ${https_proxy:-未设置}"
echo "ALL_PROXY: ${ALL_PROXY:-未设置}"
echo ""
echo "系统代理 (Wi-Fi):"
networksetup -getwebproxy Wi-Fi 2>/dev/null
echo "SOCKS 代理 (Wi-Fi):"
networksetup -getsocksfirewallproxy Wi-Fi 2>/dev/null
echo ""

echo "========================================"
echo "  诊断完成，请将以上输出完整贴给我"
echo "========================================"
