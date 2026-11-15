// 米家手机中转（初版：只做开灯 / 关灯）
// 3D 页面 → 这台 Mac 上的本服务 → 数据线(adb) → 手机上的米家 App → 蓝牙 → 灯
// 运行：node relay/server.mjs   然后打开 http://localhost:8795 （同一 Wi-Fi 的手机/iPad 用 http://<Mac IP>:8795）
// 前提：手机用数据线连着 Mac、已开 USB 调试、屏幕亮着且已解锁、在灯的蓝牙范围内
import http from 'node:http';
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 8795;
const ADB = process.env.ADB || join(os.homedir(), '.local/bin/adb');
const PKG = 'com.xiaomi.smarthome';
const MAIN = `${PKG}/com.xiaomi.smarthome.SmartHomeMainActivity`;

// 3D 对象名 → 米家里的设备名（和米家 App 卡片上的名字完全一致）
const LIGHTS = {
  living_ceiling_light: '润盛LED智能灯泡Mesh2.0',
  dining_pendant: 'V8智能色温灯（Mesh）',
  bedroom_b_ceiling_light: 'V8智能色温灯（Mesh） 2',
};
// 米家灯页面里的「情景模式」按钮（实测文字）
const SCENES = {
  '润盛LED智能灯泡Mesh2.0': ['日光', '月光', '温馨', '影院', '护眼', '电脑', '助眠', '唤醒'],
  'V8智能色温灯（Mesh）': ['日光', '月光', '温馨', '影院', '阅读', '电脑', '助眠', '唤醒'],
  'V8智能色温灯（Mesh） 2': ['日光', '月光', '温馨', '影院', '阅读', '电脑', '助眠', '唤醒'],
};
const ON_LABELS = ['关灯', '关闭'];            // 按钮写"关"= 灯现在是开的
const OFF_LABELS = ['开灯', '开启', '打开'];   // 实测：V8 开着显示「关闭」、关着显示「开启」（标题栏「已关闭」）
const state = Object.fromEntries(Object.keys(LIGHTS).map(id => [id, { on: null, info: '', brightness: null, ct: null, updated: null }]));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const adb = (...args) => new Promise((res, rej) => execFile(ADB, args, { maxBuffer: 8 << 20, timeout: 20000 }, (e, out, err) => (e ? rej(new Error(err || e.message)) : res(out))));
const sh = cmd => adb('shell', cmd);
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);

async function dump() {
  await sh('uiautomator dump /sdcard/h3.xml >/dev/null 2>&1');
  const xml = await sh('cat /sdcard/h3.xml');
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const a = {}; for (const [, k, v] of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) a[k] = v.replace(/&amp;/g, '&');
    const b = (a.bounds || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (b) { const [x1, y1, x2, y2] = b.slice(1).map(Number); nodes.push({ text: a.text || '', desc: a['content-desc'] || '', x1, y1, x2, y2, cx: (x1 + x2) >> 1, cy: (y1 + y2) >> 1 }); }
  }
  return nodes;
}
const tap = (x, y) => sh(`input tap ${x} ${y}`);
// 手机上"原来在用的 App"（例如开着 3D 页面的浏览器）；系统弹层（广告、通知栏等）不算
let lastUserApp = null;
const SYSTEM = /^(com\.miui\.|com\.android\.systemui|com\.xiaomi\.(?!smarthome)|NotificationShade|StatusBar)/;
async function userAppToReturn(f) {
  const pkg = f.split('/')[0];
  if (f.startsWith(PKG)) return null;
  if (pkg && !SYSTEM.test(pkg) && !SYSTEM.test(f)) lastUserApp = pkg;
  return lastUserApp;
}
const backToApp = pkg => pkg ? sh(`monkey -p ${pkg} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`).catch(() => {}) : null;
async function focus() { return ((await sh('dumpsys window')).match(/mCurrentFocus=Window\{\S+ \S+ ([^}\s]+)\}/) || [])[1] || ''; }

async function ensurePhoneReady() {
  const devs = await adb('devices');
  if (!/\tdevice\b/.test(devs)) throw new Error('没检测到手机：请用数据线连接并允许 USB 调试');
  const pw = await sh('dumpsys power');
  if (!/mWakefulness=Awake/.test(pw)) { await sh('input keyevent KEYCODE_WAKEUP'); await sleep(800); }
  const win = await sh('dumpsys window');
  if (/isKeyguardShowing=true|mShowingLockscreen=true/.test(win)) throw new Error('手机锁屏了：请解锁手机后再点');
}

