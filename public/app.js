// ============================================================
// Smart Library Monitor — Frontend App
// FILE: public/app.js
// Real-time WebSocket client + Chart.js + Simulator fallback
// ============================================================

'use strict';

// ── Zone Config ───────────────────────────────────────────────
const ZC = {
  'zone-reading-hall':  { color:'#3b82f6', icon:'📖', floor:'1F', name:'Main Reading Hall',    nW:40, nC:55 },
  'zone-study-rooms':   { color:'#14b8a6', icon:'👥', floor:'2F', name:'Group Study Rooms',    nW:55, nC:70 },
  'zone-reference':     { color:'#8b5cf6', icon:'📚', floor:'1F', name:'Reference Section',    nW:38, nC:50 },
  'zone-computer-lab':  { color:'#10b981', icon:'💻', floor:'3F', name:'Digital Resource Lab', nW:60, nC:75 },
  'zone-kids-corner':   { color:'#f97316', icon:'🧒', floor:'1F', name:"Children's Corner",    nW:70, nC:85 },
};

const UNITS = { noise:'dB(A)', temperature:'°C', humidity:'%', co2:'ppm', light:'lux', occupancy:'persons' };
const ICONS = { noise:'🔊', temperature:'🌡️', humidity:'💧', co2:'🫁', light:'💡', occupancy:'👤' };

// ── App State ─────────────────────────────────────────────────
const S = {
  ws: null,
  zones: {},
  sensors: {},
  readings: {},   // zoneId -> { type -> reading }
  zoneNoise: {},
  alerts: [],
  history: { labels:[], noise:[], temp:[], co2:[] },
  charts: {},
  lastHistTs: 0,
};

// ── Chart Setup ───────────────────────────────────────────────
function initCharts() {
  Chart.defaults.color         = '#7a91b0';
  Chart.defaults.font.family   = "'JetBrains Mono', monospace";
  Chart.defaults.font.size     = 11;

  const grid = { color: 'rgba(99,130,170,0.08)', drawBorder: false };
  const line = { pointRadius: 0, borderWidth: 2, tension: 0.42, fill: true };

  // Noise chart
  S.charts.noise = new Chart(document.getElementById('chartNoise'), {
    type: 'line',
    data: {
      labels: S.history.labels,
      datasets: [
        { label:'Avg dB(A)', data: S.history.noise, borderColor:'#3b82f6', backgroundColor:'rgba(59,130,246,0.08)', ...line },
        { label:'Warning',   data: Array(40).fill(45), borderColor:'rgba(239,68,68,0.4)',
          borderDash:[6,4], borderWidth:1, pointRadius:0, fill:false },
      ],
    },
    options: {
      responsive:true, animation:{ duration:350 },
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ display:true, grid, ticks:{ maxTicksLimit:6 } },
        y:{ display:true, grid, min:20, max:90, ticks:{ callback: v => v+'dB' } },
      },
    },
  });

  // Comfort chart (temp + co2)
  S.charts.comfort = new Chart(document.getElementById('chartComfort'), {
    type: 'line',
    data: {
      labels: S.history.labels,
      datasets: [
        { label:'Temp', data:S.history.temp, borderColor:'#f97316', backgroundColor:'rgba(249,115,22,0.08)', yAxisID:'y',  ...line },
        { label:'CO₂',  data:S.history.co2,  borderColor:'#14b8a6', backgroundColor:'rgba(20,184,166,0.08)', yAxisID:'y2', ...line },
      ],
    },
    options: {
      responsive:true, animation:{ duration:350 },
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ display:true, grid, ticks:{ maxTicksLimit:6 } },
        y:  { display:true, grid, position:'left',  ticks:{ callback: v => v+'°' } },
        y2: { display:true, grid:{ display:false }, position:'right', ticks:{ callback: v => (v*10).toFixed(0)+'p' } },
      },
    },
  });

  // Bar chart
  const zoneIds = Object.keys(ZC);
  S.charts.bar = new Chart(document.getElementById('chartBar'), {
    type: 'bar',
    data: {
      labels: ['Reading Hall','Study Rooms','Reference','Digital Lab','Kids Corner'],
      datasets: [{
        label: 'Noise dB(A)',
        data: [0,0,0,0,0],
        backgroundColor: zoneIds.map(id => ZC[id].color + '99'),
        borderColor:     zoneIds.map(id => ZC[id].color),
        borderWidth: 1, borderRadius: 4,
      }],
    },
    options: {
      responsive:true, animation:{ duration:600 },
      plugins:{ legend:{ display:false } },
      scales:{
        x:{ grid:{ display:false } },
        y:{ display:true, grid, min:0, max:90, ticks:{ callback: v => v+'dB' } },
      },
    },
  });
}

