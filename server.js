// ============================================================
// Smart Library Noise & Comfort Monitor
// Subject: IoT Architecture and Protocol
// FILE: server.js  — Main Backend Server
// ============================================================

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const cors    = require('cors');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory database (no SQLite needed for demo) ──────────
const DB = {
  zones: [
    { id: 'zone-reading-hall',  name: 'Main Reading Hall',    floor: '1F', capacity: 120 },
    { id: 'zone-study-rooms',   name: 'Group Study Rooms',    floor: '2F', capacity: 40  },
    { id: 'zone-reference',     name: 'Reference Section',    floor: '1F', capacity: 60  },
    { id: 'zone-computer-lab',  name: 'Digital Resource Lab', floor: '3F', capacity: 80  },
    { id: 'zone-kids-corner',   name: "Children's Corner",    floor: '1F', capacity: 30  },
  ],
  sensors: [
    { id: 'sns-rh-noise-1',  zone_id: 'zone-reading-hall',  type: 'noise',       name: 'Noise Sensor A',    status: 'online' },
    { id: 'sns-rh-noise-2',  zone_id: 'zone-reading-hall',  type: 'noise',       name: 'Noise Sensor B',    status: 'online' },
    { id: 'sns-rh-temp-1',   zone_id: 'zone-reading-hall',  type: 'temperature', name: 'Thermostat',        status: 'online' },
    { id: 'sns-rh-hum-1',    zone_id: 'zone-reading-hall',  type: 'humidity',    name: 'Humidity Monitor',  status: 'online' },
    { id: 'sns-rh-co2-1',    zone_id: 'zone-reading-hall',  type: 'co2',         name: 'Air Quality',       status: 'online' },
    { id: 'sns-rh-occ-1',    zone_id: 'zone-reading-hall',  type: 'occupancy',   name: 'Occupancy Counter', status: 'online' },
    { id: 'sns-sr-noise-1',  zone_id: 'zone-study-rooms',   type: 'noise',       name: 'Room Noise',        status: 'online' },
    { id: 'sns-sr-temp-1',   zone_id: 'zone-study-rooms',   type: 'temperature', name: 'Room Thermostat',   status: 'online' },
    { id: 'sns-sr-co2-1',    zone_id: 'zone-study-rooms',   type: 'co2',         name: 'CO2 Monitor',       status: 'online' },
    { id: 'sns-sr-occ-1',    zone_id: 'zone-study-rooms',   type: 'occupancy',   name: 'Seat Counter',      status: 'online' },
    { id: 'sns-ref-noise-1', zone_id: 'zone-reference',     type: 'noise',       name: 'Archive Noise',     status: 'online' },
    { id: 'sns-ref-temp-1',  zone_id: 'zone-reference',     type: 'temperature', name: 'Climate Control',   status: 'online' },
    { id: 'sns-ref-hum-1',   zone_id: 'zone-reference',     type: 'humidity',    name: 'Book Humidity',     status: 'online' },
    { id: 'sns-ref-light-1', zone_id: 'zone-reference',     type: 'light',       name: 'Lux Meter',         status: 'online' },
    { id: 'sns-cl-noise-1',  zone_id: 'zone-computer-lab',  type: 'noise',       name: 'Lab Noise',         status: 'online' },
    { id: 'sns-cl-temp-1',   zone_id: 'zone-computer-lab',  type: 'temperature', name: 'Server Temp',       status: 'online' },
    { id: 'sns-cl-co2-1',    zone_id: 'zone-computer-lab',  type: 'co2',         name: 'Ventilation',       status: 'online' },
    { id: 'sns-cl-occ-1',    zone_id: 'zone-computer-lab',  type: 'occupancy',   name: 'Seat Counter',      status: 'online' },
    { id: 'sns-kc-noise-1',  zone_id: 'zone-kids-corner',   type: 'noise',       name: 'Kids Noise',        status: 'online' },
    { id: 'sns-kc-temp-1',   zone_id: 'zone-kids-corner',   type: 'temperature', name: 'Comfort Sensor',    status: 'online' },
  ],
  readings:  {},   // zoneId -> { type -> latest reading }
  alerts:    [],
  commands:  [],
};

// ── Thresholds ───────────────────────────────────────────────
const THRESHOLDS = {
  noise: {
    'zone-reading-hall':  { warning: 40, critical: 55 },
    'zone-study-rooms':   { warning: 55, critical: 70 },
    'zone-reference':     { warning: 38, critical: 50 },
    'zone-computer-lab':  { warning: 60, critical: 75 },
    'zone-kids-corner':   { warning: 70, critical: 85 },
  },
};