// ---- 读屏一次约 2.3 秒，所以尽量少读 ----
// 实测：米家切到后台或闲置几秒后，灯的蓝牙连接会断开，页面顶部出现「未连接 / 重连」，整页往下移。
// 所以每次操作前都要确认已连接，并用同一次读屏里的位置去点。
let openPage = null;            // 当前手机上打开的灯页面（设备名）
let cardPos = {};               // 设备名 → 首页「全屋」卡片坐标
let lastPage = {};              // 设备名 → 最近一次读到的页面（按钮/滑条位置）
let connectedAt = 0;            // 最近一次确认蓝牙已连接的时间
let verifyGen = 0;              // 新命令到来时作废还没跑的后台核对
const CT_MIN = 2700, CT_MAX = 6500;
const clamp01 = v => Math.max(0, Math.min(1, v));

function parsePage(nodes, name) {
  if (!nodes.some(n => n.text === name && n.y1 < 300)) return null;
  const btn = nodes.find(n => [...ON_LABELS, ...OFF_LABELS].includes(n.text) && n.x1 < 500 && n.y1 > 600 && n.y1 < 1800);
  const reconnect = nodes.find(n => n.text === '重连');
  const head = nodes.find(n => /亮度/.test(n.text) && /色温/.test(n.text));
  const bar = label => {      // 标签下方、和标签左对齐、高 90–170 的最宽一块 = 滑条
    const L = nodes.find(n => n.text === label && n.x1 < 300); if (!L) return null;
    const c = nodes.filter(n => Math.abs(n.x1 - L.x1) < 40 && n.y1 > L.y2 && n.y1 < L.y2 + 260 && n.y2 - n.y1 > 90 && n.y2 - n.y1 < 170);
    if (!c.length) return null;
    const b = c.reduce((a, x) => (x.x2 - x.x1 > a.x2 - a.x1 ? x : a));
    const v = nodes.find(n => n.y1 >= L.y1 - 15 && n.y2 <= L.y2 + 15 && n.x1 > L.x2 && /^\d+(\.\d+)?\s*[%kK]$/.test(n.text.trim()));
    return { x1: b.x1, x2: b.x2, y: (b.y1 + b.y2) >> 1, val: v ? parseFloat(v.text) : null };
  };
  return {
    on: btn ? ON_LABELS.includes(btn.text) : null,
    power: btn ? { x: btn.x1 - 100, y: btn.cy } : null,
    connected: !!btn && !nodes.some(n => n.text === '未连接'),
    reconnect: reconnect ? { x: reconnect.cx, y: reconnect.cy } : null,
    info: head ? head.text.trim() : '',
    bri: bar('亮度'), ct: bar('色温'),
  };
}
const summary = p => ({ on: p.on, info: p.info, brightness: p.bri?.val ?? null, ct: p.ct?.val ?? null, updated: Date.now() });

// 停在这盏灯的页面上：确保蓝牙已连接（必要时点「重连」）
async function ensureConnected(name) {
  for (let i = 0; i < 16; i++) {
    const p = parsePage(await dump(), name);
    if (!p) return null;
    if (p.connected) { connectedAt = Date.now(); lastPage[name] = p; return p; }
    if (p.reconnect && i % 4 === 0) { log('蓝牙未连接，点重连'); await tap(p.reconnect.x, p.reconnect.y); }
    await sleep(700);
  }
  throw new Error(`「${name}」蓝牙连不上（灯是否通电、手机是否在附近？）`);
}

// 打开某盏灯的控制页（已连接），返回页面信息
async function openLight(name) {
  const f = await focus();
  if (openPage === name && f.includes('PluginRNActivity')) { const p = await ensureConnected(name); if (p) return p; }
  // 回到米家首页：在灯页面里按返回；不行就直接启动首页
  if (f.includes('PluginRNActivity')) { await sh('input keyevent KEYCODE_BACK'); await sleep(700); }
  if (!(await focus()).includes('SmartHomeMainActivity')) { await sh(`am start -n ${MAIN} -f 0x04000000`); await sleep(1500); cardPos = {}; }
  if (!cardPos[name]) {
    let nodes = await dump();
    const all = nodes.find(n => n.text === '全屋'); if (all) { await tap(all.cx, all.cy); await sleep(500); nodes = await dump(); }
    for (const nm of Object.values(LIGHTS)) { const l = nodes.find(n => n.text === nm); if (l) cardPos[nm] = { x: l.cx, y: l.y1 - 150 }; }
    if (!cardPos[name]) throw new Error(`米家首页没找到「${name}」`);
  }
  await tap(cardPos[name].x, cardPos[name].y);
  openPage = null; await sleep(1200);
  // 蓝牙刚连上时页面可能先显示占位状态：已连接且连续两次读到相同开关状态才算数
  let prev = null;
  for (let i = 0; i < 16; i++) {
    const p = parsePage(await dump(), name);
    if (p && !p.connected && p.reconnect && i % 4 === 3) await tap(p.reconnect.x, p.reconnect.y);
    if (p && p.connected && prev && prev.connected && p.on === prev.on) { openPage = name; connectedAt = Date.now(); lastPage[name] = p; return p; }
    prev = p;
    await sleep(300);
  }
  cardPos = {};
  throw new Error(`「${name}」控制页没打开或蓝牙没连上（灯是否通电、手机是否在附近？）`);
}

