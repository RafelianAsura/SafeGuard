const scenario = process.argv[2];
const allowedScenarios = new Set(['normal', 'one-breach', 'two-breach', 'offline']);
if (!allowedScenarios.has(scenario)) {
  console.error('Usage: node scripts/simulate.js <normal|one-breach|two-breach|offline>');
  process.exit(1);
}

const readingsUrl = new URL(process.env.SAFEGUARD_API_URL || 'http://localhost:3000/api/readings');
const settingsUrl = new URL('/api/settings', readingsUrl.origin);
const room = process.env.SIMULATOR_ROOM || process.argv[3] || 'Ruang Demo';
const intervalMs = Number(process.env.SIMULATOR_INTERVAL_MS || 5000);
const maxReadings = Number(process.env.SIMULATOR_MAX_READINGS || 0);
const apiKey = process.env.SAFEGUARD_API_KEY;
if (!Number.isFinite(intervalMs) || intervalMs < 250) {
  console.error('SIMULATOR_INTERVAL_MS must be at least 250.');
  process.exit(1);
}
if (!Number.isInteger(maxReadings) || maxReadings < 0) {
  console.error('SIMULATOR_MAX_READINGS must be a non-negative integer.');
  process.exit(1);
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function getSettings() {
  const response = await fetch(settingsUrl);
  if (!response.ok) throw new Error(`Settings request failed: HTTP ${response.status}`);
  return response.json();
}

function payloadFor(settings) {
  const payload = {
    room,
    vibration: Number((settings.vibration * 0.25).toFixed(3)),
    smoke: Number((settings.smoke * 0.25).toFixed(2)),
    temperature: Number((settings.temperature * 0.5).toFixed(2)),
    gas: Number((settings.gas * 0.25).toFixed(2))
  };
  if (scenario === 'one-breach') payload.gas = Number((settings.gas * 1.2).toFixed(2));
  if (scenario === 'two-breach') {
    payload.smoke = Number((settings.smoke * 1.2).toFixed(2));
    payload.temperature = Number((settings.temperature * 1.2).toFixed(2));
  }
  return payload;
}

async function sendReading(payload) {
  const headers = { 'Content-Type': 'application/json', 'x-safeguard-demo': 'true' };
  if (apiKey) headers['x-api-key'] = apiKey;
  const response = await fetch(readingsUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(`Reading request failed: HTTP ${response.status} ${result.error || ''}`);
  console.log(`${new Date().toLocaleTimeString()} ${room}: ${result.status} (${scenario})`);
}

async function main() {
  const settings = await getSettings();
  const payload = payloadFor(settings);
  if (scenario === 'offline') {
    await sendReading(payloadFor({ ...settings, gas: settings.gas, smoke: settings.smoke, temperature: settings.temperature }));
    console.log(`No more readings will be sent. Room should show OFFLINE after ${process.env.SAFEGUARD_OFFLINE_SECONDS || 30} seconds.`);
    return;
  }
  console.log(`Sending ${scenario} readings to ${readingsUrl.href} every ${intervalMs} ms. Press Ctrl+C to stop.`);
  let sent = 0;
  while (maxReadings === 0 || sent < maxReadings) {
    try {
      await sendReading(payload);
    } catch (error) {
      console.error(error.message);
    }
    sent += 1;
    if (maxReadings > 0 && sent >= maxReadings) break;
    await delay(intervalMs);
  }
  if (maxReadings > 0) console.log(`Finished after ${sent} readings.`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
