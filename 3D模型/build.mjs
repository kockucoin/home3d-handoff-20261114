// 由户型图尺寸生成 3D 模型：home.obj / home.mtl（给 Floor3D Card 用）+ preview.html（浏览器预览）
// 运行：node build.mjs
// 坐标：平面图毫米，x 向东，y 向南（图上向下），z 为高度。原点 = 卧室外墙西侧 / 书房北墙。
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const H = 2700;          // 层高
const EXT = 240, INT = 120;
const C = {
  wall: '#f4f2ee', wood: '#b5824f', tileK: '#e6e6e0', tileB: '#dfe3e6', balcony: '#cfcac2',
  glass: '#9cc9e3', lamp: '#f7f7f2', white: '#f0eee8', door: '#7a5232',
};

const prims = [];   // {type:'box'|'cyl', name, ...}
const used = new Set();
function uniq(n) { let k = n, i = 2; while (used.has(k)) k = `${n}_${i++}`; used.add(k); return k; }
function box(name, x1, y1, x2, y2, z1, z2, color, op = 1, group = 'misc') {
  prims.push({ type: 'box', name: uniq(name), x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), z1, z2, color, op, group });
}
function cyl(name, cx, cy, r, z1, z2, color, op = 1, group = 'misc') {
  prims.push({ type: 'cyl', name: uniq(name), cx, cy, r, z1, z2, color, op, group });
}

// ---------- 墙 ----------
const door = (from, to, name, leaf = false) => ({ from, to, bottom: 0, top: 2100, name, leaf });
const win = (from, to, name, bottom = 900, top = 2300) => ({ from, to, bottom, top, name, glass: true });

// out: 外墙朝外的方向 'n'|'s'|'e'|'w'（内墙为 null）。3D 页面据此把朝向镜头的外墙压低。
function wall(name, x1, y1, x2, y2, t, openings = [], out = null) {
  const horiz = y1 === y2;
  const c = horiz ? y1 : x1;
  const a = Math.min(horiz ? x1 : y1, horiz ? x2 : y2) - t / 2;
  const b = Math.max(horiz ? x1 : y1, horiz ? x2 : y2) + t / 2;
  const piece = (s, e, z1, z2, nm, color = C.wall, op = 1, th = t, group = 'wall') => {
    if (e - s < 1 || z2 - z1 < 1) return;
    if (horiz) box(nm, s, c - th / 2, e, c + th / 2, z1, z2, color, op, group);
    else box(nm, c - th / 2, s, c + th / 2, e, z1, z2, color, op, group);
    prims[prims.length - 1].wm = { horiz, out };
  };
  let cur = a;
  for (const o of [...openings].sort((p, q) => p.from - q.from)) {
    piece(cur, o.from, 0, H, name);
    piece(o.from, o.to, 0, o.bottom, name);
    piece(o.from, o.to, o.top, H, name);
    if (o.glass) piece(o.from, o.to, o.bottom, o.top, o.name, C.glass, 0.35, 30, 'glass');
    if (o.leaf) piece(o.from, o.to, 0, o.top, o.name, C.door, 1, 50, 'door');
    cur = o.to;
  }
  piece(cur, b, 0, H, name);
}