// ── WebSocket Connection ──────────────────────────────────────
function connectWS() {
  setConn(false, 'Connecting...');
  const ws = new WebSocket(`ws://${location.hostname}:${location.port||3000}`);
  S.ws = ws;

  ws.onopen  = () => setConn(true, 'Live ● WebSocket');
  ws.onclose = () => { setConn(false,'Reconnecting...'); setTimeout(connectWS, 3000); };
  ws.onerror = () => ws.close();

  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'snapshot')    handleSnapshot(msg.payload);
      if (msg.type === 'sensor_data') handleReading(msg.payload);
      if (msg.type === 'new_alert')   handleAlert(msg.payload);
    } catch(e) {}
  };
}

function setConn(online, label) {
  document.getElementById('connDot').className   = 'conn-dot' + (online ? '' : ' red');
  document.getElementById('connLabel').textContent = label;
}

// ── Data Handlers ─────────────────────────────────────────────
function handleSnapshot(data) {
  (data.zones   || []).forEach(z => S.zones[z.id]   = z);
  (data.sensors || []).forEach(s => S.sensors[s.id] = s);
  S.readings = data.readings || {};
  S.alerts   = (data.activeAlerts || []);

  // Init zoneNoise from snapshot
  for (const [zid, zr] of Object.entries(S.readings)) {
    if (zr.noise) S.zoneNoise[zid] = zr.noise.value;
  }

  buildZoneCards();
  renderSensorTable();
  renderAlerts();
  updateKPIs();
  updateFloorPlan();
  updateBarChart();
}

function handleReading(reading) {
  const { zone_id, type, value, sensor_id } = reading;
  if (!S.readings[zone_id]) S.readings[zone_id] = {};
  S.readings[zone_id][type] = reading;
  if (type === 'noise') S.zoneNoise[zone_id] = value;

  if (S.sensors[sensor_id]) {
    S.sensors[sensor_id].lastValue = value;
    S.sensors[sensor_id].unit      = reading.unit;
    S.sensors[sensor_id].comfort   = reading.comfort;
    S.sensors[sensor_id].last_seen = reading.timestamp;
    S.sensors[sensor_id].status    = 'online';
  }

  pushChartHistory();
  updateZoneCard(zone_id);
  updateFloorPlan();
  updateBarChart();
  updateKPIs();
  renderSensorTable();
}

function handleAlert(alert) {
  S.alerts.unshift(alert);
  if (S.alerts.length > 40) S.alerts.pop();
  renderAlerts();
  updateKPIs();
}

// ── Chart History ─────────────────────────────────────────────
function pushChartHistory() {
  const now = Date.now();
  if (now - S.lastHistTs < 3500) return;
  S.lastHistTs = now;

  const ts = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const n = [], t = [], c = [];
  for (const zr of Object.values(S.readings)) {
    if (zr.noise)       n.push(zr.noise.value);
    if (zr.temperature) t.push(zr.temperature.value);
    if (zr.co2)         c.push(zr.co2.value);
  }
  const avg = a => a.length ? +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1) : null;

  S.history.labels.push(ts);
  S.history.noise.push(avg(n));
  S.history.temp.push(avg(t));
  S.history.co2.push(avg(c) ? +(avg(c)/10).toFixed(1) : null);

  const MAX = 35;
  if (S.history.labels.length > MAX) {
    S.history.labels.shift(); S.history.noise.shift();
    S.history.temp.shift();   S.history.co2.shift();
  }

  S.charts.noise.update();
  S.charts.comfort.update();
}

