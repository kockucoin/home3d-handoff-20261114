// ===== Home Assistant 自定义卡片：custom:home3d-card =====
// build.mjs 会把它和 home3d.js、户型数据拼成 app/home3d-card.js，放进 HA 的 config/www/home3d/
//
// 卡片配置示例：
//   type: custom:home3d-card
//   height: calc(100vh - 56px)        # 可选
//   entities:                          # 3D 对象名 → HA 实体；没写的设备保持模拟
//     living_ceiling_light: light.xxx
//     living_curtain: cover.xxx
//     living_ac: climate.xxx
//     living_tv: media_player.xxx
//     entry_door: binary_sensor.xxx
// kiosk-mode v15.0.0（NemesisRE/kiosk-mode，用户已同意）：手机上隐藏 HA 顶栏和侧边栏，规则在 home3d-dashboard.yaml 的 kiosk_mode。
// 放在卡片里加载：卡片文件每次都取最新版，不受 loader.js 被浏览器缓存 31 天的影响。
import('/local/home3d/kiosk-mode.js?v=15.0.0').catch(e => console.warn('kiosk-mode 加载失败', e));

// 天气 → 灯光（和「天气情绪灯光.yaml」里的自动化规则一致）
//   夜里：30% · 2700K；阴/雨/雪/雾的白天：65% · 3000K；晴朗白天：85% · 4300K
//   气温 ≥ 30°C 色温再 +600K（看着凉快）；≤ 10°C 再 −300K（看着暖和）
const GLOOMY = ['rainy', 'pouring', 'cloudy', 'fog', 'snowy', 'snowy-rainy', 'lightning', 'lightning-rainy', 'hail'];
function moodFor(h, weatherId) {
  const night = h.states['sun.sun']?.state === 'below_horizon';
  const wx = h.states[weatherId], gloomy = wx && GLOOMY.includes(wx.state), t = wx?.attributes?.temperature;
  let b = night ? 30 : gloomy ? 65 : 85, ct = night ? 2700 : gloomy ? 3000 : 4300;
  if (!night && t != null) ct += t >= 30 ? 600 : t <= 10 ? -300 : 0;
  return { b, ct };
}

