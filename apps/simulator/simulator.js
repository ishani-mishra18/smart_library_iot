const http = require('http');

const BACKEND_HOST = process.env.BACKEND_HOST || 'localhost';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || 3000);
const PUBLISH_MODE = process.env.PUBLISH_MODE || 'mixed';
const SCENARIO = process.env.SCENARIO || 'normal';

const SENSORS = [
  { id: 'sns-rh-noise-1', zone: 'zone-reading-hall', type: 'noise', interval: 3000 },
  { id: 'sns-rh-noise-2', zone: 'zone-reading-hall', type: 'noise', interval: 5000 },
  { id: 'sns-rh-temp-1', zone: 'zone-reading-hall', type: 'temperature', interval: 8000 },
  { id: 'sns-rh-hum-1', zone: 'zone-reading-hall', type: 'humidity', interval: 10000 },
  { id: 'sns-rh-co2-1', zone: 'zone-reading-hall', type: 'co2', interval: 6000 },
  { id: 'sns-rh-occ-1', zone: 'zone-reading-hall', type: 'occupancy', interval: 7000 },
  { id: 'sns-sr-noise-1', zone: 'zone-study-rooms', type: 'noise', interval: 3500 },
  { id: 'sns-sr-temp-1', zone: 'zone-study-rooms', type: 'temperature', interval: 9000 },
  { id: 'sns-sr-co2-1', zone: 'zone-study-rooms', type: 'co2', interval: 6000 },
  { id: 'sns-sr-occ-1', zone: 'zone-study-rooms', type: 'occupancy', interval: 7000 },
  { id: 'sns-ref-noise-1', zone: 'zone-reference', type: 'noise', interval: 4000 },
  { id: 'sns-ref-temp-1', zone: 'zone-reference', type: 'temperature', interval: 8000 },
  { id: 'sns-ref-hum-1', zone: 'zone-reference', type: 'humidity', interval: 10000 },
  { id: 'sns-ref-light-1', zone: 'zone-reference', type: 'light', interval: 8000 },
  { id: 'sns-cl-noise-1', zone: 'zone-computer-lab', type: 'noise', interval: 3000 },
  { id: 'sns-cl-temp-1', zone: 'zone-computer-lab', type: 'temperature', interval: 8000 },
  { id: 'sns-cl-co2-1', zone: 'zone-computer-lab', type: 'co2', interval: 6000 },
  { id: 'sns-cl-occ-1', zone: 'zone-computer-lab', type: 'occupancy', interval: 7000 },
  { id: 'sns-kc-noise-1', zone: 'zone-kids-corner', type: 'noise', interval: 2500 },
  { id: 'sns-kc-temp-1', zone: 'zone-kids-corner', type: 'temperature', interval: 8000 }
];

const SIM = {
  occ: {
    'zone-reading-hall': 45,
    'zone-study-rooms': 18,
    'zone-reference': 22,
    'zone-computer-lab': 38,
    'zone-kids-corner': 12
  },
  temp: {
    'zone-reading-hall': 22.5,
    'zone-study-rooms': 23.1,
    'zone-reference': 21.8,
    'zone-computer-lab': 24.8,
    'zone-kids-corner': 22.0
  },
  co2: {
    'zone-reading-hall': 520,
    'zone-study-rooms': 720,
    'zone-reference': 450,
    'zone-computer-lab': 780,
    'zone-kids-corner': 510
  },
  spikes: {}
};

const BASE_NOISE = {
  'zone-reading-hall': 33,
  'zone-study-rooms': 50,
  'zone-reference': 27,
  'zone-computer-lab': 55,
  'zone-kids-corner': 62
};

const CAPS = {
  'zone-reading-hall': 120,
  'zone-study-rooms': 40,
  'zone-reference': 60,
  'zone-computer-lab': 80,
  'zone-kids-corner': 30
};

const UNITS = {
  noise: 'dB(A)',
  temperature: 'C',
  humidity: '%',
  co2: 'ppm',
  light: 'lux',
  occupancy: 'persons'
};