// ── Zone Cards ────────────────────────────────────────────────
function buildZoneCards() {
  const wrap = document.getElementById('zonesWrap');
  wrap.innerHTML = '';
  Object.keys(ZC).forEach(id => {
    const el = document.createElement('div');
    el.className = 'zone-card';
    el.id = `zc-${id}`;
    el.onclick = () => selectZone(id);
    wrap.appendChild(el);
    fillZoneCard(el, id);
  });
}

function updateZoneCard(zoneId) {
  const el = document.getElementById(`zc-${zoneId}`);
  if (el) fillZoneCard(el, zoneId);
}

function fillZoneCard(el, id) {
  const cfg = ZC[id];
  const r   = S.readings[id] || {};
  const noise = r.noise?.value;
  const temp  = r.temperature?.value;
  const hum   = r.humidity?.value;
  const occ   = r.occupancy?.value;

  const pct   = noise ? Math.min(100, (noise/90)*100) : 0;
  const nc    = pct > 72 ? '#ef4444' : pct > 55 ? '#f59e0b' : '#3b82f6';
  const aCls  = noise >= cfg.nC ? 'crit' : noise >= cfg.nW ? 'warn' : '';

  el.innerHTML = `
    <div class="zc-head">
      <div class="zc-name">${cfg.icon} ${cfg.name}</div>
      <span class="zc-floor">${cfg.floor}</span>
    </div>
    <div class="zc-metrics">
      <div class="mpill ${aCls}">
        <span class="mpill-icon">🔊</span>
        <span class="mpill-val" style="color:${nc}">${noise!=null ? noise.toFixed(1) : '—'}</span>
        <span class="mpill-lbl">dB(A)</span>
      </div>
      <div class="mpill">
        <span class="mpill-icon">🌡️</span>
        <span class="mpill-val">${temp!=null ? temp.toFixed(1) : '—'}</span>
        <span class="mpill-lbl">°C</span>
      </div>
      <div class="mpill">
        <span class="mpill-icon">💧</span>
        <span class="mpill-val">${hum!=null ? hum.toFixed(0) : '—'}</span>
        <span class="mpill-lbl">%RH</span>
      </div>
      <div class="mpill">
        <span class="mpill-icon">👤</span>
        <span class="mpill-val">${occ!=null ? occ : '—'}</span>
        <span class="mpill-lbl">ppl</span>
      </div>
    </div>
    <div class="noise-track">
      <div class="noise-fill" style="width:${pct}%;background:${nc}"></div>
    </div>`;
}

function selectZone(id) {
  document.querySelectorAll('.zone-card').forEach(e => e.classList.remove('active'));
  const c = document.getElementById(`zc-${id}`);
  if (c) c.classList.add('active');
  document.getElementById('cmdZone').value = id;
}

// ── Alerts ────────────────────────────────────────────────────
function renderAlerts() {
  const list = document.getElementById('alertsList');
  const badge = document.getElementById('alertBadge');
  const active = S.alerts.filter(a => !a.resolved);
  badge.textContent = active.length;

  if (!active.length) {
    list.innerHTML = '<div class="al-empty">✓ No active alerts</div>';
    return;
  }

  list.innerHTML = active.slice(0, 20).map(a => {
    const t  = new Date(a.created_at).toLocaleTimeString('en-IN');
    const zn = ZC[a.zone_id]?.name || a.zone_id;
    return `
      <div class="al-item ${a.severity}">
        <div class="al-top">
          <span class="al-sev ${a.severity}">${a.severity.toUpperCase()}</span>
          <span class="al-time">${t}</span>
        </div>
        <div class="al-msg">${a.message}</div>
        <div class="al-zone">📍 ${zn}</div>
      </div>`;
  }).join('');
}

