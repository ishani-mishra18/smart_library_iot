// ============================================================
// Smart Library Monitor — IoT Sensor Simulator
// FILE: simulator.js
// Simulates 20 sensors sending data via HTTP POST to server
// (No MQTT broker needed — works out of the box!)
// ============================================================

const http = require('http');

const SERVER_URL = 'http://localhost:3000';

// ── Sensor Definitions ───────────────────────────────────────
const SENSORS = [
  { id: 'sns-rh-noise-1',  zone: 'zone-reading-hall',  type: 'noise',       interval: 3000 },
  { id: 'sns-rh-noise-2',  zone: 'zone-reading-hall',  type: 'noise',       interval: 5000 },
  { id: 'sns-rh-temp-1',   zone: 'zone-reading-hall',  type: 'temperature', interval: 8000 },
  { id: 'sns-rh-hum-1',    zone: 'zone-reading-hall',  type: 'humidity',    interval: 10000 },
  { id: 'sns-rh-co2-1',    zone: 'zone-reading-hall',  type: 'co2',         interval: 6000 },
  { id: 'sns-rh-occ-1',    zone: 'zone-reading-hall',  type: 'occupancy',   interval: 7000 },
  { id: 'sns-sr-noise-1',  zone: 'zone-study-rooms',   type: 'noise',       interval: 3500 },
  { id: 'sns-sr-temp-1',   zone: 'zone-study-rooms',   type: 'temperature', interval: 9000 },
  { id: 'sns-sr-co2-1',    zone: 'zone-study-rooms',   type: 'co2',         interval: 6000 },
  { id: 'sns-sr-occ-1',    zone: 'zone-study-rooms',   type: 'occupancy',   interval: 7000 },
  { id: 'sns-ref-noise-1', zone: 'zone-reference',     type: 'noise',       interval: 4000 },
  { id: 'sns-ref-temp-1',  zone: 'zone-reference',     type: 'temperature', interval: 8000 },
  { id: 'sns-ref-hum-1',   zone: 'zone-reference',     type: 'humidity',    interval: 10000 },
  { id: 'sns-ref-light-1', zone: 'zone-reference',     type: 'light',       interval: 8000 },
  { id: 'sns-cl-noise-1',  zone: 'zone-computer-lab',  type: 'noise',       interval: 3000 },
  { id: 'sns-cl-temp-1',   zone: 'zone-computer-lab',  type: 'temperature', interval: 8000 },
  { id: 'sns-cl-co2-1',    zone: 'zone-computer-lab',  type: 'co2',         interval: 6000 },
  { id: 'sns-cl-occ-1',    zone: 'zone-computer-lab',  type: 'occupancy',   interval: 7000 },
  { id: 'sns-kc-noise-1',  zone: 'zone-kids-corner',   type: 'noise',       interval: 2500 },
  { id: 'sns-kc-temp-1',   zone: 'zone-kids-corner',   type: 'temperature', interval: 8000 },
];

// ── Simulation State ─────────────────────────────────────────
const SIM = {
  occ:  { 'zone-reading-hall': 45, 'zone-study-rooms': 18, 'zone-reference': 22, 'zone-computer-lab': 38, 'zone-kids-corner': 12 },
  temp: { 'zone-reading-hall': 22.5, 'zone-study-rooms': 23.1, 'zone-reference': 21.8, 'zone-computer-lab': 24.8, 'zone-kids-corner': 22.0 },
  co2:  { 'zone-reading-hall': 520, 'zone-study-rooms': 720, 'zone-reference': 450, 'zone-computer-lab': 780, 'zone-kids-corner': 510 },
  spikes: {},
};

const BASE_NOISE = {
  'zone-reading-hall': 33, 'zone-study-rooms': 50,
  'zone-reference': 27, 'zone-computer-lab': 55, 'zone-kids-corner': 62,
};

const CAPS = {
  'zone-reading-hall': 120, 'zone-study-rooms': 40,
  'zone-reference': 60, 'zone-computer-lab': 80, 'zone-kids-corner': 30,
};