// 外墙
wall('wall_study_n', 843, 0, 3976, 0, EXT, [win(1581, 3384, 'window_study_n')], 'n');
wall('wall_study_w', 843, 0, 843, 2240, EXT, [win(575, 1580, 'window_study_w')], 'w');
wall('wall_bath_a_w', 843, 2240, 843, 4274, EXT, [], 'w');
wall('wall_study_e', 3976, 0, 3976, 3438, EXT);
wall('wall_kitchen_n', 3976, 575, 5900, 575, EXT, [win(4300, 5500, 'window_kitchen')], 'n');
wall('wall_east', 5900, 575, 5900, 7709, EXT, [door(4240, 5140, 'entry_door', true)], 'e');
wall('wall_living_step', 5900, 7709, 7003, 7709, EXT, [], 'n');
wall('wall_living_e', 7003, 7709, 7003, 12500, EXT, [], 'e');
wall('wall_balcony_s', 3384, 12500, 7003, 12500, EXT, [win(3700, 6700, 'window_balcony', 1000, 2400)], 's');
wall('wall_balcony_w', 3384, 11462, 3384, 12500, EXT, [], 'w');
wall('wall_bedroom_a_n', 0, 4274, 2877, 4274, EXT, [win(150, 700, 'window_bedroom_a')], 'n');
wall('wall_west', 0, 4274, 0, 11704, EXT, [], 'w');
wall('wall_bedroom_b_s', 0, 11704, 3384, 11704, EXT, [{ from: 903, to: 2667, bottom: 450, top: 2400 }], 's');
// 卧室B 飘窗
wall('wall_bay_w', 903, 11704, 903, 12460, EXT, [], 'w');
wall('wall_bay_e', 2667, 11704, 2667, 12460, EXT, [], 'e');
wall('wall_bay_s', 903, 12460, 2667, 12460, EXT, [win(1050, 2520, 'window_bedroom_b', 450, 2400)], 's');
// 内墙
wall('wall_study_s', 843, 2240, 3976, 2240, INT, [door(3000, 3800, 'study_door')]);
wall('wall_kitchen_s', 3976, 3438, 5900, 3438, INT, [door(4300, 5100, 'kitchen_door')]);
wall('wall_hall_w', 2877, 2240, 2877, 6593, INT, [door(3450, 4150, 'bath_a_door'), door(5600, 6450, 'bedroom_a_door')]);
wall('wall_bedroom_a_s', 0, 6593, 3384, 6593, INT);
wall('wall_bath_b_s', 0, 8050, 2370, 8050, INT);
wall('wall_bath_b_e', 2370, 6593, 2370, 8050, INT, [door(7000, 7750, 'bath_b_door')]);
wall('wall_bedroom_b_e', 3384, 6593, 3384, 11704, INT, [door(6720, 7550, 'bedroom_b_door')]);
wall('wall_living_s', 3384, 11462, 7003, 11462, EXT, [win(3976, 6489, 'balcony_door', 0, 2300)]);

// ---------- 地面 ----------
const rooms = [
  { label: '书房', at: [2410, 1120], rects: [[843, 0, 3976, 2240]], color: C.wood },
  { label: '厨房', at: [4940, 2000], rects: [[3976, 575, 5900, 3438]], color: C.tileK },
  { label: '卫A', at: [1860, 3257], rects: [[843, 2240, 2877, 4274]], color: C.tileB },
  { label: '卧室A', at: [1440, 5000], rects: [[0, 4274, 2877, 6593]], color: C.wood },
  { label: '卫B', at: [1185, 7320], rects: [[0, 6593, 2370, 8050]], color: C.tileB },
  { label: '卧室B', at: [1700, 8600], rects: [[0, 8050, 3384, 11704], [2370, 6593, 3384, 8050], [903, 11704, 2667, 12460]], color: C.wood },
  { label: '客厅', at: [4400, 6600], rects: [[2877, 2240, 3976, 3438], [2877, 3438, 5900, 6593], [3384, 6593, 5900, 7709], [3384, 7709, 7003, 11462]], color: C.wood },
  { label: '阳台', at: [5200, 11980], rects: [[3384, 11462, 7003, 12500]], color: C.balcony },
];
rooms.forEach((r, i) => r.rects.forEach(([a, b, c, d]) => box(`floor_${i}`, a, b, c, d, -20, 0, r.color, 1, 'floor')));