class Home3DCard extends HTMLElement {
  setConfig(config) {
    this._config = { entities: {}, ...config };
    this._map = {};
    for (const [id, v] of Object.entries(this._config.entities || {})) this._map[id] = typeof v === 'string' ? v : v.entity;
  }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: 'full', rows: 'auto' }; }

  set hass(hass) {
    this._hass = hass;
    if (!this._started) { this._started = true; this._init(); }
    if (this._api) this._sync();
  }

  // 卡片外壳立即注册；3D 引擎（three.js + 户型）在后台加载，完成前显示「加载中」，避免 HA 报「配置错误」
  async _init() {
    const root = this.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    box.style.cssText = 'position:relative;min-height:360px;overflow:hidden;background:linear-gradient(#1b1c2e,#3a3157)';
    const wait = document.createElement('div');
    wait.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.7);font:15px -apple-system,"PingFang SC",sans-serif';
    wait.textContent = '3D 户型加载中…';
    box.appendChild(wait); root.appendChild(box);
    // 高度：铺满卡片下方剩余的屏幕（有没有 HA 顶栏都适用）；配置了 height 就用配置的
    const fit = () => { box.style.height = this._config.height || `${Math.max(360, window.innerHeight - box.getBoundingClientRect().top)}px`; };
    fit(); requestAnimationFrame(fit); setTimeout(fit, 500);
    window.addEventListener('resize', fit);
    this._last = {};
    let core;
    try { core = await import(`/local/home3d/home3d-core.js?t=${Date.now()}`); }
    catch (e) { wait.textContent = '3D 户型加载失败，请下拉刷新重试'; console.error(e); return; }
    wait.remove();
    this._api = core.createHome3D(box, core.HOUSE, { simple: this._config.simple !== false, glass: this._config.theme !== 'dark', onCommand: (id, patch) => this._command(id, patch) });
    for (const id of Object.keys(this._map)) this._api.setMeta(id, { linked: true });
    this._sync();
  }

  // HA → 3D：实体状态变化时同步到模型
  _sync() {
    const h = this._hass;
    const sun = h.states['sun.sun'];                     // 白天/夜晚跟随真实日出日落
    if (sun && sun.last_updated !== this._sunLU) { this._sunLU = sun.last_updated; this._api.setSun(sun.state === 'above_horizon'); }
    const wx = h.states[this._config.weather || 'weather.forecast_home'];   // 顶栏天气（加了 Met.no 后自动出现）
    if (wx && wx.last_updated !== this._wxLU) { this._wxLU = wx.last_updated; this._api.setWeather({ cond: wx.state, temp: wx.attributes.temperature }); }
    for (const [id, eid] of Object.entries(this._map)) {
      const st = h.states[eid];
      if (!st) { this._api.setMeta(id, { linked: false }); continue; }
      if (this._last[id] === st.last_updated) continue;
      this._last[id] = st.last_updated;
      const a = st.attributes, dom = eid.split('.')[0], unavailable = st.state === 'unavailable';
      this._api.setMeta(id, {
        linked: true, unavailable,
        effects: a.effect_list || null,
        minK: a.min_color_temp_kelvin, maxK: a.max_color_temp_kelvin,
      });
      let p = {};
      if (dom === 'light' || dom === 'switch') {
        p.on = st.state === 'on';
        if (a.brightness != null) p.brightness = Math.max(1, Math.round((a.brightness / 255) * 100));
        if (a.color_temp_kelvin != null) p.ct = Math.round(a.color_temp_kelvin / 100) * 100;
        p.effect = a.effect ?? null;
      } else if (dom === 'cover') {
        p.position = a.current_position ?? (st.state === 'open' ? 100 : 0);
      } else if (dom === 'climate') {
        p.on = st.state !== 'off';
        if (a.temperature != null) p.temp = a.temperature;
        if (['cool', 'heat', 'fan_only'].includes(st.state)) p.mode = st.state === 'fan_only' ? 'fan' : st.state;
      } else if (dom === 'media_player') {
        p.on = !['off', 'standby', 'unavailable'].includes(st.state);
      } else if (dom === 'binary_sensor') {
        p.closed = st.state === 'off';
      }
      this._api.setState(id, p);
    }
  }

  // 3D → HA：用户在模型里操作时调用服务
  _command(id, patch) {
    const eid = this._map[id]; if (!eid) return;            // 未绑定：纯模拟
    const h = this._hass, dom = eid.split('.')[0], st = h.states[eid], a = st?.attributes || {};
    const call = (d, svc, data = {}) => h.callService(d, svc, { entity_id: eid, ...data });
    if (dom === 'switch') return call('switch', patch.on === false ? 'turn_off' : 'turn_on');
    if (dom === 'light') {
      if (patch.on === false) return call('light', 'turn_off');
      // 情绪灯光：轻点开灯（没有指定亮度/色温）时，按天气和昼夜选亮度色温；按住选的预设不受影响
      if (this._config.mood_by_weather && patch.on === true && patch.brightness == null && patch.ct == null && st?.state !== 'on') {
        const m = moodFor(h, this._config.weather || 'weather.forecast_home');
        return call('light', 'turn_on', { brightness_pct: m.b, color_temp_kelvin: Math.min(a.max_color_temp_kelvin || 6500, Math.max(a.min_color_temp_kelvin || 2700, m.ct)) });
      }
      const data = {};
      if (patch.brightness != null) data.brightness_pct = patch.brightness;
      if (patch.ct != null) data.color_temp_kelvin = Math.min(a.max_color_temp_kelvin || 6500, Math.max(a.min_color_temp_kelvin || 2700, patch.ct));
      if (patch.effect != null) data.effect = patch.effect;
      return call('light', 'turn_on', data);
    }
    if (dom === 'cover' && patch.position != null) return call('cover', 'set_cover_position', { position: patch.position });
    if (dom === 'climate') {
      if (patch.on === false) return call('climate', 'turn_off');
      if (patch.on === true) return call('climate', 'turn_on');
      if (patch.temp != null) return call('climate', 'set_temperature', { temperature: patch.temp });
      if (patch.mode) return call('climate', 'set_hvac_mode', { hvac_mode: patch.mode === 'fan' ? 'fan_only' : patch.mode });
    }
    if (dom === 'media_player' && patch.on != null) return call('media_player', patch.on ? 'turn_on' : 'turn_off');
  }
}
if (!customElements.get('home3d-card')) customElements.define('home3d-card', Home3DCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: 'home3d-card', name: '我家 3D 中控', description: '可旋转的 3D 户型，点灯即亮' });
