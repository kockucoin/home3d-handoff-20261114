// 3D 中控卡片加载器：HA 会让浏览器缓存 /local 文件 31 天，
// 这里每次带上时间戳去取 home3d-card.js，改完卡片刷新页面就能看到新版，不用重启 HA。
import(`/local/home3d/home3d-card.js?t=${Date.now()}`);
// kiosk-mode v15.0.0（NemesisRE/kiosk-mode，sha256 b54c2405…，用户已同意加载）：
// 手机等窄屏上隐藏 HA 顶栏和侧边栏。规则写在 home3d-dashboard.yaml 的 kiosk_mode 里，只对「3D 中控」生效。
import('/local/home3d/kiosk-mode.js?v=15.0.0');