// ---------- 家具 / 电器（按照片 + 酷家乐方案摆位） ----------
const F = 'furniture';
function sph(name, cx, cy, cz, r, color, op = 1, group = 'misc') { prims.push({ type: 'sph', name: uniq(name), cx, cy, cz, r, color, op, group }); }
// 椭圆柱 / 圆台：rx, ry 为底面半轴，r2 为顶面相对比例
function ell(name, cx, cy, rx, ry, z1, z2, color, op = 1, group = 'misc', r2 = 1) { prims.push({ type: 'cyl', name: uniq(name), cx, cy, r: rx, ry, r2, z1, z2, color, op, group }); }
// 椅子：facing = 人坐下后面朝的方向（度，0=北/-y，90=东）
function chair(name, cx, cy, facing, w, d, seatH, backH, color, legColor = color) {
  const a = facing * Math.PI / 180, fx = Math.sin(a), fy = -Math.cos(a);
  const rot = (u, v) => [cx + u * Math.cos(a) - v * Math.sin(a), cy + u * Math.sin(a) + v * Math.cos(a)];
  for (const [u, v] of [[-w / 2 + 30, -d / 2 + 30], [w / 2 - 30, -d / 2 + 30], [-w / 2 + 30, d / 2 - 30], [w / 2 - 30, d / 2 - 30]]) {
    const [x, y] = rot(u, v); cyl(`${name}_leg`, x, y, 18, 0, seatH, legColor, 1, F);
  }
  ell(`${name}_seat`, cx, cy, w / 2, d / 2, seatH, seatH + 50, color, 1, F);
  const [bx, by] = [cx - fx * (d / 2 - 25), cy - fy * (d / 2 - 25)];
  const hw = w / 2, hd = 25;
  const ax = Math.abs(fx) > 0.7 ? hd : hw, ay = Math.abs(fx) > 0.7 ? hw : hd;
  box(`${name}_back`, bx - ax, by - ay, bx + ax, by + ay, seatH + 50, backH, color, 1, F);
}
// 客厅：浅灰沙发靠东墙，对面电视柜+电视，深蓝地毯，椭圆玻璃茶几
box('living_sofa_base', 5930, 7900, 6880, 9900, 0, 420, '#8d9297', 1, F);
box('living_sofa_back', 6680, 7900, 6880, 9900, 420, 800, '#83888d', 1, F);
box('living_sofa_arm', 5930, 7900, 6880, 8080, 420, 620, '#83888d', 1, F);
box('living_sofa_arm', 5930, 9720, 6880, 9900, 420, 620, '#83888d', 1, F);
box('living_sofa_cushion', 5960, 8090, 6670, 8890, 420, 520, '#9ba0a5', 1, F);
box('living_sofa_cushion', 5960, 8910, 6670, 9710, 420, 520, '#9ba0a5', 1, F);
box('living_rug', 4300, 7750, 5950, 10150, 0, 12, '#1f2f7a', 1, F);
ell('living_coffee_table', 5150, 8950, 300, 560, 400, 420, '#a9d0e0', 0.45, F);
cyl('living_coffee_leg', 5150, 8650, 15, 0, 400, '#c0c4c8', 1, F);
cyl('living_coffee_leg', 5150, 9250, 15, 0, 400, '#c0c4c8', 1, F);
box('living_tv_cabinet', 3444, 7900, 3880, 10000, 120, 560, '#8b4127', 1, F);
for (const y of [8250, 8750, 9250]) cyl('living_tv_cabinet_dot', 3885, y, 90, 250, 270, '#2b4aa0', 1, F);
box('living_tv', 3450, 8300, 3500, 9500, 1000, 1700, '#111111', 1, 'device');
cyl('living_plant_pot', 3660, 8150, 160, 560, 800, '#3f9a8a', 1, F);
sph('living_plant', 3660, 8150, 1050, 260, '#3f7a3a', 1, F);
box('living_painting', 6870, 8100, 6883, 9300, 1400, 2150, '#c8b6c4', 1, F);
box('living_ac', 6700, 10150, 6883, 11050, 2150, 2450, '#fafafa', 1, 'device');
box('living_curtain', 3976, 11360, 6489, 11400, 1500, 2450, '#f4f2ec', 1, 'device'); // 白色罗马帘（半放下）
// 沙发旁的大 L 型升降书桌 + 显示器 + 办公椅
box('living_desk_top', 5450, 10850, 6880, 11330, 720, 750, '#7a4a2a', 1, F);
box('living_desk_return', 5450, 10250, 5900, 10850, 720, 750, '#7a4a2a', 1, F);
for (const [x, y] of [[5500, 10300], [5500, 11280], [6830, 11280], [6830, 10900]]) box('living_desk_leg', x - 25, y - 25, x + 25, y + 25, 0, 720, '#2a2a2a', 1, F);
box('living_monitor', 6050, 11150, 6650, 11180, 900, 1250, '#151515', 1, 'device');
box('living_monitor_stand', 6330, 11160, 6370, 11200, 750, 900, '#333333', 1, F);
chair('living_office_chair', 6350, 10450, 180, 520, 500, 470, 1050, '#2e5a44', '#333333');
// 餐厅：白色圆桌（木色立柱）+ 两把藤椅 + 绿色扶手椅 + 白色开放架
cyl('dining_table_top', 4400, 4800, 450, 720, 750, '#efefef', 1, F);
cyl('dining_table_leg', 4400, 4800, 110, 0, 720, '#a0703f', 1, F);
cyl('dining_table_base', 4400, 4800, 280, 0, 30, '#5a4030', 1, F);
chair('dining_rattan_chair', 3800, 4650, 76, 460, 480, 450, 950, '#c49a5a');
chair('dining_rattan_chair', 3950, 5250, 41, 460, 480, 450, 950, '#c49a5a');
chair('dining_green_chair', 4450, 5500, 0, 640, 600, 430, 850, '#2f4a3a', '#6b4a30');
box('dining_shelf_side', 5200, 3500, 5220, 3880, 0, 1000, '#f2f2f2', 1, F);
box('dining_shelf_side', 5700, 3500, 5720, 3880, 0, 1000, '#f2f2f2', 1, F);
for (const z of [0, 330, 660, 980]) box('dining_shelf_board', 5200, 3500, 5720, 3880, z, z + 20, '#f2f2f2', 1, F);
box('dining_shelf_drawer', 5220, 3520, 5700, 3880, 20, 330, '#e8e8e8', 1, F);
cyl('dining_kettle', 5320, 3700, 70, 1000, 1240, '#222222', 1, F);
// 厨房：L 型浅木橱柜（北墙水槽 + 东墙灶台）+ 吊柜
box('kitchen_counter_n', 4100, 695, 5780, 1295, 0, 850, '#e3d3b4', 1, F);
box('kitchen_counter_e', 5180, 1295, 5780, 3250, 0, 850, '#e3d3b4', 1, F);
box('kitchen_top_n', 4100, 695, 5780, 1295, 850, 890, '#cfcfcf', 1, F);
box('kitchen_top_e', 5180, 1295, 5780, 3250, 850, 890, '#cfcfcf', 1, F);
box('kitchen_upper_cabinet', 5430, 1295, 5780, 3250, 1500, 2200, '#e3d3b4', 1, F);
box('kitchen_sink', 4600, 800, 5000, 1150, 870, 892, '#9aa0a6', 1, F);
// 卧室A：白色床（床头靠西墙）+ 棕色床头柜 + 空调
box('bedroom_a_bed', 120, 4950, 2120, 6450, 0, 450, '#f3eeee', 1, F);
box('bedroom_a_sheet', 300, 4960, 2120, 6440, 450, 500, '#f2d8dc', 1, F);
box('bedroom_a_headboard', 120, 4950, 200, 6450, 0, 950, '#ece8e0', 1, F);
box('bedroom_a_pillow', 250, 5600, 650, 5900, 500, 600, '#e7c23a', 1, F);
box('bedroom_a_nightstand', 120, 4450, 520, 4850, 0, 550, '#8a5a32', 1, F);
box('bedroom_a_ac', 120, 4500, 320, 5400, 2150, 2450, '#fafafa', 1, 'device');
// 卧室B：白色床（床头靠西墙）+ 白床头柜 + 窄白衣柜 + 飘窗 + 窗帘
box('bedroom_b_bed', 120, 9950, 2120, 11450, 0, 450, '#e8e2d6', 1, F);
box('bedroom_b_blanket', 500, 9960, 2120, 11440, 450, 520, '#7d8590', 1, F);
box('bedroom_b_headboard', 120, 9950, 200, 11450, 0, 1050, '#efe9df', 1, F);
box('bedroom_b_pillow', 250, 10300, 550, 11100, 520, 620, '#cfd3d8', 1, F);
box('bedroom_b_nightstand', 120, 9450, 520, 9900, 0, 550, '#f2efe8', 1, F);
box('bedroom_b_wardrobe', 2650, 8110, 3250, 8700, 0, 2000, '#ece8de', 1, F);
box('bedroom_b_bay_seat', 903, 11584, 2667, 12340, 0, 450, '#d9d4cc', 1, F);
box('bedroom_b_curtain', 1050, 12300, 2520, 12330, 1600, 2400, '#e9e2d6', 1, 'device'); // 飘窗卷帘（半放下）
// 书房、卫生间、阳台（酷家乐方案位置）
box('study_desk', 1627, 1000, 2827, 1420, 720, 750, '#d8d0c0', 1, F);
box('study_desk_side', 1627, 1000, 1667, 1420, 0, 720, '#d8d0c0', 1, F);
box('study_desk_side', 2787, 1000, 2827, 1420, 0, 720, '#d8d0c0', 1, F);
chair('study_chair', 2227, 800, 180, 500, 480, 460, 1000, '#333333');
cyl('study_plant_pot', 1374, 1820, 160, 0, 350, '#d9d4cc', 1, F); sph('study_plant', 1374, 1820, 800, 300, '#3f7a3a', 1, F);
box('bath_a_shower', 963, 2300, 1863, 3200, 0, 2000, '#cfe3ee', 0.3, F);
box('bath_a_toilet', 2200, 2360, 2560, 2930, 0, 420, '#ffffff', 1, F);
box('bath_a_vanity', 963, 3300, 1500, 4100, 0, 850, '#f5f5f5', 1, F);
box('bath_b_toilet', 1090, 6650, 1450, 7220, 0, 420, '#ffffff', 1, F);
box('bath_b_vanity', 1500, 6650, 2300, 7190, 0, 850, '#f5f5f5', 1, F);
box('bath_b_screen', 900, 6650, 985, 7990, 0, 2000, '#cfe3ee', 0.3, F);
box('balcony_washer', 3505, 11530, 4105, 12380, 0, 1200, '#f5f5f5', 1, F);
box('balcony_lounge', 4600, 11800, 5500, 12450, 0, 450, '#5b5b5b', 1, F);