// ── Alert Cooldown ───────────────────────────────────────────
const alertCooldown = {};

function pushAlert(zoneId, sensorId, severity, message, type, value) {
  const key = `${zoneId}:${type}:${severity}`;
  if (alertCooldown[key] && Date.now() - alertCooldown[key] < 60000) return;
  alertCooldown[key] = Date.now();
  const alert = {
    id: uuidv4(),
    zone_id: zoneId,
    sensor_id: sensorId,
    type,
    severity,
    message,
    value,
    created_at: new Date().toISOString(),
    resolved: false,
  };
  DB.alerts.unshift(alert);
  if (DB.alerts.length > 100) DB.alerts.pop();
  broadcastToClients({ type: 'new_alert', payload: alert });
}

// ── WebSocket Broadcast ──────────────────────────────────────
function broadcastToClients(message) {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}

// ── Sensor Data Ingestion ────────────────────────────────────
function ingestReading(reading) {
  const { zone_id, type, value, sensor_id } = reading;

  if (!DB.readings[zone_id]) DB.readings[zone_id] = {};
  DB.readings[zone_id][type] = reading;

  // Update sensor last seen
  const sensor = DB.sensors.find(s => s.id === sensor_id);
  if (sensor) {
    sensor.status    = 'online';
    sensor.lastValue = value;
    sensor.unit      = reading.unit;
    sensor.comfort   = reading.comfort;
    sensor.last_seen = reading.timestamp;
  }

  // Alert check
  if (type === 'noise') {
    const t = THRESHOLDS.noise[zone_id];
    if (t) {
      if (value >= t.critical)
        pushAlert(zone_id, sensor_id, 'critical', `Critical noise: ${value.toFixed(1)} dB(A) — immediate action required`, 'noise', value);
      else if (value >= t.warning)
        pushAlert(zone_id, sensor_id, 'warning', `Noise elevated: ${value.toFixed(1)} dB(A) — please maintain quiet`, 'noise', value);
    }
  }
  if (type === 'temperature') {
    if (value >= 29)
      pushAlert(zone_id, sensor_id, 'warning', `Temperature high: ${value.toFixed(1)}°C`, 'temperature', value);
    else if (value <= 16)
      pushAlert(zone_id, sensor_id, 'warning', `Temperature low: ${value.toFixed(1)}°C`, 'temperature', value);
  }
  if (type === 'co2' && value >= 1000)
    pushAlert(zone_id, sensor_id, 'critical', `CO₂ critical: ${value.toFixed(0)} ppm — ventilate immediately`, 'co2', value);

  broadcastToClients({ type: 'sensor_data', payload: reading });
}

// ── REST API ─────────────────────────────────────────────────
app.get('/api/snapshot', (req, res) => {
  res.json({
    zones:          DB.zones,
    sensors:        DB.sensors,
    readings:       DB.readings,
    activeAlerts:   DB.alerts.filter(a => !a.resolved),
  });
});

app.get('/api/zones', (req, res) => res.json(DB.zones));

app.get('/api/alerts', (req, res) => {
  res.json(DB.alerts.slice(0, 50));
});

app.patch('/api/alerts/:id/resolve', (req, res) => {
  const alert = DB.alerts.find(a => a.id === req.params.id);
  if (alert) alert.resolved = true;
  res.json({ success: true });
});

app.post('/api/sensor-data', (req, res) => {
  ingestReading(req.body);
  res.json({ success: true });
});

app.post('/api/commands', (req, res) => {
  const cmd = { id: uuidv4(), ...req.body, created_at: new Date().toISOString() };
  DB.commands.unshift(cmd);
  broadcastToClients({ type: 'command', payload: cmd });
  res.json({ success: true, data: cmd });
});

app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    wsClients: wss.clients.size,
    alerts:    DB.alerts.filter(a => !a.resolved).length,
    uptime:    process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── WebSocket Connection ─────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  // Send full snapshot on connect
  ws.send(JSON.stringify({
    type: 'snapshot',
    payload: {
      zones:        DB.zones,
      sensors:      DB.sensors,
      readings:     DB.readings,
      activeAlerts: DB.alerts.filter(a => !a.resolved),
    },
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'sensor_data') ingestReading(data.payload);
    } catch (e) {}
  });

  ws.on('close', () => console.log('[WS] Client disconnected'));
});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n📚 Smart Library Monitor — Backend Running');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Dashboard : http://localhost:${PORT}`);
  console.log(`  REST API  : http://localhost:${PORT}/api`);
  console.log(`  WebSocket : ws://localhost:${PORT}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});