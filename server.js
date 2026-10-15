const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.SAFEGUARD_API_KEY || '').trim();
const defaults = { vibration: 0.15, smoke: 320, temperature: 45, gas: 420 };
const OFFLINE_SECONDS = Number(process.env.SAFEGUARD_OFFLINE_SECONDS || 30);
const ALERT_COOLDOWN_SECONDS = Number(process.env.SAFEGUARD_ALERT_COOLDOWN_SECONDS || 60);
const DEBOUNCE_READINGS = Number(process.env.SAFEGUARD_DEBOUNCE_READINGS || 3);
const HYSTERESIS_RATIO = Number(process.env.SAFEGUARD_HYSTERESIS_RATIO || 0.9);
const RETENTION_DAYS = Number(process.env.SAFEGUARD_RETENTION_DAYS || 7);
if (!Number.isFinite(OFFLINE_SECONDS) || OFFLINE_SECONDS <= 0) throw new Error('SAFEGUARD_OFFLINE_SECONDS must be a positive number');
if (!Number.isFinite(ALERT_COOLDOWN_SECONDS) || ALERT_COOLDOWN_SECONDS < 0) throw new Error('SAFEGUARD_ALERT_COOLDOWN_SECONDS must be zero or a positive number');
if (!Number.isInteger(DEBOUNCE_READINGS) || DEBOUNCE_READINGS < 1) throw new Error('SAFEGUARD_DEBOUNCE_READINGS must be a positive integer');
if (!Number.isFinite(HYSTERESIS_RATIO) || HYSTERESIS_RATIO <= 0 || HYSTERESIS_RATIO >= 1) throw new Error('SAFEGUARD_HYSTERESIS_RATIO must be between 0 and 1');
if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) throw new Error('SAFEGUARD_RETENTION_DAYS must be a positive number');
if (process.env.VERCEL === '1') {
  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL must be configured on Vercel.');
  if (!process.env.TURSO_AUTH_TOKEN) throw new Error('TURSO_AUTH_TOKEN must be configured on Vercel.');
  if (!API_KEY) throw new Error('SAFEGUARD_API_KEY must be configured on Vercel.');
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'safeguard.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN
});
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastCleanupAt = 0;

async function execute(sql, args = []) {
  return db.execute({ sql, args });
}

function rowsFrom(result) {
  return result.rows.map(row => Object.fromEntries(result.columns.map(column => [column, row[column]])));
}

async function all(sql, args = []) {
  return rowsFrom(await execute(sql, args));
}

async function get(sql, args = []) {
  return (await all(sql, args))[0];
}

async function cleanupOldData() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  await execute('DELETE FROM readings WHERE received_at < ?', [cutoff]);
  await execute('DELETE FROM alerts WHERE created_at < ?', [cutoff]);
  lastCleanupAt = Date.now();
}

app.use(express.json({ limit: '10kb' }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));
app.use(express.static(path.join(__dirname, 'public')));
app.get(['/live-monitoring', '/rooms', '/history', '/alerts', '/settings'], (req, res) => {
  const page = req.path.slice(1);
  res.sendFile(path.join(__dirname, 'public', `${page}.html`));
});

if (!API_KEY) console.warn('WARNING: SAFEGUARD_API_KEY is not set; write API endpoints are unauthenticated.');

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const supplied = Buffer.from(req.get('x-api-key') || '');
  const expected = Buffer.from(API_KEY);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    return res.status(401).json({ error: 'API key tidak valid atau belum diberikan.' });
  }
  next();
}

async function getSettings() {
  return Object.fromEntries((await all('SELECT key, value FROM settings')).map(row => [row.key, row.value]));
}

function classify(reading, settings, previousBreaches = []) {
  const breaches = [];
  if (reading.vibration >= settings.vibration * (previousBreaches.includes('vibration') ? HYSTERESIS_RATIO : 1)) breaches.push(['seismic', 'Getaran melebihi ambang', 'vibration']);
  if (reading.smoke >= settings.smoke * (previousBreaches.includes('smoke') ? HYSTERESIS_RATIO : 1)) breaches.push(['smoke', 'Asap terdeteksi melebihi ambang', 'smoke']);
  if (reading.temperature >= settings.temperature * (previousBreaches.includes('temperature') ? HYSTERESIS_RATIO : 1)) breaches.push(['temperature', 'Suhu melebihi ambang', 'temperature']);
  if (reading.gas >= settings.gas * (previousBreaches.includes('gas') ? HYSTERESIS_RATIO : 1)) breaches.push(['gas', 'Indikasi gas melebihi ambang', 'gas']);
  return breaches;
}