const UNITS     = { noise:'dB(A)', temperature:'°C', humidity:'%', co2:'ppm', light:'lux', occupancy:'persons' };

function gauss(mean, std) {
  const u1 = Math.random(), u2 = Math.random();
  return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * std;
}

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

function comfortLabel(type, v) {
  if (type === 'noise')       return v < 40 ? 'Excellent' : v < 55 ? 'Good' : v < 65 ? 'Fair' : 'Poor';
  if (type === 'temperature') return (v >= 19 && v <= 26) ? 'Excellent' : (v >= 17 && v <= 28) ? 'Good' : 'Fair';
  if (type === 'humidity')    return (v >= 35 && v <= 65) ? 'Excellent' : (v >= 25 && v <= 75) ? 'Good' : 'Fair';
  if (type === 'co2')         return v < 600 ? 'Excellent' : v < 800 ? 'Good' : v < 1000 ? 'Fair' : 'Poor';
  return null;
}

function generateValue(sensor) {
  const z = sensor.zone;
  const occ = SIM.occ[z] || 20;

  switch (sensor.type) {
    case 'noise': {
      if (!SIM.spikes[z] && Math.random() < 0.06) {
        SIM.spikes[z] = Math.floor(Math.random() * 4) + 2;
        console.log(`  🔔 Noise spike triggered in ${z}`);
      }
      const spike = SIM.spikes[z] ? 15 + Math.random() * 12 : 0;
      if (SIM.spikes[z]) SIM.spikes[z]--;
      const base = BASE_NOISE[z] + (occ / 50) * 8 + spike;
      return clamp(gauss(base, 3.5), 20, 100);
    }
    case 'temperature': {
      SIM.temp[z] = clamp(SIM.temp[z] + (Math.random() - 0.48) * 0.25, 15, 32);
      return gauss(SIM.temp[z], 0.3);
    }
    case 'humidity': {
      const base = z === 'zone-reference' ? 48 : 52;
      return clamp(gauss(base, 4), 20, 90);
    }
    case 'co2': {
      SIM.co2[z] = clamp(SIM.co2[z] + occ * 0.8 - 5, 380, 1800);
      return gauss(SIM.co2[z], 15);
    }
    case 'light':
      return clamp(gauss(350, 40), 80, 1000);
    case 'occupancy': {
      SIM.occ[z] = clamp(SIM.occ[z] + Math.floor((Math.random() - 0.5) * 3), 0, CAPS[z] || 50);
      return SIM.occ[z];
    }
    default: return 0;
  }
}

function postReading(sensor) {
  const raw   = generateValue(sensor);
  const value = parseFloat(raw.toFixed(2));

  const payload = JSON.stringify({
    sensor_id: sensor.id,
    zone_id:   sensor.zone,
    type:      sensor.type,
    value,
    unit:      UNITS[sensor.type] || '',
    comfort:   comfortLabel(sensor.type, value),
    timestamp: new Date().toISOString(),
    metadata: {
      firmware: '2.1.4',
      battery:  clamp(gauss(85, 5), 0, 100).toFixed(1),
      rssi:     Math.floor(gauss(-65, 8)),
    },
  });

  const options = {
    hostname: 'localhost',
    port:     3000,
    path:     '/api/sensor-data',
    method:   'POST',
    headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  };

  const req = http.request(options, (res) => {
    console.log(`  [${new Date().toLocaleTimeString()}] ${sensor.zone.replace('zone-','').padEnd(15)} | ${sensor.type.padEnd(12)} | ${value} ${UNITS[sensor.type]}`);
  });

  req.on('error', (e) => console.error(`  [SIM] Error posting ${sensor.id}: ${e.message}`));
  req.write(payload);
  req.end();
}

// ── Start All Sensor Loops ───────────────────────────────────
console.log('\n🤖 Smart Library — IoT Sensor Simulator');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Simulating ${SENSORS.length} sensors → ${SERVER_URL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

SENSORS.forEach(sensor => {
  const jitter = Math.floor(Math.random() * 1500);
  setTimeout(() => {
    postReading(sensor);
    setInterval(() => postReading(sensor), sensor.interval);
  }, jitter);
});