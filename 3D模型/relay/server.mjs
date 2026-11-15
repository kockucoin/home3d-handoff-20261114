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
const ON_LABELS = ['关灯', '关闭'];            // 按钮写"关"= 灯现在是开的
const OFF_LABELS = ['开灯', '开启', '打开'];   // 实测：V8 开着显示「关闭」、关着显示「开启」（标题栏「已关闭」）
const state = Object.fromEntries(Object.keys(LIGHTS).map(id => [id, { on: null, info: '', updated: null }]));

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

// ---- 读屏一次约 2.3 秒，所以尽量少读：记住"当前打开的是哪盏灯的页面"、电源按钮和首页卡片的位置 ----
let openPage = null;            // 当前手机上打开的灯页面（设备名）
let btnPos = {};                // 设备名 → 电源按钮坐标
let cardPos = {};               // 设备名 → 首页「全屋」卡片坐标
let verifyGen = 0;              // 新命令到来时作废还没跑的后台核对，避免拖慢下一条命令

function readPage(nodes, name) {
  const btn = nodes.find(n => [...ON_LABELS, ...OFF_LABELS].includes(n.text) && n.x1 < 500 && n.y1 > 600 && n.y1 < 1600);
  if (!btn || !nodes.some(n => n.text === name && n.y1 < 300)) return null;
  const head = nodes.find(n => /亮度/.test(n.text) && /色温/.test(n.text));
  btnPos[name] = { x: btn.x1 - 100, y: btn.cy };
  return { on: ON_LABELS.includes(btn.text), info: head ? head.text.trim() : '' };
}

// 打开某盏灯的控制页并读取开关状态
async function openLight(name) {
  const f = await focus();
  if (openPage === name && f.includes('PluginRNActivity')) {
    const p = readPage(await dump(), name); if (p) return p;
  }
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
  // 等控制页出现 + 蓝牙连上（出现开/关按钮）
  // 蓝牙刚连上时页面可能先显示占位状态：连续两次读到相同状态才算数
  let prev = null;
  for (let i = 0; i < 12; i++) {
    const p = readPage(await dump(), name);
    if (p && prev && p.on === prev.on) { openPage = name; return p; }
    prev = p;
    await sleep(300);
  }
  cardPos = {};
  throw new Error(`「${name}」控制页没打开或蓝牙没连上（灯是否通电、手机是否在附近？）`);
}

// 后台核对：点完 1 秒后读屏；连续两次（间隔 1 秒）都和预期不符才补点一次，避免标签刷新慢导致误判来回切换
async function verify(id, wantOn, gen) {
  const name = LIGHTS[id];
  try {
    let miss = 0;
    for (let k = 0; k < 4; k++) {
      if (gen !== verifyGen) return;
      await sleep(1000);
      if (gen !== verifyGen) return;
      const p = readPage(await dump(), name);
      if (!p) { openPage = null; return; }
      state[id] = { on: p.on, info: p.info, updated: Date.now() };
      if (p.on === wantOn) return;
      if (++miss === 2) { log('核对：两次读到状态不对，补点一次', id); await tap(btnPos[name].x, btnPos[name].y); }
      if (miss >= 3) { log('核对：补点后仍不对，放弃', id); return; }
    }
  } catch (e) { log('核对失败', e.message); }
}

async function setLight(id, wantOn) {
  const name = LIGHTS[id]; if (!name) throw new Error('这盏灯还没绑定米家设备');
  const gen = ++verifyGen;
  await ensurePhoneReady();
  let before = await focus(); const backTo = await userAppToReturn(before);
  // 3D 页面开在手机浏览器里时：先把米家切回前台（保留它停着的灯页面，不重新打开）
  if (backTo) { await sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`); await sleep(900); before = await focus(); }
  // 快速通道：手机正停在这盏灯的页面、状态已知 → 直接点电源按钮（约 0.5 秒），之后后台核对
  const known = state[id].on;
  if (openPage === name && before.includes('PluginRNActivity') && known != null && btnPos[name]) {
    if (wantOn == null) wantOn = !known;
    if (known !== wantOn) await tap(btnPos[name].x, btnPos[name].y);
    state[id] = { ...state[id], on: wantOn, updated: Date.now() };
    if (!backTo) queue(() => verify(id, wantOn, gen));   // 3D 页面在手机上时跳过（核对要读米家的屏幕）
    if (backTo) await backToApp(backTo);
    return { ...state[id], fast: true };
  }
  const p = await openLight(name);
  if (wantOn == null) wantOn = !p.on;
  if (p.on !== wantOn) await tap(btnPos[name].x, btnPos[name].y);
  state[id] = { on: wantOn, info: p.info, updated: Date.now() };
  if (!backTo) queue(() => verify(id, wantOn, gen));   // 3D 页面在手机上时跳过（核对要读米家的屏幕）
  if (backTo) await backToApp(backTo);   // 手机上原来开着别的 App（例如浏览器里的 3D 页面），切回去
  return state[id];
}
async function readLight(id) {
  await ensurePhoneReady();
  const before = await focus(), backTo = await userAppToReturn(before);
  if (backTo) { await sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`); await sleep(900); }
  const p = await openLight(LIGHTS[id]);
  state[id] = { on: p.on, info: p.info, updated: Date.now() };
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
    if (req.method === 'GET' && req.url === '/api/state') return send(200, { lights: LIGHTS, state });
    if (req.method === 'POST' && req.url === '/api/light') {
      let body = ''; for await (const c of req) body += c;
      const { id, on, read } = JSON.parse(body || '{}');
      const t0 = Date.now();
      const r = await queue(() => (read ? readLight(id) : setLight(id, on)));
      log(read ? '读取' : on ? '开灯' : '关灯', id, '→', r.on ? '开' : '关', `${Date.now() - t0}ms`);
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