// ---------- 灯具（HA 控制对象，按照片款式；2026-11-14 按新照片更新） ----------
// shape: square 方形吸顶 / round 圆形吸顶 / bulb 灯泡 / floor 落地灯
//        lantern 纸灯笼吊灯 / drum 布罩吊灯 / woven 编织吊灯 / mushroom 蘑菇台灯
// shadow: 该灯在 3D 页面里投射阴影（光被墙挡住，只照亮本房间）
const lights = [
  { id: 'living_ceiling_light', label: '客厅灯笼吊灯', room: '客厅', x: 5150, y: 9000, shape: 'lantern', s: 250, shadow: true },
  { id: 'living_floor_lamp', label: '客厅落地灯', room: '客厅', x: 3720, y: 10250, shape: 'floor' },
  { id: 'dining_pendant', label: '餐厅布罩吊灯', room: '餐厅', x: 4400, y: 4800, shape: 'drum', s: 230, shadow: true },
  { id: 'dining_table_lamp', label: '餐边柜蘑菇灯', room: '餐厅', x: 5720, y: 3650, shape: 'mushroom' },
  { id: 'kitchen_light', label: '厨房灯', room: '厨房', x: 4940, y: 2000, shape: 'square', s: 580, shadow: true },
  { id: 'bedroom_b_ceiling_light', label: '卧室B编织吊灯', room: '卧室B', x: 1500, y: 10300, shape: 'woven', s: 260, shadow: true },
  { id: 'bedroom_a_ceiling_light', label: '卧室A灯泡', room: '卧室A', x: 1440, y: 5460, shape: 'bulb', shadow: true },
  { id: 'study_light', label: '书房灯', room: '书房', x: 2410, y: 1240, shape: 'round', s: 300, shadow: true },
  { id: 'bath_a_light', label: '卫A灯', room: '卫A', x: 1860, y: 3227, shape: 'round', s: 180 },
  { id: 'bath_b_light', label: '卫B灯', room: '卫B', x: 1215, y: 7321, shape: 'round', s: 180 },
  { id: 'balcony_light', label: '阳台灯', room: '阳台', x: 5150, y: 12000, shape: 'round', s: 180 },
];
for (const l of lights) {
  const L = 'light';
  if (l.shape === 'lantern') { cyl(`${l.id}_cord`, l.x, l.y, 6, 2400, 2700, '#dddddd', 1, F); sph(l.id, l.x, l.y, 2150, l.s, C.lamp, 1, L); l.z = 2150; }
  else if (l.shape === 'drum') { cyl(`${l.id}_cord`, l.x, l.y, 6, 2130, 2700, '#bbbbbb', 1, F); ell(l.id, l.x, l.y, l.s, l.s, 1850, 2130, C.lamp, 1, L, 0.75); l.z = 1900; }
  else if (l.shape === 'woven') { cyl(`${l.id}_cord`, l.x, l.y, 6, 2330, 2700, '#222222', 1, F); sph(l.id, l.x, l.y, 2200, l.s * 0.6, C.lamp, 1, L); l.z = 2150; }
  else if (l.shape === 'mushroom') { cyl(`${l.id}_stem`, l.x, l.y, 25, 1000, 1250, '#f0e6d2', 1, F); sph(l.id, l.x, l.y, 1260, 110, '#ffd7a0', 1, L); l.z = 1240; }
  else if (l.shape === 'square') { box(l.id, l.x - l.s / 2, l.y - l.s / 2, l.x + l.s / 2, l.y + l.s / 2, 2630, 2690, C.lamp, 1, L); l.z = 2550; }
  else if (l.shape === 'round') { cyl(l.id, l.x, l.y, l.s, 2630, 2690, C.lamp, 1, L); l.z = 2550; }
  else if (l.shape === 'pendant') {
    cyl(`${l.id}_cord`, l.x, l.y, 6, 2050, 2700, '#333333', 1, F);
    ell(`${l.id}_shade`, l.x, l.y, l.s, l.s, 1880, 2050, '#2d2d2d', 1, F, 0.3);
    sph(l.id, l.x, l.y, 1900, 70, C.lamp, 1, L); l.z = 1820;
  } else if (l.shape === 'bulb') {
    cyl(`${l.id}_base`, l.x, l.y, 60, 2620, 2700, '#f0f0f0', 1, F);
    sph(l.id, l.x, l.y, 2560, 60, C.lamp, 1, L); l.z = 2450;
  } else if (l.shape === 'floor') {
    cyl(`${l.id}_base`, l.x, l.y, 140, 0, 25, '#222222', 1, F);
    cyl(`${l.id}_pole`, l.x, l.y, 12, 25, 1750, '#b9bcc0', 1, F);
    for (const z of [1000, 1250, 1500, 1750]) sph(l.id, l.x + 70, l.y, z, 75, C.lamp, 1, L);
    l.z = 1400;
  }
  for (const p of prims) if (p.group === L && (p.name === l.id || p.name.startsWith(l.id + '_'))) p.lid = l.id;
}
// 非灯设备。anchor = 图标位置（mm）；blind 的 x1/x2/y/top/bottom 为帘子范围
const devices = [
  { id: 'living_tv', label: '客厅电视', type: 'tv', room: '客厅', anchor: [3500, 8950, 1750] },
  { id: 'living_ac', label: '客厅空调', type: 'ac', room: '客厅', anchor: [6800, 10600, 2550] },
  { id: 'bedroom_a_ac', label: '卧室A空调', type: 'ac', room: '卧室A', anchor: [260, 5700, 2550] },
  { id: 'living_curtain', label: '客厅罗马帘', type: 'blind', room: '客厅', anchor: [5230, 11380, 2500], x1: 3976, x2: 6489, y: 11380, top: 2450, bottom: 120, axis: 'x' },
  { id: 'bedroom_b_curtain', label: '卧室B卷帘', type: 'blind', room: '卧室B', anchor: [1785, 12300, 2450], x1: 1050, x2: 2520, y: 12300, top: 2400, bottom: 470, axis: 'x' },
  { id: 'entry_door', label: '入户门', type: 'door', room: '客厅', anchor: [5900, 4690, 2200] },
];