function gauss(mean, std) {
  const u1 = Math.random();
  const u2 = Math.random();
  return mean + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * std;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function comfortLabel(type, value) {
  if (type === 'noise') return value < 40 ? 'Excellent' : value < 55 ? 'Good' : value < 65 ? 'Fair' : 'Poor';
  if (type === 'temperature') return value >= 19 && value <= 26 ? 'Excellent' : value >= 17 && value <= 28 ? 'Good' : 'Fair';
  if (type === 'humidity') return value >= 35 && value <= 65 ? 'Excellent' : value >= 25 && value <= 75 ? 'Good' : 'Fair';
  if (type === 'co2') return value < 600 ? 'Excellent' : value < 800 ? 'Good' : value < 1000 ? 'Fair' : 'Poor';
  return null;
}

function scenarioNoiseOffset(zone) {
  if (SCENARIO === 'exam-time') {
    return zone === 'zone-reading-hall' ? -4 : -2;
  }
  if (SCENARIO === 'kids-hour' && zone === 'zone-kids-corner') {
    return 8;
  }
  return 0;
}

function scenarioTempOffset(zone) {
  if (SCENARIO === 'hvac-failure' && zone === 'zone-computer-lab') {
    return 4;
  }
  return 0;
}

function generateValue(sensor) {
  const zone = sensor.zone;
  const occ = SIM.occ[zone] || 20;

  switch (sensor.type) {
    case 'noise': {
      if (!SIM.spikes[zone] && Math.random() < 0.06) {
        SIM.spikes[zone] = Math.floor(Math.random() * 4) + 2;
      }
      const spike = SIM.spikes[zone] ? 15 + Math.random() * 12 : 0;
      if (SIM.spikes[zone]) {
        SIM.spikes[zone] -= 1;
      }
      const base = BASE_NOISE[zone] + (occ / 50) * 8 + scenarioNoiseOffset(zone) + spike;
      return clamp(gauss(base, 3.5), 20, 100);
    }
    case 'temperature': {
      SIM.temp[zone] = clamp(SIM.temp[zone] + (Math.random() - 0.48) * 0.25 + (scenarioTempOffset(zone) * 0.05), 15, 35);
      return gauss(SIM.temp[zone], 0.3);
    }
    case 'humidity': {
      const base = zone === 'zone-reference' ? 48 : 52;
      return clamp(gauss(base, 4), 20, 90);
    }
    case 'co2': {
      const extra = SCENARIO === 'hvac-failure' && zone === 'zone-computer-lab' ? 15 : 0;
      SIM.co2[zone] = clamp(SIM.co2[zone] + occ * 0.8 - 5 + extra, 380, 1800);
      return gauss(SIM.co2[zone], 15);
    }
    case 'light':
      return clamp(gauss(350, 40), 80, 1000);
    case 'occupancy': {
      SIM.occ[zone] = clamp(SIM.occ[zone] + Math.floor((Math.random() - 0.5) * 3), 0, CAPS[zone] || 50);
      return SIM.occ[zone];
    }
    default:
      return 0;
  }
}

function request(path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: BACKEND_HOST,
        port: BACKEND_PORT,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', resolve);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function publishReading(sensor) {
  const value = Number(generateValue(sensor).toFixed(2));
  const reading = {
    sensor_id: sensor.id,
    zone_id: sensor.zone,
    type: sensor.type,
    value,
    unit: UNITS[sensor.type] || '',
    comfort: comfortLabel(sensor.type, value),
    timestamp: new Date().toISOString(),
    metadata: {
      scenario: SCENARIO,
      firmware: '2.2.0-sim',
      battery: Number(clamp(gauss(85, 5), 0, 100).toFixed(1)),
      rssi: Math.floor(gauss(-65, 8))
    }
  };

  const protocol = PUBLISH_MODE === 'http'
    ? 'http'
    : PUBLISH_MODE === 'mqtt'
      ? 'mqtt'
      : Math.random() < 0.5
        ? 'http'
        : 'mqtt';

  try {
    if (protocol === 'http') {
      await request('/api/sensor-data', reading);
    } else {
      await request('/api/mqtt-sim/publish', {
        topic: `library/${sensor.zone}/sensors/${sensor.id}/data`,
        payload: reading
      });
    }
    const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`[${now}] ${protocol.toUpperCase().padEnd(4)} ${sensor.zone.padEnd(18)} ${sensor.type.padEnd(12)} ${String(value).padStart(6)} ${UNITS[sensor.type]}`);
  } catch (error) {
    console.error(`[SIM] failed to publish ${sensor.id}: ${error.message}`);
  }
}

function run() {
  console.log('Smart Library simulator running');
  console.log(`Target: http://${BACKEND_HOST}:${BACKEND_PORT}`);
  console.log(`Publish mode: ${PUBLISH_MODE}`);
  console.log(`Scenario: ${SCENARIO}`);

  for (const sensor of SENSORS) {
    const jitter = Math.floor(Math.random() * 1500);
    setTimeout(() => {
      publishReading(sensor);
      setInterval(() => publishReading(sensor), sensor.interval);
    }, jitter);
  }
}

run();