function statusFromBreaches(breaches) {
  return breaches.length >= 2 ? 'DANGER' : breaches.length ? 'WARNING' : 'NORMAL';
}

async function initializeDatabase() {
  const schema = [
    `CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT NOT NULL,
      vibration REAL NOT NULL DEFAULT 0,
      smoke REAL NOT NULL DEFAULT 0,
      temperature REAL NOT NULL DEFAULT 0,
      gas REAL NOT NULL DEFAULT 0,
      timestamp TEXT NOT NULL,
      received_at INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'esp32',
      status TEXT NOT NULL DEFAULT 'NORMAL',
      breaches TEXT NOT NULL DEFAULT '[]',
      candidate_status TEXT NOT NULL DEFAULT '',
      candidate_count INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      room TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0
    )`,
    'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value REAL NOT NULL)',
    'CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS room_state (room TEXT PRIMARY KEY, last_received_at INTEGER NOT NULL)'
  ];
  for (const statement of schema) await execute(statement);

  const readingColumns = new Set((await all('PRAGMA table_info(readings)')).map(column => column.name));
  const needsStatusBackfill = !readingColumns.has('status');
  const readingMigrations = [
    ['received_at', 'ALTER TABLE readings ADD COLUMN received_at INTEGER NOT NULL DEFAULT 0'],
    ['source', "ALTER TABLE readings ADD COLUMN source TEXT NOT NULL DEFAULT 'esp32'"],
    ['status', "ALTER TABLE readings ADD COLUMN status TEXT NOT NULL DEFAULT 'NORMAL'"],
    ['breaches', "ALTER TABLE readings ADD COLUMN breaches TEXT NOT NULL DEFAULT '[]'"],
    ['candidate_status', "ALTER TABLE readings ADD COLUMN candidate_status TEXT NOT NULL DEFAULT ''"],
    ['candidate_count', 'ALTER TABLE readings ADD COLUMN candidate_count INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [column, statement] of readingMigrations) {
    if (!readingColumns.has(column)) await execute(statement);
  }
  const alertColumns = new Set((await all('PRAGMA table_info(alerts)')).map(column => column.name));
  if (!alertColumns.has('created_at')) await execute('ALTER TABLE alerts ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0');

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_readings_room_id ON readings(room, id)',
    'CREATE INDEX IF NOT EXISTS idx_readings_timestamp ON readings(timestamp)',
    'CREATE INDEX IF NOT EXISTS idx_readings_received_at ON readings(received_at)',
    'CREATE INDEX IF NOT EXISTS idx_alerts_room_type_created_at ON alerts(room, type, created_at)'
  ];
  for (const statement of indexes) await execute(statement);

  const readingsWithoutReceivedAt = await all('SELECT id, timestamp FROM readings WHERE received_at = 0');
  for (const row of readingsWithoutReceivedAt) {
    const parsed = Date.parse(row.timestamp);
    await execute('UPDATE readings SET received_at = ? WHERE id = ?', [Number.isFinite(parsed) ? parsed : 0, row.id]);
  }
  await execute(`INSERT OR IGNORE INTO room_state (room, last_received_at)
    SELECT room, MAX(received_at) FROM readings GROUP BY room`);
  const alertsWithoutCreatedAt = await all('SELECT id, timestamp FROM alerts WHERE created_at = 0');
  for (const row of alertsWithoutCreatedAt) {
    const parsed = Date.parse(row.timestamp);
    await execute('UPDATE alerts SET created_at = ? WHERE id = ?', [Number.isFinite(parsed) ? parsed : 0, row.id]);
  }

  for (const [key, value] of Object.entries(defaults)) {
    await execute('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [key, value]);
  }
  const vibrationMigration = await get("SELECT value FROM app_meta WHERE key = 'vibration_threshold_v2'");
  if (!vibrationMigration) {
    await execute('UPDATE settings SET value = ? WHERE key = ? AND value = ?', [defaults.vibration, 'vibration', 1.2]);
    await execute("INSERT INTO app_meta (key, value) VALUES ('vibration_threshold_v2', 'applied')");
  }

  if (needsStatusBackfill) {
    const legacyReadings = await all('SELECT * FROM readings ORDER BY id');
    for (const reading of legacyReadings) {
      const breaches = classify(reading, await getSettings()).map(([, , field]) => field);
      await execute('UPDATE readings SET status = ?, breaches = ? WHERE id = ?', [
        statusFromBreaches(breaches), JSON.stringify(breaches), reading.id
      ]);
    }
  }
  await cleanupOldData();
}

const dbReady = initializeDatabase();
app.use('/api', (req, res, next) => {
  dbReady.then(async () => {
    if (Date.now() - lastCleanupAt >= CLEANUP_INTERVAL_MS) await cleanupOldData();
    next();
  }).catch(error => {
    if (req.path === '/health') return res.status(503).json({ ok: false });
    next(error);
  });
});

async function addReading(payload, createAlerts = true, source = 'esp32') {
  const reading = {
    room: String(payload.room || 'Lobi').trim(),
    vibration: Number(payload.vibration || 0),
    smoke: Number(payload.smoke || 0),
    temperature: Number(payload.temperature || 0),
    gas: Number(payload.gas || 0),
    timestamp: payload.timestamp || new Date().toISOString(),
    received_at: Date.now(),
    source
  };
  const settings = await getSettings();
  const transaction = await db.transaction('write');
  try {
    const previousRows = rowsFrom(await transaction.execute({
      sql: 'SELECT status, breaches, candidate_status, candidate_count FROM readings WHERE room = ? ORDER BY id DESC LIMIT 1',
      args: [reading.room]
    }));
    const previous = previousRows[0];
    let previousBreaches = [];
    try { previousBreaches = previous ? JSON.parse(previous.breaches) : []; } catch { previousBreaches = []; }
    const breaches = classify(reading, settings, previousBreaches);
    const activeBreaches = breaches.map(([, , field]) => field);
    const candidate = statusFromBreaches(breaches);
    const previousStatus = previous?.status || 'NORMAL';
    let status = previousStatus;
    let candidateStatus = '';
    let candidateCount = 0;
    if (candidate !== previousStatus) {
      candidateStatus = candidate;
      candidateCount = previous?.candidate_status === candidate ? Number(previous.candidate_count) + 1 : 1;
      if (candidateCount >= DEBOUNCE_READINGS) {
        status = candidate;
        candidateStatus = '';
        candidateCount = 0;
      }
    }
    Object.assign(reading, {
      status,
      breaches: JSON.stringify(activeBreaches),
      candidate_status: candidateStatus,
      candidate_count: candidateCount
    });
    const result = await transaction.execute(`INSERT INTO readings (room, vibration, smoke, temperature, gas, timestamp, received_at, source, status, breaches, candidate_status, candidate_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      reading.room, reading.vibration, reading.smoke, reading.temperature, reading.gas,
      reading.timestamp, reading.received_at, reading.source, reading.status, reading.breaches,
      reading.candidate_status, reading.candidate_count
    ]);
    await transaction.execute(`INSERT INTO room_state (room, last_received_at) VALUES (?, ?)
      ON CONFLICT(room) DO UPDATE SET last_received_at = excluded.last_received_at`, [reading.room, reading.received_at]);
    if (createAlerts && status === candidate && status !== 'NORMAL' && breaches.length) {
      const severity = status === 'DANGER' ? 'danger' : 'warning';
      const now = Date.now();
      for (const [type, message] of breaches) {
        const alertRows = rowsFrom(await transaction.execute({
          sql: 'SELECT created_at FROM alerts WHERE room = ? AND type = ? ORDER BY id DESC LIMIT 1',
          args: [reading.room, type]
        }));
        const previousAlert = alertRows[0];
        if (!previousAlert || now - Number(previousAlert.created_at) >= ALERT_COOLDOWN_SECONDS * 1000) {
          await transaction.execute(`INSERT INTO alerts (type, severity, message, room, timestamp, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`, [type, severity, message, reading.room, reading.timestamp, now]);
        }
      }
    }
    await transaction.commit();
    return { id: Number(result.lastInsertRowid), ...reading, breaches };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.get('/api/health', asyncHandler(async (_req, res) => {
  await dbReady;
  await execute('SELECT 1');
  res.json({ ok: true, service: 'SafeGuard API' });
}));

app.get('/api/dashboard', asyncHandler(async (_req, res) => {
  const settings = await getSettings();
  const latestPerRoom = await all(`SELECT room_state.room, room_state.last_received_at,
      readings.id, readings.vibration, readings.smoke, readings.temperature, readings.gas,
      readings.timestamp, readings.received_at, readings.source, readings.status, readings.breaches
    FROM room_state LEFT JOIN (
      SELECT readings.* FROM readings
      INNER JOIN (SELECT room, MAX(id) AS latest_id FROM readings GROUP BY room) latest
      ON readings.id = latest.latest_id
    ) readings ON readings.room = room_state.room
    ORDER BY room_state.room`);
  const rank = { NORMAL: 0, WARNING: 1, DANGER: 2 };
  const rooms = latestPerRoom.map(room => {
    const breaches = room.breaches ? JSON.parse(room.breaches) : room.id ? classify(room, settings).map(([, , field]) => field) : [];
    const sensorStatus = room.status || statusFromBreaches(breaches);
    const offline = !room.id || Date.now() - Number(room.last_received_at) > OFFLINE_SECONDS * 1000;
    return { ...room, sensorStatus, offline, status: offline ? 'OFFLINE' : sensorStatus };
  });
  const onlineRooms = rooms.filter(room => !room.offline);
  const worstRoom = onlineRooms.reduce((worst, room) => !worst || rank[room.sensorStatus] > rank[worst.sensorStatus] ? room : worst, null);
  const newestRoom = rooms.reduce((newest, room) => !newest || room.id > newest.id ? room : newest, null);
  const latest = worstRoom || (newestRoom?.id ? newestRoom : null) || {
    room: 'Belum ada data', vibration: 0, smoke: 0, temperature: 0, gas: 0, timestamp: null, status: 'OFFLINE'
  };
  const offlineRooms = rooms.filter(room => room.offline).map(room => room.room);
  const sensorStatus = worstRoom ? worstRoom.sensorStatus : 'NORMAL';
  const status = !rooms.length ? 'OFFLINE' : sensorStatus === 'NORMAL' && offlineRooms.length ? 'WARNING' : sensorStatus;
  const demoRooms = onlineRooms;
  const demoMode = demoRooms.length > 0 && demoRooms.every(room => room.source === 'demo');
  const alertCount = Number((await get('SELECT COUNT(*) AS count FROM alerts')).count);
  res.json({
    status, sensorStatus, offlineRooms, offlineThresholdSeconds: OFFLINE_SECONDS,
    demoMode, latest, settings, rooms, alertCount, alerts: await all('SELECT * FROM alerts ORDER BY id DESC LIMIT 6')
  });
}));

app.get('/api/readings', asyncHandler(async (req, res) => {
  const requestedLimit = req.query.limit === undefined ? 60 : Number(req.query.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return res.status(400).json({ error: 'limit harus integer antara 1 dan 500.' });
  const limit = Math.min(requestedLimit, 500);
  if (req.query.room !== undefined && (typeof req.query.room !== 'string' || req.query.room.length > 40)) {
    return res.status(400).json({ error: 'room filter maksimal 40 karakter.' });
  }
  const dateFilters = [];
  for (const key of ['from', 'to']) {
    if (req.query[key] !== undefined) {
      const date = req.query[key];
      const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? new Date(`${date}T00:00:00Z`)
        : null;
      if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
        return res.status(400).json({ error: `${key} harus berupa tanggal YYYY-MM-DD yang valid.` });
      }
      dateFilters.push([key, date]);
    }
  }
  const clauses = [];
  const args = [];
  if (req.query.room) {
    clauses.push('room = ?');
    args.push(req.query.room);
  }
  for (const [key, value] of dateFilters) {
    clauses.push(key === 'from' ? 'date(timestamp) >= date(?)' : 'date(timestamp) <= date(?)');
    args.push(value);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  args.push(limit);
  const readings = await all(`SELECT * FROM readings${where} ORDER BY id DESC LIMIT ?`, args);
  res.json(readings.reverse());
}));

app.get('/api/alerts', asyncHandler(async (req, res) => {
  const requestedLimit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return res.status(400).json({ error: 'limit harus integer antara 1 dan 500.' });
  const limit = Math.min(requestedLimit, 500);
  const requestedOffset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isInteger(requestedOffset) || requestedOffset < 0) return res.status(400).json({ error: 'offset harus berupa integer nol atau lebih.' });
  res.json(await all('SELECT * FROM alerts ORDER BY id DESC LIMIT ? OFFSET ?', [limit, requestedOffset]));
}));

app.get('/api/settings', asyncHandler(async (_req, res) => res.json(await getSettings())));
app.put('/api/settings', requireApiKey, asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length || entries.some(([key, value]) => !Object.hasOwn(defaults, key) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
    return res.status(400).json({ error: 'Kirim satu atau lebih threshold yang dikenal dengan nilai angka finite dan lebih besar dari 0.' });
  }
  for (const [key, value] of entries) {
    await execute('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }
  res.json(await getSettings());
}));

app.post('/api/readings', requireApiKey, asyncHandler(async (req, res) => {
  const required = ['room', 'vibration', 'smoke', 'temperature', 'gas'];
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !required.every(key => Object.hasOwn(req.body, key))) {
    return res.status(400).json({ error: 'room, vibration, smoke, temperature, dan gas wajib diisi.' });
  }
  if (typeof req.body.room !== 'string' || !req.body.room.trim() || req.body.room.trim().length > 40) {
    return res.status(400).json({ error: 'room harus berupa teks sepanjang 1 sampai 40 karakter.' });
  }
  if (required.slice(1).some(key => typeof req.body[key] !== 'number' || !Number.isFinite(req.body[key]))) {
    return res.status(400).json({ error: 'Nilai vibration, smoke, temperature, dan gas harus berupa angka finite.' });
  }
  if (req.body.timestamp !== undefined && (typeof req.body.timestamp !== 'string' || !Number.isFinite(Date.parse(req.body.timestamp)))) {
    return res.status(400).json({ error: 'timestamp harus berupa tanggal/waktu yang valid.' });
  }
  const source = req.get('x-safeguard-demo') === 'true' ? 'demo' : 'esp32';
  res.status(201).json(await addReading(req.body, true, source));
}));

app.post('/api/demo/seed', requireApiKey, asyncHandler(async (_req, res) => {
  const rooms = ['Lobi', 'Ruang Server', 'Lab Elektronika', 'Kelas 1'];
  const now = Date.now();
  const settings = await getSettings();
  for (const [index, room] of rooms.entries()) {
    await addReading({
      room,
      vibration: Number((Math.random() * settings.vibration * 0.5).toFixed(3)),
      smoke: Math.round(80 + Math.random() * 80 + (index === 2 ? 80 : 0)),
      temperature: Number((27 + Math.random() * 5 + (index === 1 ? 3 : 0)).toFixed(1)),
      gas: Math.round(110 + Math.random() * 110 + (index === 2 ? 100 : 0)),
      timestamp: new Date(now - (rooms.length - index) * 1200).toISOString()
    }, false, 'demo');
  }
  res.json({ inserted: rooms.length });
}));

app.use((error, _req, res, _next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Ukuran request maksimal 10 KB.' });
  if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: 'JSON request tidak valid.' });
  console.error(error);
  res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

if (require.main === module) {
  dbReady.then(() => {
    app.listen(PORT, () => console.log(`SafeGuard running at http://localhost:${PORT}`));
    const cleanupTimer = setInterval(() => cleanupOldData().catch(error => console.error('Data cleanup failed:', error)), CLEANUP_INTERVAL_MS);
    cleanupTimer.unref();
  }).catch(error => {
    console.error('Database initialization failed:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