// ---------- 3D 页面用的家具布局（语义化，由 app/home3d.js 生成精细模型） ----------
// rot = 家具"正面"朝向（度）：0 北 / 90 东 / 180 南 / 270 西。尺寸单位 mm
const layout = [
  // 客厅
  { t: 'rug', x1: 4250, y1: 7700, x2: 6000, y2: 10200, color: '#1c2b78' },
  { t: 'sofa', x: 6440, y: 8900, rot: 270, w: 2000, d: 880, color: '#8f9499' },
  { t: 'coffeeOval', x: 5150, y: 8950, rx: 320, ry: 560, h: 420 },
  { t: 'pouf', x: 5750, y: 9950, r: 260, h: 200, color: '#9fb3a8' },
  { t: 'pouf', x: 5480, y: 8000, r: 190, h: 170, color: '#6b4a35' },
  { t: 'tvCabinet', x: 3680, y: 8950, rot: 90, w: 2100, d: 420, h: 520, color: '#7a3a22' },
  { t: 'tv', x: 3470, y: 8950, rot: 90, w: 1230, h: 720, z: 1030 },
  { t: 'plant', x: 3700, y: 8150, z: 520, r: 150, h: 650 },
  { t: 'deskL', x1: 5450, y1: 10850, x2: 6880, y2: 11330, rx2: 5900, ry1: 10250 },
  { t: 'monitor', x: 6350, y: 11220, rot: 0, w: 620, z: 750 },
  { t: 'officeChair', x: 6350, y: 10500, rot: 180, color: '#2e5a44' },
  { t: 'painting', x: 6878, y: 8900, rot: 270, w: 1100, h: 700, z: 1450, style: 'blossom' },
  { t: 'painting', x: 2940, y: 4900, rot: 90, w: 600, h: 1100, z: 1100, style: 'checker' },
  { t: 'ac', x: 6860, y: 10600, rot: 270, w: 900, z: 2150 },
  // 餐厅
  { t: 'tableRound', x: 4400, y: 4800, r: 450, h: 750 },
  { t: 'rattanChair', x: 3820, y: 4650, rot: 76 },
  { t: 'rattanChair', x: 4050, y: 5320, rot: 35 },
  { t: 'armchair', x: 4520, y: 5560, rot: 0, color: '#24392e' },
  { t: 'shelfOpen', x: 5720, y: 3850, rot: 270, w: 740, d: 330, h: 1000 },
  // 厨房
  { t: 'counter', x1: 4100, y1: 695, x2: 5780, y2: 1295, h: 850, color: '#e3d3b4' },
  { t: 'counter', x1: 5180, y1: 1295, x2: 5780, y2: 3250, h: 850, color: '#e3d3b4' },
  { t: 'upperCabinet', x1: 5430, y1: 1295, x2: 5780, y2: 3250, z1: 1500, z2: 2200, color: '#e3d3b4' },
  { t: 'sink', x: 4800, y: 990 },
  { t: 'stove', x: 5480, y: 2350 },
  // 卧室A
  { t: 'bed', x: 1120, y: 5700, rot: 90, w: 1500, l: 2000, frame: '#f3eeee', sheet: '#f2d8dc', duvet: '#f7f1ec', pillow: '#e7c23a' },
  { t: 'nightstand', x: 330, y: 4640, rot: 90, color: '#8a5a32' },
  { t: 'ac', x: 150, y: 5700, rot: 90, w: 850, z: 2150 },
  // 卧室B
  { t: 'bed', x: 1120, y: 10700, rot: 90, w: 1800, l: 2000, frame: '#efe9df', sheet: '#5a3a2c', duvet: '#a9bcd6', pillow: '#e8e4dc' },
  { t: 'nightstand', x: 330, y: 9550, rot: 90, color: '#f2efe8' },
  { t: 'wardrobe', x: 3030, y: 9300, rot: 270, w: 1000, d: 580, h: 2050, color: '#ece8de' },
  { t: 'baySeat', x1: 903, y1: 11704, x2: 2667, y2: 12340 },
  // 书房
  { t: 'desk', x: 2227, y: 400, rot: 180, w: 1200, d: 560 },
  { t: 'officeChair', x: 2227, y: 1000, rot: 0, color: '#333333' },
  { t: 'plant', x: 1300, y: 1900, z: 0, r: 170, h: 1100 },
  // 卫生间
  { t: 'shower', x1: 963, y1: 2300, x2: 1863, y2: 3200 },
  { t: 'toilet', x: 2380, y: 2560, rot: 180 },
  { t: 'vanity', x: 1230, y: 3750, rot: 90, w: 800 },
  { t: 'toilet', x: 1270, y: 6870, rot: 180 },
  { t: 'vanity', x: 1900, y: 6900, rot: 180, w: 700 },
  { t: 'shower', x1: 120, y1: 7250, x2: 1000, y2: 7990 },
  // 阳台
  { t: 'washer', x: 3800, y: 12080, rot: 0 },
  { t: 'lounge', x: 5100, y: 12060, rot: 0 },
  { t: 'plant', x: 6650, y: 12150, z: 0, r: 180, h: 900 },
];