// 把米家切到前台、打开这盏灯的页面；返回 { p, backTo }
async function prepare(id) {
  const name = LIGHTS[id]; if (!name) throw new Error('这盏灯还没绑定米家设备');
  await ensurePhoneReady();
  const before = await focus(), backTo = await userAppToReturn(before);
  if (backTo) { await sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`); await sleep(900); }
  return { name, backTo, p: await openLight(name) };
}

// 后台核对（只在米家一直在前台时用）：点完后读屏，连续两次不符才补点
async function verify(id, wantOn, gen) {
  const name = LIGHTS[id];
  try {
    let miss = 0;
    for (let k = 0; k < 4; k++) {
      if (gen !== verifyGen) return;
      await sleep(1000);
      if (gen !== verifyGen) return;
      const p = parsePage(await dump(), name);
      if (!p || !p.connected) return;
      lastPage[name] = p; connectedAt = Date.now();
      state[id] = summary(p);
      if (p.on === wantOn) return;
      if (++miss === 2) { log('核对：两次读到状态不对，补点一次', id); await tap(p.power.x, p.power.y); }
      if (miss >= 3) { log('核对：补点后仍不对，放弃', id); return; }
    }
  } catch (e) { log('核对失败', e.message); }
}

async function setLight(id, wantOn) {
  const name = LIGHTS[id]; if (!name) throw new Error('这盏灯还没绑定米家设备');
  const gen = ++verifyGen;
  await ensurePhoneReady();
  const before = await focus();
  // 快速通道：米家一直在前台、刚确认过蓝牙连接（4 秒内）→ 直接点电源按钮
  const lp = lastPage[name];
  if (openPage === name && before.includes('PluginRNActivity') && Date.now() - connectedAt < 4000 && lp?.power && state[id].on != null) {
    if (wantOn == null) wantOn = !state[id].on;
    if (state[id].on !== wantOn) await tap(lp.power.x, lp.power.y);
    state[id] = { ...state[id], on: wantOn, updated: Date.now() };
    queue(() => verify(id, wantOn, gen));
    return { ...state[id], fast: true };
  }
  const { p, backTo } = await prepare(id);
  if (wantOn == null) wantOn = !p.on;
  if (p.on !== wantOn) await tap(p.power.x, p.power.y);
  state[id] = { ...summary(p), on: wantOn };
  if (backTo) {
    // 3D 页面在手机上：切回去之前先确认一次（之后米家进后台就读不到了）
    await sleep(1200); const q = parsePage(await dump(), name);
    if (q && q.connected) { state[id] = summary(q); if (q.on !== wantOn) { log('状态不对，补点一次', id); await tap(q.power.x, q.power.y); state[id].on = wantOn; } }
    await backToApp(backTo);
  } else queue(() => verify(id, wantOn, gen));
  return state[id];
}

// 调亮度 / 色温：拖动滑条（单纯点击滑条不生效，必须拖）
async function setLevel(id, { brightness, ct }) {
  ++verifyGen;
  const { name, p: p0, backTo } = await prepare(id);
  let p = p0;
  if (!p.on) { await tap(p.power.x, p.power.y); await sleep(1500); p = (await ensureConnected(name)) || p; }
  // 实测拖动会"冲过头"（和拖动速度有关）：慢速拖 → 读回数值 → 不准就按差值再拖，最多 4 次
  for (const [key, want] of [['bri', brightness], ['ct', ct]]) {
    if (want == null || !p[key]) continue;
    const toFrac = v => (key === 'bri' ? (v - 1) / 99 : (v - CT_MIN) / (CT_MAX - CT_MIN));
    const tol = key === 'bri' ? 3 : 150;
    for (let k = 0; k < 4; k++) {
      const b = p[key]; if (!b) break;
      if (b.val != null && Math.abs(b.val - want) <= tol) break;
      const xC = b.val == null ? (b.x1 + b.x2) >> 1 : Math.round(b.x1 + (b.x2 - b.x1) * clamp01(toFrac(b.val)));
      let xT = Math.round(b.x1 + (b.x2 - b.x1) * clamp01(toFrac(want)));
      if (k > 0) xT = Math.round(xC + (xT - xC) * 0.8);          // 修正时少拖一点，避免来回过冲
      if (Math.abs(xT - xC) < 3) xT = xC + Math.sign(xT - xC || 1) * 3;
      await sh(`input swipe ${xC} ${b.y} ${xT} ${b.y} 1200`);
      await sleep(900);
      p = (await ensureConnected(name)) || p;
      log(`  ${key === 'bri' ? '亮度' : '色温'} 第${k + 1}次 → ${p[key]?.val}`);
    }
  }
  state[id] = summary(p);
  if (backTo) await backToApp(backTo);
  return state[id];
}


// 情景模式：点页面里的模式按钮（比拖滑条可靠）。按钮在页面下方，需要先往下滚
async function setScene(id, scene) {
  ++verifyGen;
  const { name, p: p0, backTo } = await prepare(id);
  if (!(SCENES[name] || []).includes(scene)) throw new Error(`「${name}」没有「${scene}」模式`);
  let p = p0;
  if (!p.on) { await tap(p.power.x, p.power.y); await sleep(1500); }
  let btn = null;
  for (let k = 0; k < 3 && !btn; k++) {
    const nodes = await dump();
    btn = nodes.find(n => n.text === scene && n.y1 > 300 && n.y2 < 2250);
    if (!btn) { await sh('input swipe 540 1900 540 900 400'); await sleep(700); }
  }
  if (!btn) throw new Error(`页面里没找到「${scene}」按钮`);
  await tap(btn.cx, btn.y1 - 60);                     // 点模式图标（文字上方）
  await sleep(3000);                                  // 灯切换模式需要 2–3 秒，读太早会读到旧值
  await sh('input swipe 540 700 540 2000 300'); await sh('input swipe 540 700 540 2000 300'); await sleep(700);   // 滚回顶部
  p = (await ensureConnected(name)) || p;
  state[id] = summary(p);
  if (backTo) await backToApp(backTo);
  return state[id];
}

async function readLight(id) {
  const { p, backTo } = await prepare(id);
  state[id] = summary(p);
  if (backTo) await backToApp(backTo);
  return state[id];
}

// 命令排队，一次只操作一盏
let chain = Promise.resolve();
const queue = fn => (chain = chain.then(fn, fn));

const page = () => {
  const f = join(DIR, '..', 'relay.html');
  return existsSync(f) ? readFileSync(f) : Buffer.from('先运行 node build.mjs 生成 relay.html');
};
http.createServer(async (req, res) => {
  const send = (code, obj, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) return send(200, page(), 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url.startsWith('/vendor/')) {      // 本地 three.js
      const f = join(DIR, '..', 'app', decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(join(DIR, '..', 'app', 'vendor')) || !existsSync(f)) return send(404, { ok: false });
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'max-age=86400' }); return res.end(readFileSync(f));
    }
    if (req.method === 'GET' && req.url === '/api/state') return send(200, { lights: LIGHTS, scenes: Object.fromEntries(Object.entries(LIGHTS).map(([id, n]) => [id, SCENES[n] || []])), state });
    if (req.method === 'POST' && req.url === '/api/light') {
      let body = ''; for await (const c of req) body += c;
      const { id, on, read, brightness, ct, scene } = JSON.parse(body || '{}');
      const t0 = Date.now();
      const lv = brightness != null || ct != null;
      const r = await queue(() => (read ? readLight(id) : scene ? setScene(id, scene) : lv ? setLevel(id, { brightness, ct }) : setLight(id, on)));
      log(read ? '读取' : scene ? `模式「${scene}」` : lv ? `调节(亮度${brightness ?? '-'} 色温${ct ?? '-'})` : on ? '开灯' : '关灯', id, '→', r.on ? '开' : '关', r.brightness != null ? `${r.brightness}% ${r.ct}K` : '', `${Date.now() - t0}ms`);
      return send(200, { ok: true, id, ...r });
    }
    send(404, { ok: false, error: 'not found' });
  } catch (e) {
    log('失败', e.message);
    send(500, { ok: false, error: e.message });
  }
}).listen(PORT, '0.0.0.0', () => {
  const ip = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal && i.address.startsWith('192.168'))?.address;
  log(`米家中转已启动：http://localhost:${PORT}   手机/iPad：http://${ip}:${PORT}`);
});
