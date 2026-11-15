// 3D 中控卡片加载器：HA 会让浏览器缓存 /local 文件 31 天，
// 这里每次带上时间戳去取 home3d-card.js，改完卡片刷新页面就能看到新版，不用重启 HA。
import(`/local/home3d/home3d-card.js?t=${Date.now()}`);