// ---------- 导出 OBJ / MTL（单位 cm，Y 向上，Z 向南） ----------
const mats = new Map();
const matName = (color, op) => { const k = `m_${color.slice(1)}_${Math.round(op * 100)}`; mats.set(k, { color, op }); return k; };
const V = (x, y, z) => `v ${(x / 10).toFixed(1)} ${(z / 10).toFixed(1)} ${(y / 10).toFixed(1)}`;
let obj = '# 我家户型 — 由 build.mjs 生成\nmtllib home.mtl\n', vi = 1;
for (const p of prims) {
  obj += `o ${p.name}\nusemtl ${matName(p.color, p.op)}\n`;
  if (p.type === 'box') {
    const xs = [p.x1, p.x2], ys = [p.y1, p.y2], zs = [p.z1, p.z2];
    for (const z of zs) for (const y of ys) for (const x of xs) obj += V(x, y, z) + '\n';
    // 顶点序号: i = zi*4 + yi*2 + xi
    const f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const q of f) obj += 'f ' + q.map(i => i + vi).join(' ') + '\n';
    vi += 8;
  } else if (p.type === 'sph') {
    const nu = 16, nv = 10;
    for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) {
      const t = (j / nv) * Math.PI, a = (i / nu) * Math.PI * 2;
      obj += V(p.cx + p.r * Math.sin(t) * Math.cos(a), p.cy + p.r * Math.sin(t) * Math.sin(a), p.cz - p.r * Math.cos(t)) + '\n';
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const k = (i + 1) % nu, A = vi + j * nu;
      obj += `f ${A + i} ${A + k} ${A + nu + k} ${A + nu + i}\n`;
    }
    vi += (nv + 1) * nu;
  } else {
    const n = 24, ry = p.ry ?? p.r, s2 = p.r2 ?? 1;
    for (const z of [p.z1, p.z2]) for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, s = z === p.z2 ? s2 : 1; obj += V(p.cx + p.r * s * Math.cos(a), p.cy + ry * s * Math.sin(a), z) + '\n'; }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; obj += `f ${vi + i} ${vi + j} ${vi + n + j} ${vi + n + i}\n`; }
    obj += 'f ' + Array.from({ length: n }, (_, i) => vi + n - 1 - i).join(' ') + '\n';
    obj += 'f ' + Array.from({ length: n }, (_, i) => vi + n + i).join(' ') + '\n';
    vi += 2 * n;
  }
}
let mtl = '';
for (const [k, { color, op }] of mats) {
  const [r, g, b] = [1, 3, 5].map(i => (parseInt(color.slice(i, i + 2), 16) / 255).toFixed(3));
  mtl += `newmtl ${k}\nKa 0.2 0.2 0.2\nKd ${r} ${g} ${b}\nKs 0 0 0\nd ${op}\nillum 1\n\n`;
}
writeFileSync(join(OUT, 'home.obj'), obj);
writeFileSync(join(OUT, 'home.mtl'), mtl);

