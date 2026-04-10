const BACKEND_HTTP = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : `${window.location.protocol}//${window.location.hostname}:3000`;

const BACKEND_WS = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'ws://localhost:3000'
  : `ws://${window.location.hostname}:3000`;

const state = {
  zones: [],
  sensors: [],
  readings: {},
  alerts: [],
  protocolStats: {
    HTTP: { count: 0, avgLatencyMs: 0 },
    MQTT_SIM: { count: 0, avgLatencyMs: 0 },
    WS: { count: 0, avgLatencyMs: 0 }
  },
  telemetry: []
};

function avg(list) {
  if (!list.length) return null;
  return Number((list.reduce((a, b) => a + b, 0) / list.length).toFixed(1));
}

function riskForNoise(noise, zoneId) {
  const limits = {
    'zone-reading-hall': { w: 40, c: 55 },
    'zone-study-rooms': { w: 55, c: 70 },
    'zone-reference': { w: 38, c: 50 },
    'zone-computer-lab': { w: 60, c: 75 },
    'zone-kids-corner': { w: 70, c: 85 }
  };
  const t = limits[zoneId];
  if (!t || noise == null) return 'Normal';
  if (noise >= t.c) return 'Critical';
  if (noise >= t.w) return 'Warning';
  return 'Normal';
}

function setConn(online, label) {
  const dot = document.getElementById('connDot');
  const txt = document.getElementById('connLabel');
  dot.classList.toggle('off', !online);
  txt.textContent = label;
}

function updateKPIs() {
  const noise = [];
  const temp = [];
  const co2 = [];

  Object.values(state.readings).forEach((zoneReading) => {
    if (zoneReading.noise) noise.push(zoneReading.noise.value);
    if (zoneReading.temperature) temp.push(zoneReading.temperature.value);
    if (zoneReading.co2) co2.push(zoneReading.co2.value);
  });

  document.getElementById('kNoise').textContent = avg(noise) != null ? `${avg(noise)} dB(A)` : '--';
  document.getElementById('kTemp').textContent = avg(temp) != null ? `${avg(temp)} C` : '--';
  document.getElementById('kCO2').textContent = avg(co2) != null ? `${avg(co2)} ppm` : '--';
  document.getElementById('kAlerts').textContent = String(state.alerts.filter((a) => !a.resolved).length);
}

function updateZones() {
  const wrap = document.getElementById('zones');
  const zoneSelect = document.getElementById('zoneSelect');
  const prevZoneId = zoneSelect.value;

  wrap.innerHTML = state.zones.map((zone) => {
    const z = state.readings[zone.id] || {};
    const noise = z.noise ? `${z.noise.value.toFixed(1)} dB(A)` : '--';
    const temp = z.temperature ? `${z.temperature.value.toFixed(1)} C` : '--';
    const co2 = z.co2 ? `${z.co2.value.toFixed(0)} ppm` : '--';
    const risk = riskForNoise(z.noise?.value, zone.id);
    const cls = risk.toLowerCase();
    return `
      <article class="zone">
        <div>
          <strong>${zone.name}</strong>
          <div class="meta">Floor ${zone.floor} | Capacity ${zone.capacity}</div>
          <div class="meta">Noise ${noise} | Temp ${temp} | CO2 ${co2}</div>
        </div>
        <div class="risk ${cls}">${risk}</div>
      </article>
    `;
  }).join('');

  zoneSelect.innerHTML = state.zones.map((z) => `<option value="${z.id}">${z.name}</option>`).join('');

  if (prevZoneId && state.zones.some((z) => z.id === prevZoneId)) {
    zoneSelect.value = prevZoneId;
  }
}

function updateProtocolStats() {
  const tbody = document.querySelector('#protocolTable tbody');
  tbody.innerHTML = Object.entries(state.protocolStats).map(([protocol, stats]) => `
    <tr>
      <td>${protocol}</td>
      <td>${stats.count}</td>
      <td>${stats.avgLatencyMs} ms</td>
    </tr>
  `).join('');
}

function updateAlerts() {
  const wrap = document.getElementById('alerts');
  const active = state.alerts.filter((a) => !a.resolved).slice(0, 20);
  if (!active.length) {
    wrap.innerHTML = '<div class="line"><span class="time">Now</span><div>No active alerts</div></div>';
    return;
  }
  wrap.innerHTML = active.map((a) => `
    <div class="line ${a.severity}">
      <div class="time">${new Date(a.created_at).toLocaleTimeString('en-IN')}</div>
      <div>${a.message}</div>
      <div class="meta">${a.zone_id}</div>
    </div>
  `).join('');
}

function updateTelemetry() {
  const wrap = document.getElementById('telemetry');
  if (!state.telemetry.length) {
    wrap.innerHTML = '<div class="line">Waiting for telemetry...</div>';
    return;
  }
  wrap.innerHTML = state.telemetry.slice(0, 30).map((entry) => `
    <div class="line">
      <div class="time">${new Date(entry.timestamp).toLocaleTimeString('en-IN')}</div>
      <div>${entry.protocol} | ${entry.topic}</div>
      <div class="meta">${entry.reading.zone_id} | ${entry.reading.type}: ${entry.reading.value} ${entry.reading.unit || ''} | ${entry.latencyMs} ms</div>
    </div>
  `).join('');
}

function renderAll() {
  updateKPIs();
  updateZones();
  updateProtocolStats();
  updateAlerts();
  updateTelemetry();
}

function handleSnapshot(payload) {
  state.zones = payload.zones || [];
  state.sensors = payload.sensors || [];
  state.readings = payload.readings || {};
  state.alerts = payload.activeAlerts || [];
  if (payload.protocolStats) {
    state.protocolStats = payload.protocolStats;
  }
  renderAll();
}

function handleReading(reading) {
  if (!state.readings[reading.zone_id]) state.readings[reading.zone_id] = {};
  state.readings[reading.zone_id][reading.type] = reading;
  renderAll();
}

function handleAlert(alert) {
  state.alerts.unshift(alert);
  state.alerts = state.alerts.slice(0, 40);
  renderAll();
}

async function refreshProtocol() {
  try {
    const [statsRes, telemetryRes] = await Promise.all([
      fetch(`${BACKEND_HTTP}/api/protocol-stats`),
      fetch(`${BACKEND_HTTP}/api/telemetry-log`)
    ]);
    state.protocolStats = await statsRes.json();
    state.telemetry = await telemetryRes.json();
    updateProtocolStats();
    updateTelemetry();
  } catch (_error) {
    // backend may still be booting
  }
}

function connectWS() {
  setConn(false, 'Connecting');
  const ws = new WebSocket(BACKEND_WS);
  ws.onopen = () => setConn(true, 'Live WebSocket');
  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'snapshot') handleSnapshot(msg.payload);
      if (msg.type === 'sensor_data') handleReading(msg.payload);
      if (msg.type === 'new_alert') handleAlert(msg.payload);
    } catch (_error) {
      // ignore invalid packet
    }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    setConn(false, 'Reconnecting');
    setTimeout(connectWS, 2500);
  };
}

async function postCommand(command) {
  const zoneId = document.getElementById('zoneSelect').value;
  if (!zoneId) return;

  await fetch(`${BACKEND_HTTP}/api/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      zoneId,
      command,
      topic: `library/commands/${zoneId}`
    })
  });
}

function bindControls() {
  document.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const command = btn.dataset.cmd;
      try {
        await postCommand(command);
      } catch (_error) {
        // ignore
      }
    });
  });
}

async function bootstrap() {
  bindControls();
  connectWS();
  await refreshProtocol();
  setInterval(refreshProtocol, 3000);
}

bootstrap();
