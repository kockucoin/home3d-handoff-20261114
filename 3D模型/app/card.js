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
    if (!this._api) this._init();
    this._sync();
  }

  _init() {
    const root = this.attachShadow({ mode: 'open' });
    const box = document.createElement('div');
    box.style.cssText = `position:relative;height:${this._config.height || 'calc(100vh - 56px)'};min-height:420px;overflow:hidden;border-radius:var(--ha-card-border-radius,12px)`;
    root.appendChild(box);
    this._last = {};
    this._api = createHome3D(box, HOUSE, { onCommand: (id, patch) => this._command(id, patch) });
    for (const id of Object.keys(this._map)) this._api.setMeta(id, { linked: true });
  }

  // HA → 3D：实体状态变化时同步到模型
  _sync() {
    const h = this._hass;
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