// ---------- 3D 页面 ----------
// app/house.json：给 app/index.html（开发/HA 用，需 http 服务）
// preview.html：把 app/home3d.js 和数据内联成单文件，双击就能打开（需联网加载 three.js）
import { readFileSync, mkdirSync } from 'node:fs';
const roomsOut = [
  ...rooms.map(r => ({ label: r.label, at: r.at, rects: r.rects, floor: { [C.wood]: 'wood', [C.tileK]: 'tileK', [C.tileB]: 'tileB', [C.balcony]: 'balcony' }[r.color] })),
  { label: '餐厅', at: [4400, 4300], rects: [], view: true },
];
const roomLabelAt = { 客厅: [4900, 9300] };
for (const r of roomsOut) if (roomLabelAt[r.label]) r.at = roomLabelAt[r.label];
const data = {
  H,
  walls: prims.filter(p => ['wall', 'glass', 'door'].includes(p.group)),
  rooms: roomsOut, lights, devices, layout,
};
mkdirSync(join(OUT, 'app'), { recursive: true });
writeFileSync(join(OUT, 'app', 'house.json'), JSON.stringify(data));
const shell = readFileSync(join(OUT, 'app', 'index.html'), 'utf8');
const lib = readFileSync(join(OUT, 'app', 'home3d.js'), 'utf8').replace(/^export \{[^}]*\};?\s*$/m, '');
const boot = `${lib}\nwindow.home3d = createHome3D(document.getElementById('app'), ${JSON.stringify(data)});\n`;
const single = shell.replace(/<script type="module" id="boot">[\s\S]*?<\/script>/, () => `<script type="module">\n${boot}</script>`);
if (single === shell) throw new Error('index.html 里没找到 <script type="module" id="boot">');
writeFileSync(join(OUT, 'preview.html'), single);
console.log(`prims=${prims.length} walls=${data.walls.length} lights=${lights.length} layout=${layout.length} obj=${(obj.length / 1024).toFixed(0)}KB`);
