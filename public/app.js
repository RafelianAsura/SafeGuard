const $ = selector => document.querySelector(selector);
let chart;
let audioContext;
let audioEnabled = false;
let currentStatus = null;
let activeAlarmStatus = 'NORMAL';
let alarmLoop = null;
const statusRank = { NORMAL: 0, WARNING: 1, DANGER: 2 };
const time = timestamp => timestamp ? new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--';
const dateTime = timestamp => timestamp ? new Date(timestamp).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--';

async function getJSON(url, options) { const response = await fetch(url, options); if (!response.ok) throw new Error('API error'); return response.json(); }
function setText(selector, value) { $(selector).textContent = value; }
function meter(selector, value, threshold) { $(selector).style.width = `${Math.min(100, threshold ? value / threshold * 100 : 0)}%`; }
function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function statusForReading(reading, settings) { const hits = ['vibration','smoke','temperature','gas'].filter(key => Number(reading[key]) >= Number(settings[key])); return hits.length > 1 ? 'DANGER' : hits.length ? 'WARNING' : 'NORMAL'; }
function playTone(frequency, startAt, duration) {
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.015);
  gain.gain.setValueAtTime(0.08, startAt + duration - 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration);
}
function playDashboardAlert(status) {
  if (!audioEnabled || !audioContext || status === 'NORMAL') return;
  const now = audioContext.currentTime + 0.03;
  const count = status === 'DANGER' ? 3 : 2;
  const frequency = status === 'DANGER' ? 1250 : 820;
  const duration = status === 'DANGER' ? 0.22 : 0.14;
  for (let index = 0; index < count; index += 1) playTone(frequency, now + index * (duration + 0.12), duration);
}
function alarmPatternDuration(status) {
  const count = status === 'DANGER' ? 3 : 2;
  const duration = status === 'DANGER' ? 0.22 : 0.14;
  return count * duration + (count - 1) * 0.12;
}
function stopDashboardAlarm() {
  if (alarmLoop) clearInterval(alarmLoop);
  alarmLoop = null;
  activeAlarmStatus = 'NORMAL';
}
function syncDashboardAlarm(status) {
  if (!audioEnabled || !audioContext || !status || status === 'NORMAL') {
    stopDashboardAlarm();
    return;
  }
  if (alarmLoop && activeAlarmStatus === status) return;
  const shouldPlayNow = statusRank[status] > statusRank[activeAlarmStatus];
  stopDashboardAlarm();
  activeAlarmStatus = status;
  if (shouldPlayNow) playDashboardAlert(status);
  const repeatDelay = (alarmPatternDuration(status) - 0.03) * 1000;
  alarmLoop = setInterval(() => playDashboardAlert(activeAlarmStatus), repeatDelay);
}

function renderChart(readings) {
  const context = $('#sensor-chart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(context, { type: 'line', data: { labels: readings.map(item => time(item.timestamp)), datasets: [
    { label: 'Vibration (g)', data: readings.map(item => item.vibration), borderColor: '#6f9fd0', backgroundColor: '#6f9fd020', tension: .35, pointRadius: 0, yAxisID: 'y' },
    { label: 'Smoke (ppm/scale)', data: readings.map(item => item.smoke), borderColor: '#ed9b50', backgroundColor: '#ed9b5020', tension: .35, pointRadius: 0, yAxisID: 'y1' },
    { label: 'Gas (ppm/scale)', data: readings.map(item => item.gas), borderColor: '#4fb48b', backgroundColor: '#4fb48b20', tension: .35, pointRadius: 0, yAxisID: 'y1' }
  ]}, options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true, padding: 18, font: { family: 'system-ui', size: 10 } } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: '#9ba8a6', font: { size: 10 } } }, y: { position: 'left', grid: { color: '#edf1ef' }, ticks: { color: '#9ba8a6', font: { size: 10 } } }, y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#9ba8a6', font: { size: 10 } } } } } });
}
function renderAlerts(alerts) { $('#alert-count').textContent = alerts.length; $('#alerts-list').innerHTML = alerts.length ? alerts.slice(0, 5).map(alert => `<div class="alert-row"><span class="alert-dot ${alert.severity === 'warning' ? 'warning' : ''}"></span><div class="alert-detail"><strong>${escapeHTML(alert.message)}</strong><small>${escapeHTML(alert.room)} · ${escapeHTML(alert.type)}</small></div><span class="alert-time">${escapeHTML(dateTime(alert.timestamp))}</span></div>`).join('') : '<div class="empty">Belum ada peringatan.</div>'; }
function renderRoomFilter(rooms) {
  const selector = $('#room-filter');
  const selectedRoom = selector.value;
  selector.replaceChildren(new Option('All rooms', ''));
  rooms.forEach(room => selector.add(new Option(room.room, room.room)));
  if (rooms.some(room => room.room === selectedRoom)) selector.value = selectedRoom;
}
function renderRooms(rooms) { setText('#room-summary', `${rooms.length} rooms monitored`); $('#rooms-grid').innerHTML = rooms.length ? rooms.map(room => `<div class="room"><div class="room-head"><strong>${escapeHTML(room.room)}</strong><span class="room-status ${escapeHTML(String(room.status).toLowerCase())}">${escapeHTML(room.status)}</span></div><div class="room-data"><span>Temp<b>${Number(room.temperature).toFixed(1)} °C</b></span><span>Gas<b>${Math.round(room.gas)} ppm/scale</b></span><span>Smoke<b>${Math.round(room.smoke)} ppm/scale</b></span><span>Vibration<b>${Number(room.vibration).toFixed(2)} g</b></span></div></div>`).join('') : '<div class="empty">Belum ada ruangan.</div>'; }
function renderHistory(readings, settings) { $('#history-body').innerHTML = readings.slice().reverse().slice(0, 15).map(item => { const status = item.status || statusForReading(item, settings); return `<tr><td>${escapeHTML(dateTime(item.timestamp))}</td><td><strong>${escapeHTML(item.room)}</strong></td><td>${Number(item.vibration).toFixed(2)} g</td><td>${Math.round(item.smoke)} ppm/scale</td><td>${Number(item.temperature).toFixed(1)} °C</td><td>${Math.round(item.gas)} ppm/scale</td><td><span class="table-status ${status.toLowerCase()}">${status}</span></td></tr>`; }).join(''); }
function renderSettings(settings) { Object.entries(settings).forEach(([key, value]) => { const input = $(`#setting-${key}`); if (input) input.value = value; }); }