// ── Sensor Table ──────────────────────────────────────────────
function renderSensorTable() {
  const tbody = document.getElementById('sensorTbody');
  const sensors = Object.values(S.sensors);
  if (!sensors.length) return;

  tbody.innerHTML = sensors.map(s => {
    const zoneName = ZC[s.zone_id]?.name || s.zone_id;
    const val      = s.lastValue != null ? `${s.lastValue.toFixed(1)} ${s.unit||''}` : '—';
    const c        = s.comfort || '—';
    const status   = s.status || 'online';
    const ts       = s.last_seen ? new Date(s.last_seen).toLocaleTimeString('en-IN') : '—';

    return `<tr>
      <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">${s.id}</td>
      <td>${zoneName}</td>
      <td>${ICONS[s.type]||'📡'} ${s.type}</td>
      <td style="font-family:var(--mono);font-weight:600">${val}</td>
      <td>${c !== '—' ? `<span class="chip ${c}">${c}</span>` : '—'}</td>
      <td><span class="sbadge ${status}"><span class="sdot"></span>${status}</span></td>
      <td style="font-family:var(--mono);font-size:11px;color:var(--muted)">${ts}</td>
    </tr>`;
  }).join('');
}

// ── KPIs ──────────────────────────────────────────────────────
function updateKPIs() {
  const n = [], t = [], c = [];
  for (const zr of Object.values(S.readings)) {
    if (zr.noise)       n.push(zr.noise.value);
    if (zr.temperature) t.push(zr.temperature.value);
    if (zr.co2)         c.push(zr.co2.value);
  }
  const avg = a => a.length ? +(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1) : null;
  const an = avg(n), at = avg(t), ac = avg(c);

  document.getElementById('kNoise').innerHTML  = `${an??'—'}<span class="kpi-unit">dB</span>`;
  document.getElementById('kTemp').innerHTML   = `${at??'—'}<span class="kpi-unit">°C</span>`;
  document.getElementById('kCO2').innerHTML    = `${ac??'—'}<span class="kpi-unit">ppm</span>`;

  const active = S.alerts.filter(a => !a.resolved).length;
  document.getElementById('kAlerts').textContent  = active;
  document.getElementById('kAlertsSub').textContent = active ? `${S.alerts.filter(a=>!a.resolved&&a.severity==='critical').length} critical` : 'All zones clear';

  const online = Object.values(S.sensors).filter(s => s.status !== 'offline').length;
  document.getElementById('kSensors').innerHTML = `${online}<span class="kpi-unit">/${Object.values(S.sensors).length}</span>`;

  let comfort = '—';
  if (an && at) {
    if (an < 40 && at >= 19 && at <= 26)      comfort = '😊 Excellent';
    else if (an < 55 && at >= 17 && at <= 28) comfort = '🙂 Good';
    else if (an < 65)                          comfort = '😐 Fair';
    else                                       comfort = '😟 Poor';
  }
  document.getElementById('kComfort').textContent = comfort;
}

// ── Floor Plan ────────────────────────────────────────────────
function updateFloorPlan() {
  Object.entries(ZC).forEach(([id, cfg]) => {
    const valEl  = document.getElementById(`fp-val-${id}`);
    const rectEl = document.getElementById(`fp-zone-${id}`);
    const n      = S.zoneNoise[id];
    if (valEl && n != null) {
      valEl.textContent = n.toFixed(0);
      const col = n >= cfg.nC ? '#ef4444' : n >= cfg.nW ? '#f59e0b' : cfg.color;
      valEl.setAttribute('fill', col);
      if (rectEl) rectEl.setAttribute('fill', col + '18');
    }
  });
}

// ── Bar Chart ─────────────────────────────────────────────────
function updateBarChart() {
  const ids = Object.keys(ZC);
  S.charts.bar.data.datasets[0].data = ids.map(id => S.zoneNoise[id] ?? 0);
  S.charts.bar.update('none');
}

// ── Commands ──────────────────────────────────────────────────
const mqttLines = [];
function logMQTT(topic, value) {
  mqttLines.unshift(
    `<div class="ml"><span style="color:var(--muted)">${new Date().toLocaleTimeString('en-IN')}</span> ` +
    `<span class="tp">${topic}</span> → <span class="vl">${value}</span></div>`
  );
  if (mqttLines.length > 15) mqttLines.pop();
  const el = document.getElementById('mqttLog');
  if (el) el.innerHTML = mqttLines.join('');
}

