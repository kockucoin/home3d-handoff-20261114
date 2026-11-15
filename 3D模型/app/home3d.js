// 我家 3D 中控 —— 可旋转的"玩具屋"户型 + 设备图标 + 控制卡片
// 用法：createHome3D(容器, house.json 数据, { onCommand })，返回 { setState, getState, flyTo, overview }
// onCommand(id, patch) 在用户操作时触发；以后接 Home Assistant 时，在这里把命令发给 HA，
// 再用 setState(id, patch) 把 HA 推来的真实状态同步回 3D。不传 onCommand 时为纯模拟。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const M = v => v / 1000;                         // mm → m
const P = (x, y, z = 0) => new THREE.Vector3(M(x), M(z), M(y)); // 平面图 (x 东, y 南, z 高) → 世界坐标
const DEG = Math.PI / 180;

// ================= 纹理（全部用 canvas 现场生成，不需要下载素材） =================
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const TEX = {};
function texWood() {
  return TEX.wood ||= canvasTex(1024, 1024, (g, w, h) => {
    const r = rng(7), rows = 6, ph = h / rows;
    for (let i = 0; i < rows; i++) {
      let x = -r() * w * 0.6;
      while (x < w) {
        const len = w * (0.45 + r() * 0.5), tone = 0.86 + r() * 0.2;
        const base = [176 * tone, 120 * tone, 72 * tone];
        g.fillStyle = `rgb(${base.map(Math.round)})`; g.fillRect(x, i * ph, len, ph);
        for (let k = 0; k < 26; k++) {                 // 木纹
          const y = i * ph + r() * ph, a = 0.04 + r() * 0.08;
          g.strokeStyle = `rgba(70,40,20,${a})`; g.lineWidth = 1 + r() * 2;
          g.beginPath(); g.moveTo(x, y);
          for (let s = 0; s <= 8; s++) g.lineTo(x + (len * s) / 8, y + Math.sin(s * 0.9 + r() * 2) * 3);
          g.stroke();
        }
        g.fillStyle = 'rgba(40,22,10,.55)'; g.fillRect(x, i * ph, 2, ph); // 板缝
        x += len;
      }
      g.fillStyle = 'rgba(40,22,10,.5)'; g.fillRect(0, i * ph, w, 2);
    }
  });
}
function texTile(kind) {
  return TEX['tile' + kind] ||= canvasTex(512, 512, (g, w, h) => {
    if (kind === 'K') {          // 厨房：白灰菱形花砖
      g.fillStyle = '#ecebe6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c9ccd2';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = (i + 0.5) * w / 4, cy = (j + 0.5) * h / 4, s = w / 10;
        g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.fill();
      }
      g.strokeStyle = '#b7b9bd'; g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / 4); g.lineTo(w, i * h / 4); g.stroke(); }
    } else {
      const base = kind === 'B' ? '#dfe4e8' : '#cdc8c0', line = kind === 'B' ? '#b9c0c6' : '#aaa59d', n = kind === 'B' ? 6 : 3;
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      const r = rng(kind.charCodeAt(0));
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = `rgba(0,0,0,${r() * 0.04})`; g.fillRect(i * w / n, j * h / n, w / n, h / n); }
      g.strokeStyle = line; g.lineWidth = 3;
      for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * w / n, 0); g.lineTo(i * w / n, h); g.stroke(); g.beginPath(); g.moveTo(0, i * h / n); g.lineTo(w, i * h / n); g.stroke(); }
    }
  });
}
function texNoise(key, lo = 0.82, hi = 1, scale = 1) {   // 布料/地毯：灰度噪点，乘以材质颜色
  return TEX['n' + key] ||= canvasTex(256, 256, (g, w, h) => {
    const r = rng(key.length * 97 + 3), img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = (i / w) | 0;
      const v = (lo + (hi - lo) * (0.6 * r() + 0.4 * (0.5 + 0.5 * Math.sin((x + y) * scale * 0.7)))) * 255;
      img.data.set([v, v, v, 255], i * 4);
    }
    g.putImageData(img, 0, 0);
  });
}
function texWeave() {                                    // 藤编 / 编织灯罩
  return TEX.weave ||= canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#c99a5b'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(90,55,20,.55)'; g.lineWidth = 3;
    for (let i = -h; i < w + h; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke();
    }
  });
}
function texPaper() {                                    // 纸灯笼的横向竹骨
  return TEX.paper ||= canvasTex(64, 256, (g, w, h) => {
    g.fillStyle = '#fbf8f1'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(150,140,120,.35)';
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 2);
  });
}
function texFold() {                                     // 罗马帘横向褶
  return TEX.fold ||= canvasTex(64, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= 8; i++) { grd.addColorStop(i / 8, '#ffffff'); if (i < 8) grd.addColorStop((i + 0.85) / 8, '#d9d6cf'); }
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
}
function texPainting(style) {
  return TEX['p' + style] ||= canvasTex(256, 384, (g, w, h) => {
    if (style === 'checker') {     // 走廊挂画：上棋盘格、中米色圆点、下蓝色竖条
      g.fillStyle = '#1f2f6b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#efe7d6'; g.fillRect(16, 16, w - 32, h - 32);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { g.fillStyle = (i + j) % 2 ? '#222' : '#eee'; g.fillRect(40 + i * 29, 40 + j * 22, 29, 22); }
      g.fillStyle = '#c73a2e';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(60 + i * 45, 150 + j * 32, 7, 0, 7); g.fill(); }
      for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#e9e4f5' : '#5566c8'; g.fillRect(40 + i * 20, 290, 20, 70); }
    } else {                       // 客厅挂画：窗外的粉色花枝
      const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#d9e8f2'); grd.addColorStop(1, '#f3efe6');
      g.fillStyle = grd; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.strokeRect(30, 30, w - 60, h - 60); g.beginPath(); g.moveTo(w / 2, 30); g.lineTo(w / 2, h - 30); g.stroke();
      const r = rng(11);
      for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(${220 + r() * 30},${120 + r() * 60},${150 + r() * 50},.8)`; g.beginPath(); g.arc(30 + r() * 140, 40 + r() * 220, 4 + r() * 10, 0, 7); g.fill(); }
      g.strokeStyle = '#6b4a35'; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 300); g.quadraticCurveTo(90, 160, 170, 60); g.stroke();
    }
  }, { repeat: false });
}
function texScreen() {
  return TEX.screen ||= canvasTex(256, 144, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, '#3a4fd8'); grd.addColorStop(0.55, '#9a4fd0'); grd.addColorStop(1, '#ff8a5c');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '600 22px -apple-system,sans-serif'; g.fillText('正在播放', 18, h - 22);
  }, { repeat: false });
}
function texBackground(night) {
  return TEX['bg' + night] ||= canvasTex(16, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    if (night) { grd.addColorStop(0, '#1b1c2e'); grd.addColorStop(1, '#3a3157'); }
    else { grd.addColorStop(0, '#c9c6dc'); grd.addColorStop(1, '#8f88b5'); }
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

// ================= 材质 =================
const MATS = new Map();
function mat(color, o = {}) {
  const key = color + JSON.stringify(o, (k, v) => (v && v.isTexture ? v.uuid : v));
  if (!MATS.has(key)) MATS.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...o }));
  return MATS.get(key);
}
const fabric = c => mat(c, { map: texNoise('fab', 0.8, 1, 1.4), roughness: 0.95 });
const woodM = c => mat(c, { roughness: 0.6 });
const metal = c => mat(c, { metalness: 0.85, roughness: 0.3 });
const glass = (c = '#cfe8f2', op = 0.28) => mat(c, { transparent: true, opacity: op, roughness: 0.05, depthWrite: false });

// ================= 几何小工具（单位 m，局部坐标：原点在地面中心，正面朝 +Z） =================
function rbox(w, h, d, r, m) {
  const rr = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
  return new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, rr), m);
}
function cylM(rt, rb, h, m, seg = 32) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); }
function at(parent, mesh, x, y, z, rx = 0, ry = 0, rz = 0) { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); parent.add(mesh); return mesh; }
function place(g, x, y, rot = 180, z = 0) {      // rot：家具正面朝向（0 北 / 90 东 / 180 南 / 270 西）
  g.position.copy(P(x, y, z)); g.rotation.y = Math.PI - rot * DEG; return g;
}

// ================= 家具 =================
const B = {
  sofa({ w, d, color }) {
    const g = new THREE.Group(); w = M(w); d = M(d);
    const f = fabric(color), dark = fabric(new THREE.Color(color).multiplyScalar(0.85).getStyle());
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) at(g, cylM(0.025, 0.02, 0.07, woodM('#3b2a1e')), sx * (w / 2 - 0.08), 0.035, sz * (d / 2 - 0.08));
    at(g, rbox(w, 0.22, d, 0.04, dark), 0, 0.18, 0);
    const arm = 0.16, n = w > 1.7 ? 3 : 2, cw = (w - arm * 2) / n;
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + arm + cw * (i + 0.5);
      at(g, rbox(cw - 0.012, 0.15, d - 0.22, 0.06, f), x, 0.36, 0.08);
      at(g, rbox(cw - 0.02, 0.42, 0.2, 0.08, f), x, 0.62, -d / 2 + 0.23, -0.14);
    }
    at(g, rbox(w, 0.52, 0.16, 0.04, dark), 0, 0.55, -d / 2 + 0.08);
    for (const s of [-1, 1]) at(g, rbox(arm, 0.36, d, 0.06, dark), s * (w / 2 - arm / 2), 0.45, 0);
    at(g, rbox(0.55, 0.05, d * 0.75, 0.02, fabric('#d8d4cc')), -w / 2 + arm + 0.35, 0.455, 0.02, 0, 0, 0.03); // 搭毯
    return g;
  },
  bed({ w, l, frame, sheet, duvet, pillow }) {
    const g = new THREE.Group(); w = M(w); l = M(l);
    const fm = woodM(frame);
    at(g, rbox(w + 0.08, 1.0, 0.07, 0.025, fm), 0, 0.5, -l / 2 - 0.035);
    at(g, rbox(w + 0.08, 0.42, 0.06, 0.02, fm), 0, 0.21, l / 2 + 0.03);
    for (const s of [-1, 1]) at(g, rbox(0.06, 0.2, l, 0.015, fm), s * (w / 2 + 0.01), 0.22, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) at(g, rbox(0.07, 0.14, 0.07, 0.01, fm), sx * (w / 2 - 0.02), 0.07, sz * (l / 2 - 0.02));
    at(g, rbox(w - 0.02, 0.2, l - 0.02, 0.05, fabric(sheet)), 0, 0.38, 0);
    const du = rbox(w + 0.04, 0.11, l * 0.64, 0.05, fabric(duvet)); at(g, du, 0, 0.52, l * 0.18);
    at(g, rbox(w * 0.7, 0.13, 0.32, 0.06, fabric(duvet)), w * 0.1, 0.58, l * 0.0, 0, 0.25, 0.08); // 掀起的一角
    for (const s of [-1, 1]) at(g, rbox(w * 0.42, 0.13, 0.38, 0.065, fabric(pillow)), s * w * 0.23, 0.54, -l / 2 + 0.28, -0.25);
    return g;
  },
  nightstand({ color }) {
    const g = new THREE.Group(), m = woodM(color);
    at(g, rbox(0.45, 0.5, 0.4, 0.02, m), 0, 0.3, 0);
    for (const s of [-1, 1]) for (const t of [-1, 1]) at(g, cylM(0.015, 0.012, 0.05, m), s * 0.19, 0.025, t * 0.16);
    at(g, rbox(0.41, 0.004, 0.005, 0.001, mat('#555')), 0, 0.33, 0.2);
    for (const y of [0.2, 0.43]) at(g, new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), metal('#c8a86a')), 0, y, 0.205);
    return g;
  },
  wardrobe({ w, d, h, color }) {
    const g = new THREE.Group(); w = M(w); d = M(d); h = M(h);
    at(g, rbox(w, h, d, 0.015, woodM(color)), 0, h / 2, 0);
    at(g, rbox(0.004, h - 0.06, 0.004, 0.001, mat('#9b968c')), 0, h / 2, d / 2 + 0.001);
    for (const s of [-1, 1]) at(g, rbox(0.015, 0.32, 0.02, 0.006, metal('#bcbcbc')), s * 0.04, h * 0.55, d / 2 + 0.012);
    return g;
  },
  tvCabinet({ w, d, h, color }) {
    const g = new THREE.Group(); w = M(w); d = M(d); h = M(h);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) at(g, cylM(0.018, 0.012, 0.12, woodM('#3a2418')), sx * (w / 2 - 0.06), 0.06, sz * (d / 2 - 0.06));
    at(g, rbox(w, h - 0.12, d, 0.015, woodM(color)), 0, 0.12 + (h - 0.12) / 2, 0);
    const n = 4, dw = (w - 0.04) / n;
    for (let i = 0; i < n; i++) {
      const blue = i % 2 === 0, x = -w / 2 + 0.02 + dw * (i + 0.5);
      at(g, rbox(dw - 0.012, h - 0.18, 0.012, 0.004, mat(blue ? '#253f9c' : '#f1eee6')), x, 0.12 + (h - 0.12) / 2, d / 2 + 0.004);
      const disc = cylM(0.075, 0.075, 0.006, mat(blue ? '#f1eee6' : '#253f9c')); disc.rotation.x = Math.PI / 2;
      at(g, disc, x, 0.12 + (h - 0.12) / 2, d / 2 + 0.012, Math.PI / 2);
    }
    return g;
  },
  tv({ w, h }) {
    const g = new THREE.Group(); w = M(w); h = M(h);
    at(g, rbox(w, h, 0.035, 0.008, mat('#111216', { roughness: 0.35 })), 0, h / 2, 0);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.03, h - 0.03), new THREE.MeshStandardMaterial({ color: '#05060a', roughness: 0.15, emissive: '#ffffff', emissiveMap: texScreen(), emissiveIntensity: 0 }));
    at(g, screen, 0, h / 2, 0.019); g.userData.screen = screen;
    return g;
  },
  tableRound({ r, h }) {
    const g = new THREE.Group(); r = M(r); h = M(h);
    at(g, cylM(r, r, 0.03, mat('#f4f4f2', { roughness: 0.35 }), 64), 0, h - 0.015, 0);
    at(g, cylM(0.1, 0.12, h - 0.06, woodM('#8a5a33')), 0, (h - 0.06) / 2 + 0.03, 0);
    for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) {            // 立柱上的圆孔装饰
      const a = (k / 6) * Math.PI * 2, y = 0.18 + i * 0.13;
      at(g, new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mat('#2a1a10')), Math.sin(a) * 0.105, y, Math.cos(a) * 0.105);
    }
    at(g, cylM(0.28, 0.3, 0.03, woodM('#3d2a1d')), 0, 0.015, 0);
    at(g, cylM(0.035, 0.03, 0.1, mat('#ffffff')), 0.12, h + 0.05, -0.05);   // 桌上的杯子
    return g;
  },
  rattanChair() {
    const g = new THREE.Group(), rt = mat('#c99a5b', { map: texWeave(), roughness: 0.9, side: THREE.DoubleSide }), leg = woodM('#a8753f');
    for (const [x, z] of [[-0.17, 0.16], [0.17, 0.16], [-0.17, -0.16], [0.17, -0.16]]) at(g, cylM(0.014, 0.014, 0.46, leg, 10), x, 0.23, z);
    at(g, cylM(0.24, 0.22, 0.05, rt), 0, 0.47, 0);
    at(g, new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.38, 24, 1, true, Math.PI / 2, Math.PI), rt), 0, 0.7, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.016, 8, 24, Math.PI), leg); at(g, rim, 0, 0.89, 0, -Math.PI / 2, 0, Math.PI);
    return g;
  },
  armchair({ color }) {
    const g = new THREE.Group(), lea = mat(color, { roughness: 0.45 }), leg = woodM('#6b4a30');
    for (const [x, z] of [[-0.26, 0.22], [0.26, 0.22], [-0.26, -0.22], [0.26, -0.22]]) at(g, cylM(0.018, 0.012, 0.26, leg, 10), x, 0.13, z);
    at(g, rbox(0.64, 0.14, 0.58, 0.05, lea), 0, 0.33, 0.02);
    at(g, rbox(0.62, 0.5, 0.12, 0.05, lea), 0, 0.62, -0.25, -0.18);
    for (const s of [-1, 1]) at(g, rbox(0.08, 0.06, 0.56, 0.025, lea), s * 0.33, 0.56, 0.0);
    for (const s of [-1, 1]) at(g, rbox(0.04, 0.2, 0.04, 0.01, leg), s * 0.33, 0.45, 0.22);
    return g;
  },
  officeChair({ color }) {
    const g = new THREE.Group(), blk = mat('#222'), c = fabric(color);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; at(g, rbox(0.3, 0.03, 0.04, 0.01, blk), Math.sin(a) * 0.14, 0.06, Math.cos(a) * 0.14, 0, a + Math.PI / 2); at(g, new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), blk), Math.sin(a) * 0.28, 0.025, Math.cos(a) * 0.28); }
    at(g, cylM(0.025, 0.025, 0.36, metal('#888')), 0, 0.25, 0);
    at(g, rbox(0.5, 0.08, 0.48, 0.03, c), 0, 0.47, 0);
    at(g, rbox(0.46, 0.56, 0.06, 0.04, c), 0, 0.84, -0.24, -0.1);
    return g;
  },
  coffeeOval({ rx, ry, h }) {
    const g = new THREE.Group(); rx = M(rx); ry = M(ry); h = M(h);
    const top = cylM(1, 1, 0.012, glass('#bfe3ee', 0.4), 64); top.scale.set(rx, 1, ry); at(g, top, 0, h, 0);
    for (const [x, z] of [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) at(g, cylM(0.008, 0.008, h, metal('#d0d3d6'), 8), x * rx, h / 2, z * ry);
    at(g, new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 16), mat('#d9d4cc')), 0.05, h + 0.012, 0.1, Math.PI / 2);
    return g;
  },
  pouf({ r, h, color }) {
    const g = new THREE.Group(); r = M(r); h = M(h);
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), fabric(color)); s.scale.set(r, h / 2 * 1.15, r); at(g, s, 0, h / 2, 0);
    return g;
  },
  plant({ r, h }) {
    const g = new THREE.Group(); r = M(r); h = M(h);
    at(g, cylM(r, r * 0.78, r * 1.4, mat('#e9e4da', { roughness: 0.5 })), 0, r * 0.7, 0);
    const rr = rng(Math.round(r * 1e4)), leaf = [mat('#3f7a3a', { flatShading: true }), mat('#4f8e45', { flatShading: true }), mat('#356a32', { flatShading: true })];
    const n = Math.max(5, Math.round(h * 12));
    for (let i = 0; i < n; i++) {
      const t = i / n, a = rr() * Math.PI * 2, d = r * (0.3 + rr() * 1.1) * (1 - t * 0.4);
      at(g, new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.45 + rr() * 0.45), 0), leaf[i % 3]), Math.sin(a) * d, r * 1.4 + t * (h - r * 1.4) + 0.05, Math.cos(a) * d, rr(), rr(), rr());
    }
    return g;
  },
  shelfOpen({ w, d, h }) {
    const g = new THREE.Group(); w = M(w); d = M(d); h = M(h);
    const wm = mat('#f4f4f2', { roughness: 0.4 });
    for (const s of [-1, 1]) at(g, rbox(0.02, h, d, 0.004, wm), s * (w / 2 - 0.01), h / 2, 0);
    for (const y of [0.03, h * 0.36, h * 0.68, h - 0.01]) at(g, rbox(w, 0.02, d, 0.004, wm), 0, y, 0);
    const r = rng(5), cols = ['#c0392b', '#2c3e50', '#e6b34a', '#7f8c8d', '#d35400', '#1f6f8b'];
    for (const y of [0.04, h * 0.37]) { let x = -w / 2 + 0.04; while (x < w / 2 - 0.08) { const bw = 0.03 + r() * 0.05, bh = 0.12 + r() * 0.12; at(g, rbox(bw, bh, d * 0.6, 0.004, mat(cols[(r() * cols.length) | 0])), x + bw / 2, y + bh / 2 + 0.01, 0); x += bw + 0.01; } }
    at(g, cylM(0.06, 0.06, 0.2, mat('#222')), -w / 2 + 0.12, h + 0.1, 0);   // 水壶
    return g;
  },
  painting({ w, h, style }) {
    const g = new THREE.Group(); w = M(w); h = M(h);
    at(g, rbox(w, h, 0.03, 0.004, mat(style === 'checker' ? '#1f2f6b' : '#f2f2f2')), 0, h / 2, 0);
    at(g, new THREE.Mesh(new THREE.PlaneGeometry(w - 0.04, h - 0.04), mat('#ffffff', { map: texPainting(style), roughness: 0.8 })), 0, h / 2, 0.016);
    return g;
  },
  ac({ w }) {
    const g = new THREE.Group(); w = M(w);
    at(g, rbox(w, 0.29, 0.2, 0.05, mat('#fbfbfb', { roughness: 0.4 })), 0, 0.145, 0.1);
    at(g, rbox(w - 0.1, 0.02, 0.01, 0.004, mat('#3a3a3a')), 0, 0.04, 0.2);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshStandardMaterial({ color: '#333', emissive: '#55e0ff', emissiveIntensity: 0 }));
    at(g, led, w / 2 - 0.08, 0.2, 0.2); g.userData.led = led;
    return g;
  },
  desk({ w, d }) {
    const g = new THREE.Group(); w = M(w); d = M(d);
    const m = woodM('#d8cfbf');
    at(g, rbox(w, 0.03, d, 0.008, m), 0, 0.735, 0);
    for (const s of [-1, 1]) at(g, rbox(0.03, 0.72, d - 0.04, 0.006, m), s * (w / 2 - 0.03), 0.36, 0);
    at(g, rbox(0.34, 0.24, 0.02, 0.006, mat('#1a1a1a')), -0.1, 0.9, -d / 2 + 0.12, -0.1);   // 笔记本
    at(g, cylM(0.08, 0.1, 0.03, mat('#333')), w / 2 - 0.15, 0.765, -d / 2 + 0.12);
    return g;
  },
  monitor({ w }) {
    const g = new THREE.Group(); w = M(w);
    at(g, rbox(0.22, 0.015, 0.16, 0.005, mat('#2a2a2a')), 0, 0.008, 0);
    at(g, rbox(0.04, 0.2, 0.03, 0.006, mat('#2a2a2a')), 0, 0.11, -0.03);
    at(g, rbox(w, 0.36, 0.03, 0.008, mat('#121212', { roughness: 0.3 })), 0, 0.36, 0);
    return g;
  },
  washer() {
    const g = new THREE.Group();
    at(g, rbox(0.6, 0.85, 0.6, 0.03, mat('#f5f5f3', { roughness: 0.35 })), 0, 0.425, 0);
    const door = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 10, 32), mat('#c8ccd0', { metalness: 0.6, roughness: 0.3 })); at(g, door, 0, 0.42, 0.305);
    const win = cylM(0.15, 0.15, 0.01, glass('#2c3640', 0.8)); at(g, win, 0, 0.42, 0.302, Math.PI / 2);
    at(g, rbox(0.5, 0.06, 0.01, 0.004, mat('#d8dadc')), 0, 0.78, 0.302);
    return g;
  },
  lounge() {
    const g = new THREE.Group(), fr = metal('#3a3a3a');
    at(g, rbox(0.62, 0.08, 0.62, 0.03, fabric('#5b5b5b')), 0, 0.36, 0.05);
    at(g, rbox(0.62, 0.55, 0.08, 0.03, fabric('#5b5b5b')), 0, 0.62, -0.26, -0.35);
    for (const s of [-1, 1]) at(g, rbox(0.025, 0.4, 0.7, 0.01, fr), s * 0.32, 0.2, 0);
    return g;
  },
  toilet() {
    const g = new THREE.Group(), w = mat('#fbfbfb', { roughness: 0.2 });
    at(g, rbox(0.38, 0.38, 0.17, 0.04, w), 0, 0.6, -0.22);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), w); bowl.scale.set(0.19, 0.4, 0.25); at(g, bowl, 0, 0.4, 0.04, Math.PI);
    const seat = cylM(1, 1, 0.03, w); seat.scale.set(0.19, 1, 0.25); at(g, seat, 0, 0.415, 0.04);
    return g;
  },
  vanity({ w }) {
    const g = new THREE.Group(); w = M(w);
    at(g, rbox(w, 0.45, 0.45, 0.02, woodM('#e9e4da')), 0, 0.55, 0);
    at(g, rbox(w + 0.02, 0.07, 0.47, 0.02, mat('#ffffff', { roughness: 0.15 })), 0, 0.81, 0);
    at(g, cylM(0.015, 0.015, 0.16, metal('#d6d6d6')), 0, 0.92, -0.16);
    at(g, rbox(w * 0.85, 0.7, 0.02, 0.01, mat('#cfd8de', { metalness: 1, roughness: 0.05 })), 0, 1.5, -0.22);
    return g;
  },
};
// 世界坐标直接给出范围的家具
const BW = {
  rug(o) { const m = new THREE.Mesh(new THREE.BoxGeometry(M(o.x2 - o.x1), 0.012, M(o.y2 - o.y1)), mat(o.color, { map: texNoise('rug', 0.85, 1, 3), roughness: 1 })); m.position.copy(P((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, 6)); return m; },
  counter(o) {
    const g = new THREE.Group(), w = M(o.x2 - o.x1), d = M(o.y2 - o.y1), h = M(o.h);
    at(g, rbox(w, h - 0.1, d, 0.006, woodM(o.color)), 0, 0.1 + (h - 0.1) / 2, 0);
    at(g, new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, 0.1, d - 0.06), mat('#3a3a3a')), 0, 0.05, 0);
    at(g, rbox(w + 0.02, 0.04, d + 0.02, 0.006, mat('#cfcfcd', { roughness: 0.3 })), 0, h + 0.02, 0);
    g.position.copy(P((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2)); return g;
  },
  upperCabinet(o) { const m = rbox(M(o.x2 - o.x1), M(o.z2 - o.z1), M(o.y2 - o.y1), 0.006, woodM(o.color)); m.position.copy(P((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2, (o.z1 + o.z2) / 2)); return m; },
  sink(o) { const g = new THREE.Group(); at(g, rbox(0.5, 0.02, 0.4, 0.01, metal('#a9aeb3')), 0, 0.885, 0); at(g, cylM(0.012, 0.012, 0.25, metal('#ddd')), 0, 1.0, -0.18); g.position.copy(P(o.x, o.y)); return g; },
  stove(o) { const g = new THREE.Group(); at(g, rbox(0.5, 0.01, 0.6, 0.005, mat('#0d0d0f', { roughness: 0.1 })), 0, 0.893, 0); for (const z of [-0.14, 0.14]) at(g, new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.008, 6, 24), mat('#555')), 0, 0.9, z, Math.PI / 2); g.position.copy(P(o.x, o.y)); return g; },
  deskL(o) {
    const g = new THREE.Group(), top = woodM('#6e4527'), leg = mat('#222');
    const slab = (x1, y1, x2, y2) => { const m = rbox(M(x2 - x1), 0.03, M(y2 - y1), 0.006, top); m.position.copy(P((x1 + x2) / 2, (y1 + y2) / 2, 735)); g.add(m); };
    slab(o.x1, o.y1, o.x2, o.y2); slab(o.x1, o.ry1, o.rx2, o.y1);
    for (const [x, y] of [[o.x1 + 60, o.ry1 + 60], [o.x1 + 60, o.y2 - 60], [o.x2 - 60, o.y2 - 60], [o.x2 - 60, o.y1 + 60]]) { const m = rbox(0.05, 0.72, 0.05, 0.01, leg); m.position.copy(P(x, y, 360)); g.add(m); }
    return g;
  },
  shower(o) {
    const g = new THREE.Group(), w = M(o.x2 - o.x1), d = M(o.y2 - o.y1);
    at(g, rbox(w, 0.05, d, 0.01, mat('#f3f3f3')), 0, 0.025, 0);
    at(g, new THREE.Mesh(new THREE.BoxGeometry(0.01, 1.9, d), glass()), w / 2, 0.95, 0);
    at(g, cylM(0.012, 0.012, 1.9, metal('#d0d0d0')), -w / 2 + 0.08, 0.95, -d / 2 + 0.08);
    at(g, cylM(0.08, 0.06, 0.02, metal('#d0d0d0')), -w / 2 + 0.18, 1.9, -d / 2 + 0.18);
    g.position.copy(P((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2)); return g;
  },
  baySeat(o) {
    const g = new THREE.Group(), w = M(o.x2 - o.x1), d = M(o.y2 - o.y1);
    at(g, new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), mat('#e8e3da', { roughness: 0.6 })), 0, 0.225, 0);
    at(g, rbox(w - 0.1, 0.06, d - 0.1, 0.025, fabric('#d9cbb4')), 0, 0.48, 0.02);
    at(g, rbox(0.4, 0.3, 0.12, 0.05, fabric('#2d2d2d')), w / 2 - 0.4, 0.62, -d / 2 + 0.2, -0.2, 0.3);
    g.position.copy(P((o.x1 + o.x2) / 2, (o.y1 + o.y2) / 2)); return g;
  },
};

// ================= 灯具外形 =================
function buildLamp(l) {
  const g = new THREE.Group(), glow = [];       // glow：开灯时发光的网格
  const shade = (o = {}) => { const m = new THREE.MeshStandardMaterial({ color: '#f7f4ec', roughness: 0.8, emissive: '#ffcf8a', emissiveIntensity: 0, side: THREE.DoubleSide, ...o }); glow.push(m); return m; };
  const cord = (from, to, c = '#cccccc') => at(g, cylM(0.004, 0.004, M(to - from), mat(c), 6), M(l.x), M((from + to) / 2), M(l.y));
  const X = M(l.x), Y = M(l.y);
  if (l.shape === 'lantern') {
    cord(2400, 2700);
    const s = new THREE.Mesh(new THREE.SphereGeometry(M(l.s), 40, 24), shade({ map: texPaper(), emissiveMap: texPaper() })); at(g, s, X, M(2150), Y);
  } else if (l.shape === 'drum') {
    cord(2120, 2700, '#bbbbbb');
    at(g, new THREE.Mesh(new THREE.CylinderGeometry(M(l.s) * 0.72, M(l.s), 0.28, 40, 1, true), shade()), X, M(1980), Y);
    at(g, new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), shade({ color: '#ffffff' })), X, M(1880), Y);
  } else if (l.shape === 'woven') {
    cord(2330, 2700, '#222222');
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), shade({ map: texWeave(), emissiveMap: texWeave(), color: '#f3e4c8', transparent: true, opacity: 0.92 }));
    s.scale.set(M(l.s), M(l.s) * 0.55, M(l.s)); at(g, s, X, M(2200), Y);
  } else if (l.shape === 'mushroom') {
    at(g, cylM(0.02, 0.05, 0.22, mat('#f0e6d2')), X, M(1000) + 0.11, Y);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shade({ color: '#ffe2b8' })); at(g, cap, X, M(1000) + 0.2, Y);
  } else if (l.shape === 'square' || l.shape === 'round') {
    const geo = l.shape === 'square' ? new THREE.BoxGeometry(M(l.s), 0.06, M(l.s)) : new THREE.CylinderGeometry(M(l.s), M(l.s), 0.06, 40);
    at(g, new THREE.Mesh(geo, shade({ color: '#ffffff' })), X, M(2660), Y);
  } else if (l.shape === 'bulb') {
    cord(2600, 2700, '#eeeeee');
    at(g, new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 12), shade({ color: '#ffffff', transparent: true, opacity: 0.95 })), X, M(2560), Y);
  } else if (l.shape === 'floor') {
    at(g, cylM(0.13, 0.14, 0.02, mat('#222')), X, 0.01, Y);
    at(g, cylM(0.01, 0.01, 1.62, metal('#b9bcc0'), 8), X, 0.83, Y);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.09, 0.12, 24, 1, true), shade({ color: '#eeeeee' })); at(g, head, X, 1.62, Y);
  }
  g.userData.glow = glow;
  return g;
}
// 灯光强度（坎德拉，三维场景按米计）
const LIGHT_POWER = { lantern: 6.5, drum: 3.5, woven: 4, square: 4, round: 2.5, bulb: 3, floor: 1.4, mushroom: 0.7 };
function kelvinRGB(k) {          // 色温 → 颜色（近似）
  const t = k / 100; let r, g, b;
  r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
  g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755);
  b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
  return new THREE.Color(...[r, g, b].map(v => Math.min(255, Math.max(0, v)) / 255));
}

// ================= 界面样式与图标 =================
const CSS = `
.h3{position:absolute;inset:0;overflow:hidden;font:14px/1.4 -apple-system,"PingFang SC","Helvetica Neue",sans-serif;color:#fff;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.h3 canvas{display:block;touch-action:none}
.h3-bar{position:absolute;top:max(12px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:18px;background:rgba(28,28,36,.72);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:calc(100% - 24px);box-sizing:border-box;flex-wrap:wrap;justify-content:center}
.h3-clock b{font-size:22px;font-weight:600;letter-spacing:.5px;display:block;line-height:1}.h3-clock small{opacity:.7;font-size:11px}
.h3-sum{font-size:12px;opacity:.85;white-space:nowrap}
.h3-btns{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}
.h3-btn{border:0;border-radius:11px;padding:7px 11px;background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.h3-btn:active{transform:scale(.96)}.h3-btn.on{background:#f5b84a;color:#2a1d05}
.h3-layer{position:absolute;inset:0;pointer-events:none}
.h3-ico{position:absolute;left:0;top:0;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:0;padding:0;display:grid;place-items:center;background:rgba(30,30,38,.78);color:#fff;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);transition:background .2s,color .2s,box-shadow .2s}
.h3-ico svg{width:17px;height:17px}
.h3-ico.on{background:#ffd27a;color:#3a2600;box-shadow:0 0 0 3px rgba(255,210,122,.35),0 0 18px rgba(255,200,100,.7)}
.h3-ico.sel{outline:2px solid #fff;outline-offset:2px}
.h3-room{position:absolute;left:0;top:0;transform:translate(-50%,-50%);padding:3px 9px;border-radius:9px;background:rgba(20,20,28,.62);font-size:12px;pointer-events:auto;cursor:pointer;white-space:nowrap;border:0;color:#fff;font-family:inherit}
.h3-card{position:absolute;right:16px;bottom:max(16px,env(safe-area-inset-bottom));width:300px;padding:16px;border-radius:20px;background:rgba(28,28,36,.86);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);box-shadow:0 12px 40px rgba(0,0,0,.4);box-sizing:border-box;pointer-events:auto}
.h3-card[hidden]{display:none}
.h3-card h3{margin:0;font-size:17px;display:flex;align-items:center;gap:8px}.h3-card .sub{opacity:.6;font-size:12px;margin:2px 0 12px}
.h3-x{position:absolute;right:12px;top:12px;width:28px;height:28px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:16px;cursor:pointer}
.h3-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:10px 0}
.h3-row label{font-size:13px;opacity:.8}
.h3-sw{width:52px;height:30px;border-radius:15px;border:0;background:rgba(255,255,255,.2);position:relative;cursor:pointer;flex:none}
.h3-sw::after{content:"";position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:left .2s}
.h3-sw.on{background:#34c759}.h3-sw.on::after{left:25px}
.h3 input[type=range]{width:100%;accent-color:#ffd27a;height:28px}
.h3-seg{display:flex;gap:6px}.h3-seg .h3-btn{flex:1}
.h3-temp{display:flex;align-items:center;gap:12px}.h3-temp b{font-size:28px;font-weight:600;min-width:70px;text-align:center}
.h3-toast{position:absolute;left:50%;bottom:max(70px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:10px 16px;border-radius:12px;background:rgba(200,50,50,.92);color:#fff;font-size:14px;pointer-events:none;opacity:0;transition:opacity .3s;max-width:80%;text-align:center}
.h3-toast.show{opacity:1}
.h3-hint{position:absolute;left:16px;bottom:max(14px,env(safe-area-inset-bottom));font-size:12px;opacity:.6;pointer-events:none}
@media (max-width:640px){.h3-card{left:10px;right:10px;width:auto}.h3-hint{display:none}.h3-clock b{font-size:18px}}
`;
const ICON = {
  light: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2zm-3 18h6v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-1z"/></svg>',
  blind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 4h18M5 4v16M19 4v16M8 8h8M8 12h8M8 16h8"/></svg>',
  ac: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="8" rx="2"/><path d="M7 17l-1 3M12 17v3M17 17l1 3"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18"/><circle cx="14.5" cy="12" r="1" fill="currentColor"/></svg>',
};

// ================= 主函数 =================
function createHome3D(container, data, opts = {}) {
  // 样式放进容器所在的根（HA 卡片在 shadow DOM 里，document.head 的样式进不去）
  const styleHost = container.getRootNode() instanceof ShadowRoot ? container.getRootNode() : document.head;
  if (!styleHost.querySelector('#h3-style')) { const s = document.createElement('style'); s.id = 'h3-style'; s.textContent = CSS; styleHost.appendChild(s); }
  const root = document.createElement('div'); root.className = 'h3'; container.appendChild(root);
  const touch = matchMedia('(pointer: coarse)').matches;
  const W = () => root.clientWidth, Hh = () => root.clientHeight;

  // ---- 渲染器 ----
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, touch ? 1.5 : 2));
  renderer.setSize(W(), Hh());
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;           // 场景静止：只在状态变化时重算阴影，省电
  root.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(35, W() / Hh(), 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 3; controls.maxDistance = 40; controls.maxPolarAngle = 80 * DEG;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };

  // ---- 后期：灯光辉光（环境光遮蔽 GTAO 会在背景上产生暗块，已移除） ----
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), Hh()), 0.5, 0.5, 0.85);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---- 灯光：白天 / 夜晚 ----
  const hemi = new THREE.HemisphereLight('#dfe6ff', '#8a7a66', 0.6); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e0', 2.6); sun.position.set(-6, 16, 22); sun.target.position.set(3.5, 0, 6.3);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 50 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // ---- 墙体 ----
  const H = M(data.H);
  const wallSide = mat('#f3f1ec', { roughness: 0.92 }), wallCap = mat('#4b505a', { roughness: 0.8 });
  const wallMats = [wallSide, wallSide, wallCap, wallSide, wallSide, wallSide];
  const walls = [];                                 // { mesh, z1, z2, out }
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const OUT = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  for (const p of data.walls) {
    const w = M(p.x2 - p.x1), d = M(p.y2 - p.y1), z1 = M(p.z1), z2 = M(p.z2);
    let mesh;
    if (p.group === 'glass') {
      mesh = new THREE.Group();
      const horiz = w > d, len = horiz ? w : d, hgt = z2 - z1;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(horiz ? len : 0.01, hgt, horiz ? 0.01 : len), glass('#cfe6f0', 0.22)); mesh.add(pane);
      const fr = mat('#fafafa', { roughness: 0.5 }), t = 0.045;
      const bar = (lx, ly, lw, lh) => { const b = new THREE.Mesh(new THREE.BoxGeometry(horiz ? lw : 0.06, lh, horiz ? 0.06 : lw), fr); b.position.set(horiz ? lx : 0, ly, horiz ? 0 : lx); b.castShadow = true; mesh.add(b); };
      bar(0, hgt / 2 - t / 2, len, t); bar(0, -hgt / 2 + t / 2, len, t); bar(-len / 2 + t / 2, 0, t, hgt); bar(len / 2 - t / 2, 0, t, hgt);
      const n = Math.max(1, Math.round(len / 0.9)); for (let i = 1; i < n; i++) bar(-len / 2 + (len * i) / n, 0, t * 0.8, hgt);
    } else if (p.group === 'door') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, z2 - z1, d), woodM('#6e4a2c')); mesh.castShadow = true;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(w, z2 - z1, d), wallMats); mesh.receiveShadow = true;
      // 看不见的全高"影子墙"：墙被压低显示时，灯光和阳光仍按真实墙高被挡住，光只留在本房间
      const sh = new THREE.Mesh(mesh.geometry, shadowOnly); sh.castShadow = true;
      sh.position.set(M((p.x1 + p.x2) / 2), (z1 + z2) / 2, M((p.y1 + p.y2) / 2)); scene.add(sh);
    }
    mesh.position.set(M((p.x1 + p.x2) / 2), (z1 + z2) / 2, M((p.y1 + p.y2) / 2));
    scene.add(mesh);
    walls.push({ mesh, z1, z2, out: p.wm?.out ? OUT[p.wm.out] : null });
  }

  // ---- 地面（UV 按世界坐标，纹理在房间之间连续） ----
  const floorMat = {
    wood: mat('#ffffff', { map: texWood(), roughness: 0.55 }),
    tileK: mat('#ffffff', { map: texTile('K'), roughness: 0.35 }),
    tileB: mat('#ffffff', { map: texTile('B'), roughness: 0.35 }),
    balcony: mat('#ffffff', { map: texTile('C'), roughness: 0.7 }),
  };
  const tileSize = { wood: 1.2, tileK: 1.2, tileB: 1.8, balcony: 1.8 };
  const floors = [];
  for (const r of data.rooms) for (const [x1, y1, x2, y2] of r.rects) {
    const geo = new THREE.PlaneGeometry(M(x2 - x1), M(y2 - y1)); geo.rotateX(-Math.PI / 2); geo.translate(M((x1 + x2) / 2), 0, M((y1 + y2) / 2));
    const pos = geo.attributes.position, uv = geo.attributes.uv, ts = tileSize[r.floor] || 1.2;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / ts, -pos.getZ(i) / ts);
    const m = new THREE.Mesh(geo, floorMat[r.floor] || floorMat.wood); m.receiveShadow = true; m.userData.room = r.label;
    scene.add(m); floors.push(m);
  }
  // 楼板厚度：沿每块地面外扩半个墙厚，贴合 L 形户型
  { const slabM = mat('#e4e1ea', { roughness: 0.9 });
    for (const r of data.rooms) for (const [x1, y1, x2, y2] of r.rects) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(M(x2 - x1) + 0.24, 0.22, M(y2 - y1) + 0.24), slabM);
      s.position.set(M((x1 + x2) / 2), -0.111, M((y1 + y2) / 2)); s.receiveShadow = true; scene.add(s);
    } }

  // ---- 家具 ----
  let tvMesh = null; const acMeshes = [];
  for (const it of data.layout) {
    let obj;
    if (BW[it.t]) obj = BW[it.t](it);
    else if (B[it.t]) obj = place(B[it.t](it), it.x, it.y, it.rot ?? 180, it.z ?? 0);
    else { console.warn('未知家具类型', it.t); continue; }
    obj.traverse(o => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
    scene.add(obj);
    if (it.t === 'tv') tvMesh = obj;
    if (it.t === 'ac') acMeshes.push(obj);   // 顺序同 layout：先客厅、后卧室A
  }

  // ---- 设备状态 ----
  const state = {};
  const meta = {};            // id → { linked, effects, minK, maxK, unavailable }：由外部（HA 卡片）提供
  const entities = [];        // { id, label, room, type, anchor(Vector3), ... }
  const lamps = {};
  for (const l of data.lights) {
    const g = buildLamp(l); scene.add(g);
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.userData.lid = l.id; } });
    const pl = new THREE.PointLight('#ffd59a', 0, l.shadow ? 0 : 3.2, 2);
    pl.position.copy(P(l.x, l.y, (l.z ?? 2400) - (l.shape === 'mushroom' ? -60 : 120)));
    if (l.shadow) { pl.castShadow = true; pl.shadow.mapSize.set(touch ? 256 : 512, touch ? 256 : 512); pl.shadow.bias = -0.004; pl.shadow.normalBias = 0.03; pl.shadow.camera.near = 0.05; pl.shadow.camera.far = 10; }
    scene.add(pl);
    // 灯具本体太小，加一个看不见的大号点击区
    const bb = new THREE.Box3().setFromObject(g), sz = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const hit = new THREE.Mesh(new THREE.BoxGeometry(Math.max(sz.x, 0.4) + 0.2, Math.max(sz.y, 0.4) + 0.2, Math.max(sz.z, 0.4) + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(c); hit.userData.lid = l.id; scene.add(hit);
    lamps[l.id] = { g, pl, hit, l };
    state[l.id] = { on: false, brightness: 80, ct: 3000 };
    entities.push({ id: l.id, label: l.label, room: l.room, type: 'light', anchor: new THREE.Vector3(c.x, Math.min(c.y, 1.1), c.z) }); // 图标放低，倾斜视角下不会漂到隔壁房间
  }
  const blinds = {};
  for (const d of data.devices) {
    entities.push({ ...d, anchor: P(d.anchor[0], d.anchor[1], Math.min(d.anchor[2], 1400)) });
    if (d.type === 'blind') {
      const g = new THREE.Group(), w = M(d.x2 - d.x1);
      const rail = rbox(w + 0.04, 0.06, 0.07, 0.01, mat('#f2f2f0')); rail.position.set(0, -0.03, 0); g.add(rail);
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(w, 1, 0.02), mat('#ffffff', { map: texFold(), roughness: 0.95, color: d.id === 'living_curtain' ? '#f6f4ef' : '#e9e2d6' }));
      cloth.castShadow = true; g.add(cloth);
      g.position.copy(P((d.x1 + d.x2) / 2, d.y, d.top)); scene.add(g);
      blinds[d.id] = { cloth, full: M(d.top - d.bottom) };
      state[d.id] = { position: 40 };     // 100 = 全开（帘子收起）
    } else if (d.type === 'ac') state[d.id] = { on: false, temp: 26, mode: 'cool' };
    else if (d.type === 'tv') state[d.id] = { on: false };
    else if (d.type === 'door') state[d.id] = { closed: true };
  }

  // ---- 应用状态到 3D ----
  let night = false, mode = 'auto';
  function applyLight(id) {
    const s = state[id], L = lamps[id], k = s.on ? s.brightness / 100 : 0, col = kelvinRGB(s.ct);
    L.pl.color.copy(col); L.pl.intensity = k * (LIGHT_POWER[L.l.shape] ?? 6) * (night ? 1 : 0.6);
    for (const m of L.g.userData.glow) { m.emissive.copy(col); m.emissiveIntensity = k * 1.1; }
  }
  function applyBlind(id) {
    const b = blinds[id], drop = Math.max(0.08, b.full * (1 - state[id].position / 100));
    b.cloth.scale.y = drop; b.cloth.position.y = -0.06 - drop / 2;
  }
  function applyDevice(id) {
    const s = state[id], e = entities.find(x => x.id === id);
    if (e.type === 'tv' && tvMesh) { const sc = tvMesh.userData.screen; sc.material.emissiveIntensity = s.on ? 1.1 : 0; }
    if (e.type === 'ac') { const g = acMeshes[e.id === 'living_ac' ? 0 : 1]; if (g) { g.userData.led.material.emissive.set(s.mode === 'heat' ? '#ff9a4a' : '#55e0ff'); g.userData.led.material.emissiveIntensity = s.on ? 3 : 0; } }
  }
  function apply(id) {
    if (lamps[id]) applyLight(id); else if (blinds[id]) applyBlind(id); else applyDevice(id);
    shadowsDirty(); refreshUI();
  }
  function applyDayNight() {
    const h = new Date().getHours();
    night = mode === 'night' || (mode === 'auto' && (h < 7 || h >= 18));
    scene.background = texBackground(night);
    scene.environmentIntensity = night ? 0.05 : 0.55;
    hemi.intensity = night ? 0.06 : 0.6; hemi.color.set(night ? '#5a6aa0' : '#dfe6ff');
    sun.intensity = night ? 0 : 2.6; sun.castShadow = !night;
    bloom.strength = night ? 0.45 : 0.2; bloom.threshold = night ? 0.8 : 0.92;
    renderer.toneMappingExposure = 1.0;
    for (const id in lamps) applyLight(id);
    shadowsDirty(); refreshUI();
  }

  // ---- 界面 ----
  const layer = document.createElement('div'); layer.className = 'h3-layer'; root.appendChild(layer);
  const bar = document.createElement('div'); bar.className = 'h3-bar'; layer.appendChild(bar); bar.style.pointerEvents = 'auto';
  bar.innerHTML = `<div class="h3-clock"><b></b><small></small></div><div class="h3-sum"></div>
    <div class="h3-btns"><button class="h3-btn" data-a="allon">全开</button><button class="h3-btn" data-a="alloff">全关</button><button class="h3-btn" data-a="movie">观影</button><button class="h3-btn" data-a="sleep">晚安</button><button class="h3-btn" data-a="cut">矮墙</button><button class="h3-btn" data-a="day">自动</button><button class="h3-btn" data-a="home">总览</button></div>`;
  const hint = document.createElement('div'); hint.className = 'h3-hint'; hint.textContent = '拖动旋转 · 滚轮/双指缩放 · 右键/双指平移 · 双击房间放大'; layer.appendChild(hint);
  const icons = {};
  for (const e of entities) {
    const b = document.createElement('button'); b.className = 'h3-ico'; b.innerHTML = ICON[e.type]; b.title = e.label;
    b.onclick = ev => { ev.stopPropagation(); openCard(e.id); };
    layer.appendChild(b); icons[e.id] = b;
  }
  const roomChips = data.rooms.map(r => {
    const b = document.createElement('button'); b.className = 'h3-room'; b.textContent = r.label; layer.appendChild(b);
    b.onclick = () => flyTo(r.label);
    return { b, pos: P(r.at[0], r.at[1], 30) };
  });
  const card = document.createElement('div'); card.className = 'h3-card'; card.hidden = true; layer.appendChild(card);
  const toastEl = document.createElement('div'); toastEl.className = 'h3-toast'; layer.appendChild(toastEl); let toastT;
  const toast = (msg, ok = false) => { toastEl.textContent = msg; toastEl.style.background = ok ? 'rgba(40,140,80,.92)' : ''; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 4000); };
  let cardId = null;

  function command(id, patch) {          // 用户操作 → 更新本地 → 通知外部（HA）
    Object.assign(state[id], patch); apply(id);
    opts.onCommand?.(id, { ...patch });
    if (cardId === id) renderCard();
  }
  function openCard(id) { cardId = id; renderCard(); card.hidden = false; refreshUI(); }
  function closeCard() { cardId = null; card.hidden = true; refreshUI(); }
  function renderCard() {
    const e = entities.find(x => x.id === cardId), s = state[cardId], mt = meta[cardId] || {};
    let body = '';
    if (e.type === 'light') body = `
      <div class="h3-row"><label>开关</label><button class="h3-sw ${s.on ? 'on' : ''}" data-k="on" ${mt.busy ? 'disabled style="opacity:.5"' : ''}></button></div>
      ${mt.onOffOnly ? '<div class="sub">初版只支持开 / 关；亮度和色温请在米家 App 里调</div>' : `<div class="h3-row"><label>亮度 ${s.brightness}%</label></div><input type="range" min="1" max="100" value="${s.brightness}" data-k="brightness">
      <div class="h3-row"><label>色温 ${s.ct}K</label></div><input type="range" min="${mt.minK || 2700}" max="${mt.maxK || 6500}" step="100" value="${s.ct}" data-k="ct">
      ${mt.effects?.length ? `<div class="h3-row"><label>情景模式</label></div><div class="h3-seg" style="flex-wrap:wrap">${mt.effects.map(f => `<button class="h3-btn ${s.effect === f ? 'on' : ''}" data-set="effect:${f}" style="flex:0 0 calc(25% - 5px)">${f}</button>`).join('')}</div>` : ''}`}`;
    else if (e.type === 'blind') body = `
      <div class="h3-row"><label>打开 ${s.position}%</label></div><input type="range" min="0" max="100" value="${s.position}" data-k="position">
      <div class="h3-seg"><button class="h3-btn" data-set="position:0">关闭</button><button class="h3-btn" data-set="position:50">一半</button><button class="h3-btn" data-set="position:100">打开</button></div>`;
    else if (e.type === 'ac') body = `
      <div class="h3-row"><label>开关</label><button class="h3-sw ${s.on ? 'on' : ''}" data-k="on"></button></div>
      <div class="h3-row"><label>温度</label><div class="h3-temp"><button class="h3-btn" data-step="-1">−</button><b>${s.temp}°</b><button class="h3-btn" data-step="1">＋</button></div></div>
      <div class="h3-seg">${[['cool', '制冷'], ['heat', '制热'], ['fan', '送风']].map(([k, t]) => `<button class="h3-btn ${s.mode === k ? 'on' : ''}" data-set="mode:${k}">${t}</button>`).join('')}</div>`;
    else if (e.type === 'tv') body = `<div class="h3-row"><label>开关</label><button class="h3-sw ${s.on ? 'on' : ''}" data-k="on"></button></div>`;
    else body = `<div class="h3-row"><label>状态</label><span>${s.closed ? '已关闭' : '已打开'}</span></div><div class="sub">接入门磁后显示真实状态</div>`;
    card.innerHTML = `<button class="h3-x" aria-label="关闭">×</button><h3>${ICON[e.type].replace('<svg', '<svg width="20" height="20"')}${e.label}</h3><div class="sub">${e.room} · ${mt.busy ? '正在通过手机切换…' : mt.unavailable ? '设备离线' : mt.linked ? (mt.via || '已连接米家') : '模拟模式（未绑定设备）'}</div>${body}`;
    card.querySelector('.h3-x').onclick = closeCard;
    card.querySelectorAll('[data-k=on]').forEach(b => b.onclick = () => command(cardId, { on: !state[cardId].on }));
    card.querySelectorAll('input[type=range]').forEach(r => {
      r.oninput = () => { const k = r.dataset.k, v = +r.value; Object.assign(state[cardId], { [k]: v }); if (k === 'brightness' || k === 'ct') state[cardId].on = true; apply(cardId); r.previousElementSibling?.querySelector?.('label') && null; const lab = r.previousElementSibling.querySelector('label'); if (lab) lab.textContent = { brightness: `亮度 ${v}%`, ct: `色温 ${v}K`, position: `打开 ${v}%` }[k]; };
      r.onchange = () => command(cardId, { [r.dataset.k]: +r.value, ...(r.dataset.k !== 'position' ? { on: true } : {}) });
    });
    card.querySelectorAll('[data-set]').forEach(b => b.onclick = () => { const i = b.dataset.set.indexOf(':'), k = b.dataset.set.slice(0, i), v = b.dataset.set.slice(i + 1); command(cardId, { [k]: isNaN(+v) ? v : +v, ...(k === 'effect' ? { on: true } : {}) }); });
    card.querySelectorAll('[data-step]').forEach(b => b.onclick = () => command(cardId, { temp: Math.min(30, Math.max(16, state[cardId].temp + +b.dataset.step)) }));
  }
  function refreshUI() {
    for (const e of entities) {
      const s = state[e.id], on = e.type === 'blind' ? s.position > 0 : e.type === 'door' ? false : !!s.on;
      icons[e.id].classList.toggle('on', on); icons[e.id].classList.toggle('sel', cardId === e.id);
    }
    const n = data.lights.filter(l => state[l.id].on).length;
    bar.querySelector('.h3-sum').textContent = n ? `${n} 盏灯亮着` : '灯都关了';
    bar.querySelector('[data-a=day]').textContent = { auto: night ? '自动·夜' : '自动·昼', day: '白天', night: '夜晚' }[mode];
  }
  const scenes = {
    allon: () => data.lights.forEach(l => command(l.id, { on: true, brightness: 80 })),
    alloff: () => data.lights.forEach(l => command(l.id, { on: false })),
    movie: () => { data.lights.forEach(l => command(l.id, { on: ['living_floor_lamp', 'dining_table_lamp'].includes(l.id), brightness: 30 })); command('living_tv', { on: true }); command('living_curtain', { position: 0 }); },
    sleep: () => { data.lights.forEach(l => command(l.id, { on: l.id === 'bedroom_b_ceiling_light', brightness: 15, ct: 2700 })); command('living_tv', { on: false }); command('bedroom_b_curtain', { position: 0 }); },
    day: () => { mode = { auto: 'day', day: 'night', night: 'auto' }[mode]; applyDayNight(); },
    home: () => overview(),
    cut: () => { cutAll = !cutAll; bar.querySelector('[data-a=cut]').classList.toggle('on', cutAll); },
  };
  bar.querySelectorAll('[data-a]').forEach(b => b.onclick = () => scenes[b.dataset.a]());
  function tick() {
    const d = new Date();
    bar.querySelector('.h3-clock b').textContent = d.toTimeString().slice(0, 5);
    bar.querySelector('.h3-clock small').textContent = `${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`;
    if (mode === 'auto') { const was = night; const h = d.getHours(); if (was !== (h < 7 || h >= 18)) applyDayNight(); }
  }
  tick(); setInterval(tick, 15000);

  // ---- 镜头 ----
  const houseBox = new THREE.Box3(); for (const f of floors) houseBox.expandByObject(f);
  const houseCenter = houseBox.getCenter(new THREE.Vector3());
  let anim = null;
  function animateTo(target, pos, ms = 700) {
    anim = { t0: performance.now(), ms, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: pos };
  }
  function overview(instant = false) {
    const size = houseBox.getSize(new THREE.Vector3()), aspect = W() / Hh();
    const landscape = aspect > 1;                       // 横屏：从东侧看，让南北长边横向铺开
    const azi = landscape ? 90 * DEG : 0, polar = 22 * DEG;
    const along = landscape ? size.z : size.x, across = landscape ? size.x : size.z;
    const vf = camera.fov * DEG / 2;
    const dist = Math.max((across * Math.cos(polar) + 1.5) / 2 / Math.tan(vf), (along + 1) / 2 / (Math.tan(vf) * aspect)) * 1.12 + 2;
    const dir = new THREE.Vector3(Math.sin(polar) * Math.sin(azi), Math.cos(polar), Math.sin(polar) * Math.cos(azi));
    const pos = houseCenter.clone().addScaledVector(dir, dist);
    if (instant) { controls.target.copy(houseCenter); camera.position.copy(pos); controls.update(); } else animateTo(houseCenter.clone(), pos);
  }
  function flyTo(label) {
    const r = data.rooms.find(x => x.label === label); if (!r) return;
    const target = P(r.at[0], r.at[1], 0);
    const off = camera.position.clone().sub(controls.target); off.y = 0; if (off.lengthSq() < 1e-4) off.set(0, 0, 1); off.normalize();
    const pos = target.clone().addScaledVector(off, 4.2).add(new THREE.Vector3(0, 6.8, 0));
    animateTo(target, pos);
  }
  // HA 卡片创建时容器可能还是 0×0：等拿到真实尺寸后再取景
  let framed = false;
  if (W() > 0 && Hh() > 0) { overview(true); framed = true; }

  // 墙体显示高度：朝向镜头的外墙压低到 1 米；"矮墙"模式下所有墙压到 1.2 米（影子墙不变）
  const LOW = 1.0, CUT = 1.2; let cutAll = false;
  function updateWalls() {
    const v = camera.position.clone().sub(controls.target); const flat = Math.hypot(v.x, v.z), elev = Math.atan2(v.y, flat);
    const dx = v.x / (flat || 1), dz = v.z / (flat || 1);
    for (const w of walls) {
      const low = w.out && elev < 72 * DEG && (dx * w.out[0] + dz * w.out[1]) > 0.3;
      const top = Math.min(w.z2, low ? LOW : Infinity, cutAll ? CUT : Infinity);
      if (top === w.top) continue; w.top = top;
      const m = w.mesh;
      m.visible = top > w.z1 + 0.01;
      if (m.visible) { m.scale.y = (top - w.z1) / (w.z2 - w.z1); m.position.y = (w.z1 + top) / 2; }
    }
  }

  // ---- 点击 / 双击 ----
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const hitTargets = Object.values(lamps).flatMap(L => [L.hit, ...L.g.children]);
  function pickAt(ev, objs) { const r = renderer.domElement.getBoundingClientRect(); ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ptr, camera); return ray.intersectObjects(objs, false)[0]; }
  let down = null, lastTap = 0;
  renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; anim = null; });
  renderer.domElement.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) return;
    const now = performance.now();
    if (now - lastTap < 320) { const f = pickAt(e, floors); if (f) flyTo(f.object.userData.room); lastTap = 0; return; }
    lastTap = now;
    const h = pickAt(e, hitTargets);
    if (h) { const id = h.object.userData.lid; command(id, { on: !state[id].on }); }
    else if (!card.hidden) closeCard();
  });
  renderer.domElement.addEventListener('pointermove', e => { if (e.buttons) return; renderer.domElement.style.cursor = pickAt(e, hitTargets) ? 'pointer' : ''; });

  // ---- 循环 ----
  const tmp = new THREE.Vector3();
  function project(v, el, hideBehind = true) {
    tmp.copy(v).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    el.style.display = vis || !hideBehind ? '' : 'none';
    if (vis) el.style.transform = `translate(${((tmp.x + 1) / 2) * W()}px,${((1 - tmp.y) / 2) * Hh()}px)` + (el.classList.contains('h3-room') ? ' translate(-50%,-50%)' : '');
  }
  function resize() {
    const w = W(), h = Hh(); if (!w || !h) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h);
    if (!framed) { framed = true; overview(true); }
  }
  new ResizeObserver(resize).observe(root);
  function loop(t) {
    if (anim) {
      const k = Math.min(1, (t - anim.t0) / anim.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      controls.target.lerpVectors(anim.ft, anim.tt, e); camera.position.lerpVectors(anim.fp, anim.tp, e);
      if (k >= 1) anim = null;
    }
    controls.update(); updateWalls();
    for (const e of entities) project(e.anchor, icons[e.id]);
    for (const c of roomChips) project(c.pos, c.b);
    composer.render();
    requestAnimationFrame(loop);
  }
  for (const id in state) { if (lamps[id]) applyLight(id); else if (blinds[id]) applyBlind(id); else applyDevice(id); }
  applyDayNight();
  requestAnimationFrame(loop);
  root.dataset.ready = '1';

  return {
    setState(id, patch) { if (!state[id]) return; Object.assign(state[id], patch); apply(id); if (cardId === id) renderCard(); },
    toast,
    setMeta(id, m) { if (!state[id]) return; meta[id] = { ...meta[id], ...m }; icons[id].style.opacity = m.unavailable ? 0.45 : ''; if (cardId === id) renderCard(); },
    ids: () => Object.keys(state),
    getState: () => JSON.parse(JSON.stringify(state)),
    flyTo, overview, openCard, setMode(m) { mode = m; applyDayNight(); },
    _debug: { scene, camera, renderer, THREE },
  };
}

export { createHome3D };