async function loadDashboard() {
  const dashboard = await getJSON('/api/dashboard');
  renderRoomFilter(dashboard.rooms);
  const query = new URLSearchParams({ limit: '60' });
  if ($('#room-filter').value) query.set('room', $('#room-filter').value);
  const readings = await getJSON(`/api/readings?${query}`);
  const { latest, settings, status, alerts, rooms } = dashboard;
  currentStatus = status;
  syncDashboardAlarm(status);
  const offlineRooms = dashboard.offlineRooms || [];
  const banner = $('#status-banner'); banner.className = `status-banner ${(status === 'OFFLINE' ? 'warning' : status.toLowerCase())}`; setText('#overall-status', status); setText('#status-copy', status === 'NORMAL' ? 'Semua parameter berada dalam batas aman.' : status === 'WARNING' ? 'Perlu perhatian: cek sensor yang melewati ambang dan status ruangan.' : status === 'OFFLINE' ? 'Belum ada data pembacaan sensor yang diterima.' : 'Bahaya terdeteksi: segera periksa area terkait.'); setText('#last-sync', dateTime(latest.timestamp));
  const offlineWarning = $('#offline-warning'); offlineWarning.hidden = offlineRooms.length === 0; offlineWarning.textContent = offlineRooms.length ? `OFFLINE (${offlineRooms.length}): ${offlineRooms.join(', ')} belum mengirim data dalam ${dashboard.offlineThresholdSeconds} detik terakhir.` : '';
  $('#demo-pill').hidden = !dashboard.demoMode;
  setText('#sensor-room', latest.room); setText('#vibration-value', Number(latest.vibration).toFixed(2)); setText('#smoke-value', Math.round(latest.smoke)); setText('#temperature-value', Number(latest.temperature).toFixed(1)); setText('#gas-value', Math.round(latest.gas)); setText('#vibration-threshold', settings.vibration); setText('#gas-threshold', settings.gas); meter('#vibration-meter', latest.vibration, settings.vibration * 2); meter('#smoke-meter', latest.smoke, settings.smoke * 2); meter('#gas-meter', latest.gas, settings.gas * 2);
  renderChart(readings); renderAlerts(alerts); renderRooms(rooms); renderHistory(readings, settings); renderSettings(settings);
}
$('#refresh').addEventListener('click', loadDashboard); $('#menu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#room-filter').addEventListener('change', loadDashboard);
setText('#header-date', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase());
const audioToggle = $('#audio-enabled');
audioToggle.checked = audioEnabled;
setText('#audio-label', audioEnabled ? 'Sound on' : 'Sound off');
audioToggle.addEventListener('change', async () => {
  if (audioToggle.checked) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext ||= new AudioContextClass();
      try {
        await audioContext.resume();
        audioEnabled = true;
        setText('#audio-label', 'Sound on');
        syncDashboardAlarm(currentStatus);
      } catch {
        audioToggle.checked = false;
        setText('#audio-label', 'Sound unavailable');
      }
    } else {
      audioToggle.checked = false;
      setText('#audio-label', 'Sound unavailable');
    }
  } else {
    audioEnabled = false;
    stopDashboardAlarm();
    setText('#audio-label', 'Sound off');
  }
});
$('#save-settings').addEventListener('click', async () => { const settings = {}; ['vibration','smoke','temperature','gas'].forEach(key => settings[key] = Number($(`#setting-${key}`).value)); const headers = { 'Content-Type': 'application/json' }; const apiKey = $('#api-key').value.trim(); if (apiKey) headers['x-api-key'] = apiKey; try { await getJSON('/api/settings', { method: 'PUT', headers, body: JSON.stringify(settings) }); setText('#settings-note', 'Settings tersimpan.'); await loadDashboard(); } catch { setText('#settings-note', 'Settings gagal disimpan. Cek nilai threshold dan API key.'); } });
$('#download').addEventListener('click', async () => { const readings = await getJSON('/api/readings?limit=500'); const csv = [['timestamp','room','vibration','smoke','temperature','gas'].map(csvCell).join(','), ...readings.map(item => [item.timestamp,item.room,item.vibration,item.smoke,item.temperature,item.gas].map(csvCell).join(','))].join('\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = 'safeguard-history.csv'; link.click(); URL.revokeObjectURL(link.href); });
loadDashboard().catch(error => { console.error(error); setText('#status-copy', 'Backend belum terhubung. Jalankan server SafeGuard terlebih dahulu.'); }); setInterval(loadDashboard, 10000);