async function sendCmd(cmd) {
  const zone = document.getElementById('cmdZone').value;
  const topic = `library/commands/${zone}`;
  logMQTT(topic, cmd);

  const msgs = {
    alert_noise: `Noise alert triggered in ${ZC[zone].name}`,
    silence:     `Alerts silenced in ${ZC[zone].name}`,
    ac_cool:     `AC cooling activated in ${ZC[zone].name}`,
    ventilation: `Ventilation increased in ${ZC[zone].name}`,
    emergency:   `🚨 EMERGENCY ALERT: ${ZC[zone].name}`,
  };

  try {
    await fetch('/api/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zoneId: zone, command: cmd, topic }),
    });
  } catch(e) {}

  S.alerts.unshift({
    id: Math.random().toString(36).slice(2),
    zone_id: zone,
    severity: cmd === 'emergency' ? 'critical' : 'info',
    message: msgs[cmd] || cmd,
    created_at: new Date().toISOString(),
    resolved: false,
  });
  renderAlerts();
  updateKPIs();
}

// ── Clock ─────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('clock');
  const tick = () => el.textContent = new Date().toLocaleTimeString('en-IN', {
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  });
  tick(); setInterval(tick, 1000);
}

// ── Fallback: Client-side Simulation ─────────────────────────
// If server is not running, this makes the dashboard fully work
// with simulated live data

const SIM_SENSORS = [
  { id:'sns-rh-noise-1',  zone:'zone-reading-hall',  type:'noise',       zone_id:'zone-reading-hall'  },
  { id:'sns-rh-noise-2',  zone:'zone-reading-hall',  type:'noise',       zone_id:'zone-reading-hall'  },
  { id:'sns-rh-temp-1',   zone:'zone-reading-hall',  type:'temperature', zone_id:'zone-reading-hall'  },
  { id:'sns-rh-hum-1',    zone:'zone-reading-hall',  type:'humidity',    zone_id:'zone-reading-hall'  },
  { id:'sns-rh-co2-1',    zone:'zone-reading-hall',  type:'co2',         zone_id:'zone-reading-hall'  },
  { id:'sns-rh-occ-1',    zone:'zone-reading-hall',  type:'occupancy',   zone_id:'zone-reading-hall'  },
  { id:'sns-sr-noise-1',  zone:'zone-study-rooms',   type:'noise',       zone_id:'zone-study-rooms'   },
  { id:'sns-sr-temp-1',   zone:'zone-study-rooms',   type:'temperature', zone_id:'zone-study-rooms'   },
  { id:'sns-sr-co2-1',    zone:'zone-study-rooms',   type:'co2',         zone_id:'zone-study-rooms'   },
  { id:'sns-sr-occ-1',    zone:'zone-study-rooms',   type:'occupancy',   zone_id:'zone-study-rooms'   },
  { id:'sns-ref-noise-1', zone:'zone-reference',     type:'noise',       zone_id:'zone-reference'     },
  { id:'sns-ref-temp-1',  zone:'zone-reference',     type:'temperature', zone_id:'zone-reference'     },
  { id:'sns-ref-hum-1',   zone:'zone-reference',     type:'humidity',    zone_id:'zone-reference'     },
  { id:'sns-ref-light-1', zone:'zone-reference',     type:'light',       zone_id:'zone-reference'     },
  { id:'sns-cl-noise-1',  zone:'zone-computer-lab',  type:'noise',       zone_id:'zone-computer-lab'  },
  { id:'sns-cl-temp-1',   zone:'zone-computer-lab',  type:'temperature', zone_id:'zone-computer-lab'  },
  { id:'sns-cl-co2-1',    zone:'zone-computer-lab',  type:'co2',         zone_id:'zone-computer-lab'  },
  { id:'sns-cl-occ-1',    zone:'zone-computer-lab',  type:'occupancy',   zone_id:'zone-computer-lab'  },
  { id:'sns-kc-noise-1',  zone:'zone-kids-corner',   type:'noise',       zone_id:'zone-kids-corner'   },
  { id:'sns-kc-temp-1',   zone:'zone-kids-corner',   type:'temperature', zone_id:'zone-kids-corner'   },
];

