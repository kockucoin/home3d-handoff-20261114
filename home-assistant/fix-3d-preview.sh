#!/bin/zsh
# 让 3D 预览页能在 HA 里访问，并检测 three.js CDN 是否可达

SRC="/Users/pandaking/Desktop/房屋/3D模型/preview.html"
WWW="/Users/pandaking/Desktop/房屋/home-assistant/config/www/home3d"

echo "=== 1. 复制 preview.html 到 HA 静态目录 ==="
mkdir -p "$WWW"
cp "$SRC" "$WWW/preview.html"
echo "  -> $WWW/preview.html"

echo ""
echo "=== 2. 检查 HA 自定义卡片文件 ==="
if [[ -f "$WWW/home3d-card.js" ]]; then
  echo "  home3d-card.js 存在，大小 $(du -h "$WWW/home3d-card.js" | cut -f1)"
else
  echo "  !! home3d-card.js 不存在，需要在 3D模型/ 下运行 node build.mjs"
fi

echo ""
echo "=== 3. 检测 three.js CDN 可达性 ==="
CDN="https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"
CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 8 "$CDN" 2>/dev/null)
echo "  jsDelivr HTTP: ${CODE:-无响应}"
if [[ "$CODE" == "200" ]]; then
  echo "  CDN 正常 —— 3D 应该能渲染"
else
  echo "  !! CDN 不可达：3D 页面/卡片都会白屏（three.js 加载不到）"
  echo "     这很可能是你 DNS/代理环境导致的，需要把 three.js 本地化"
fi

echo ""
echo "=== 4. 访问地址（HA 需处于运行状态） ==="
echo "  3D 预览页： http://homeassistant.local:8123/local/home3d/preview.html"
echo "  3D 中控卡片： http://homeassistant.local:8123/home-3d"
echo ""
echo "  若要在控制台里嵌预览页，在 dashboard 加一个 iframe 卡片："
echo "    - type: iframe"
echo "      url: /local/home3d/preview.html"
echo "      aspect_ratio: 100%"