const SIM_STATE = {
  occ:  { 'zone-reading-hall':45, 'zone-study-rooms':18, 'zone-reference':22, 'zone-computer-lab':38, 'zone-kids-corner':12 },
  temp: { 'zone-reading-hall':22.5, 'zone-study-rooms':23.1, 'zone-reference':21.8, 'zone-computer-lab':24.8, 'zone-kids-corner':22.0 },
  co2:  { 'zone-reading-hall':520, 'zone-study-rooms':720, 'zone-reference':450, 'zone-computer-lab':780, 'zone-kids-corner':510 },
  spikes: {},
};

const BASE = { 'zone-reading-hall':33,'zone-study-rooms':50,'zone-reference':27,'zone-computer-lab':55,'zone-kids-corner':62 };
const CAPS = { 'zone-reading-hall':120,'zone-study-rooms':40,'zone-reference':60,'zone-computer-lab':80,'zone-kids-corner':30 };
const AC   = {};  // alert cooldowns

function gauss(m, s) {
  const u1 = Math.random(), u2 = Math.random();
  return m + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * s;
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function comfortLabel(type, v) {
  if (type==='noise')       return v<40?'Excellent':v<55?'Good':v<65?'Fair':'Poor';
  if (type==='temperature') return (v>=19&&v<=26)?'Excellent':(v>=17&&v<=28)?'Good':'Fair';
  if (type==='humidity')    return (v>=35&&v<=65)?'Excellent':(v>=25&&v<=75)?'Good':'Fair';
  if (type==='co2')         return v<600?'Excellent':v<800?'Good':v<1000?'Fair':'Poor';
  return null;
}

function simValue(s) {
  const z = s.zone;
  const occ = SIM_STATE.occ[z] || 20;
  switch(s.type) {
    case 'noise': {
      if (!SIM_STATE.spikes[z] && Math.random() < 0.06) SIM_STATE.spikes[z] = Math.floor(Math.random()*4)+2;
      const spike = SIM_STATE.spikes[z] ? 15 + Math.random()*12 : 0;
      if (SIM_STATE.spikes[z]) SIM_STATE.spikes[z]--;
      return clamp(gauss(BASE[z] + (occ/50)*8 + spike, 3.5), 20, 100);
    }
    case 'temperature': {
      SIM_STATE.temp[z] = clamp(SIM_STATE.temp[z] + (Math.random()-.48)*.25, 15, 32);
      return gauss(SIM_STATE.temp[z], 0.3);
    }
    case 'humidity':  return clamp(gauss(z==='zone-reference'?48:52, 4), 20, 90);
    case 'co2': {
      SIM_STATE.co2[z] = clamp(SIM_STATE.co2[z] + occ*.8 - 5, 380, 1800);
      return gauss(SIM_STATE.co2[z], 15);
    }
    case 'light':     return clamp(gauss(350,40), 80,1000);
    case 'occupancy': {
      SIM_STATE.occ[z] = clamp(SIM_STATE.occ[z] + Math.floor((Math.random()-.5)*3), 0, CAPS[z]||50);
      return SIM_STATE.occ[z];
    }
    default: return 0;
  }
}

function simAlert(zone_id, sensor_id, severity, message, type, value) {
  const key = `${zone_id}:${type}:${severity}`;
  if (AC[key] && Date.now() - AC[key] < 60000) return;
  AC[key] = Date.now();
  S.alerts.unshift({ id: Math.random().toString(36).slice(2), zone_id, sensor_id, type, severity, message, value, created_at: new Date().toISOString(), resolved: false });
  if (S.alerts.length > 40) S.alerts.pop();
  renderAlerts();
  updateKPIs();
}

function simTick() {
  const sensor = SIM_SENSORS[Math.floor(Math.random() * SIM_SENSORS.length)];
  const raw    = simValue(sensor);
  const value  = parseFloat(raw.toFixed(2));
  const unit   = UNITS[sensor.type] || '';
  const comfort = comfortLabel(sensor.type, value);

  const reading = { sensor_id:sensor.id, zone_id:sensor.zone, type:sensor.type, value, unit, comfort, timestamp:new Date().toISOString() };

  if (!S.readings[sensor.zone]) S.readings[sensor.zone] = {};
  S.readings[sensor.zone][sensor.type] = reading;
  if (sensor.type === 'noise') S.zoneNoise[sensor.zone] = value;

  if (S.sensors[sensor.id]) {
    S.sensors[sensor.id].lastValue = value;
    S.sensors[sensor.id].unit      = unit;
    S.sensors[sensor.id].comfort   = comfort;
    S.sensors[sensor.id].last_seen = reading.timestamp;
    S.sensors[sensor.id].status    = 'online';
  }

  // Simulate alerts
  const cfg = ZC[sensor.zone];
  if (sensor.type === 'noise' && cfg) {
    if (value >= cfg.nC && Math.random() < 0.2)
      simAlert(sensor.zone, sensor.id, 'critical', `Critical noise: ${value.toFixed(1)} dB(A) — immediate action required`, 'noise', value);
    else if (value >= cfg.nW && Math.random() < 0.1)
      simAlert(sensor.zone, sensor.id, 'warning', `Noise elevated: ${value.toFixed(1)} dB(A)`, 'noise', value);
  }
  if (sensor.type === 'co2' && value > 1000 && Math.random() < 0.15)
    simAlert(sensor.zone, sensor.id, 'critical', `CO₂ critical: ${value.toFixed(0)} ppm — ventilate immediately`, 'co2', value);
  if (sensor.type === 'temperature' && (value > 29 || value < 16) && Math.random() < 0.1)
    simAlert(sensor.zone, sensor.id, 'warning', `Temperature ${value>29?'high':'low'}: ${value.toFixed(1)}°C`, 'temperature', value);

  // MQTT log
  logMQTT(`library/${sensor.zone}/sensors/${sensor.id}/data`, `${value} ${unit}`);

  pushChartHistory();
  updateZoneCard(sensor.zone);
  updateFloorPlan();
  updateBarChart();
  updateKPIs();
  renderSensorTable();
}

function startClientSim() {
  // Populate sensors into state
  SIM_SENSORS.forEach(s => {
    S.sensors[s.id] = { ...s, status:'online', lastValue:null, unit:'', comfort:null, last_seen:null };
  });

  // Populate zones
  Object.entries(ZC).forEach(([id, cfg]) => {
    S.zones[id] = { id, name:cfg.name, floor:cfg.floor, capacity:100 };
  });

  // Initial readings for all sensors
  SIM_SENSORS.forEach(s => {
    const raw = simValue(s);
    const value = parseFloat(raw.toFixed(2));
    if (!S.readings[s.zone]) S.readings[s.zone] = {};
    S.readings[s.zone][s.type] = {
      sensor_id:s.id, zone_id:s.zone, type:s.type,
      value, unit:UNITS[s.type]||'', comfort:comfortLabel(s.type,value),
      timestamp: new Date().toISOString(),
    };
    if (s.type === 'noise') S.zoneNoise[s.zone] = value;
    S.sensors[s.id].lastValue = value;
    S.sensors[s.id].unit      = UNITS[s.type]||'';
    S.sensors[s.id].comfort   = comfortLabel(s.type,value);
    S.sensors[s.id].last_seen = new Date().toISOString();
  });

  buildZoneCards();
  renderSensorTable();
  renderAlerts();
  updateKPIs();
  updateFloorPlan();
  updateBarChart();

  setInterval(simTick, 1500);
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();
  startClock();

  // Try WebSocket — fall back to client simulation after 2.5s
  let resolved = false;
  const tryWS  = new WebSocket(`ws://${location.hostname}:${location.port||3000}`);

  tryWS.onopen = () => {
    resolved = true;
    S.ws = tryWS;
    setConn(true, 'Live ● WebSocket');
    tryWS.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'snapshot')    handleSnapshot(msg.payload);
        if (msg.type === 'sensor_data') handleReading(msg.payload);
        if (msg.type === 'new_alert')   handleAlert(msg.payload);
      } catch(e) {}
    };
    tryWS.onclose = () => { setConn(false,'Reconnecting...'); setTimeout(connectWS,3000); };
  };

  tryWS.onerror = () => {
    if (!resolved) { resolved = true; setConn(true,'Demo Mode ● Simulated'); startClientSim(); }
  };

  setTimeout(() => {
    if (!resolved) { resolved = true; tryWS.close(); setConn(true,'Demo Mode ● Simulated'); startClientSim(); }
  }, 2500);
});