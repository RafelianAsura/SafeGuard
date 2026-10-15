(() => {
  const routes = [
    ['/', '⌂', 'Dashboard'],
    ['/live-monitoring', '◉', 'Live Monitoring'],
    ['/rooms', '▦', 'Rooms'],
    ['/history', '◷', 'History'],
    ['/alerts', '!', 'Alerts'],
    ['/settings', '⚙', 'Settings']
  ];
  const currentPath = location.pathname.replace(/\.html$/, '') || '/';
  const currentPage = routes.find(([path]) => path === currentPath) || routes[0];
  const $ = selector => document.querySelector(selector);
  const text = (selector, value) => {
    const element = $(selector);
    if (element) element.textContent = value;
  };
  let dashboardStatus = 'NORMAL';
  let audioEnabled = false;
  let audioContext;
  let alarmLoop;
  let activeAlarmStatus = 'NORMAL';
  const statusRank = { NORMAL: 0, WARNING: 1, DANGER: 2 };
  const time = timestamp => timestamp ? new Date(timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '--';
  const dateTime = timestamp => timestamp ? new Date(timestamp).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '--';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const csvCell = value => {
    let valueText = String(value ?? '');
    if (/^[=+\-@]/.test(valueText)) valueText = `'${valueText}`;
    return `"${valueText.replace(/"/g, '""')}"`;
  };
  const getJSON = async (url, options) => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`API request failed (${response.status})`);
    return response.json();
  };

  function updateConnectionError() {
    const warning = $('#connection-warning');
    if (warning) {
      warning.hidden = false;
      warning.textContent = 'Backend belum terhubung. Jalankan server SafeGuard terlebih dahulu.';
    }
    text('#status-copy', 'Backend belum terhubung. Jalankan server SafeGuard terlebih dahulu.');
  }

  function clearConnectionError() {
    const warning = $('#connection-warning');
    if (warning) warning.hidden = true;
  }

  function renderHeader() {
    const sidebar = $('#sidebar');
    const header = $('#topbar');
    sidebar.innerHTML = `<div class="brand"><span class="brand-mark">S</span><span>SafeGuard<small>SMART BUILDING</small></span></div>
      <nav>${routes.map(([path, icon, label]) => `<a class="${path === currentPage[0] ? 'active' : ''}" href="${path}" ${path === currentPage[0] ? 'aria-current="page"' : ''}><span>${icon}</span> ${label}${path === '/alerts' ? '<b id="alert-count">0</b>' : ''}</a>`).join('')}</nav>
      <div class="sidebar-foot"><span class="online-dot"></span><div><strong>System online</strong><small>ESP32 gateway ready</small></div></div>`;
    header.innerHTML = `<button class="menu" id="menu">☰</button><div><p class="eyebrow">CONTROL CENTER / <span id="header-date"></span></p><h1>${currentPage[2] === 'Dashboard' ? 'Building overview' : currentPage[2]}</h1></div>
      <div class="top-actions"><label class="audio-toggle" title="Alarm berulang terus saat WARNING/DANGER"><input id="audio-enabled" type="checkbox"><span class="audio-switch" aria-hidden="true"></span><span id="audio-label">Sound off</span></label>
      <span class="demo-pill" id="demo-pill" hidden><i></i> Demo mode</span><button class="icon-button" id="refresh" title="Refresh data">↻</button><div class="avatar">SG</div></div>`;
    text('#header-date', new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase());
    $('#menu').addEventListener('click', () => sidebar.classList.toggle('open'));
    $('#refresh').addEventListener('click', () => window.SafeGuard.refresh());
    $('#audio-enabled').addEventListener('change', toggleAudio);
  }

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

  function playAlert(status) {
    const now = audioContext.currentTime + 0.03;
    const count = status === 'DANGER' ? 3 : 2;
    const duration = status === 'DANGER' ? 0.22 : 0.14;
    for (let index = 0; index < count; index += 1) {
      playTone(status === 'DANGER' ? 1250 : 820, now + index * (duration + 0.12), duration);
    }
  }

  function syncAlarm(status) {
    if (!audioEnabled || !audioContext || status === 'NORMAL') {
      clearInterval(alarmLoop);
      alarmLoop = null;
      activeAlarmStatus = 'NORMAL';
      return;
    }
    if (alarmLoop && activeAlarmStatus === status) return;
    const shouldPlay = statusRank[status] > statusRank[activeAlarmStatus];
    clearInterval(alarmLoop);
    activeAlarmStatus = status;
    if (shouldPlay) playAlert(status);
    const count = status === 'DANGER' ? 3 : 2;
    const duration = status === 'DANGER' ? 0.22 : 0.14;
    alarmLoop = setInterval(() => playAlert(activeAlarmStatus), (count * duration + (count - 1) * 0.12 - 0.03) * 1000);
  }

  async function toggleAudio(event) {
    const toggle = event.currentTarget;
    if (!toggle.checked) {
      audioEnabled = false;
      syncAlarm('NORMAL');
      text('#audio-label', 'Sound off');
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      toggle.checked = false;
      text('#audio-label', 'Sound unavailable');
      return;
    }
    audioContext ||= new AudioContextClass();
    try {
      await audioContext.resume();
      audioEnabled = true;
      text('#audio-label', 'Sound on');
      syncAlarm(dashboardStatus);
    } catch {
      toggle.checked = false;
      text('#audio-label', 'Sound unavailable');
    }
  }

  function renderAlerts(alerts, limit = alerts.length) {
    const list = $('#alerts-list');
    if (!list) return;
    const shown = alerts.slice(0, limit);
    list.innerHTML = shown.length ? shown.map(alert => `<div class="alert-row"><span class="alert-dot ${alert.severity === 'warning' ? 'warning' : ''}"></span><div class="alert-detail"><strong>${escapeHTML(alert.message)}</strong><small>${escapeHTML(alert.room)} · ${escapeHTML(alert.type)}</small></div><span class="alert-time">${escapeHTML(dateTime(alert.timestamp))}</span></div>`).join('') : '<div class="empty">Belum ada peringatan.</div>';
  }

  function renderRooms(rooms, selector = '#rooms-grid') {
    const grid = $(selector);
    if (!grid) return;
    grid.innerHTML = rooms.length ? rooms.map(room => `<div class="room"><div class="room-head"><strong>${escapeHTML(room.room)}</strong><span class="room-status ${escapeHTML(String(room.status).toLowerCase())}">${escapeHTML(room.status)}</span></div><div class="room-data"><span>Temp<b>${Number(room.temperature || 0).toFixed(1)} °C</b></span><span>Gas<b>${Math.round(room.gas || 0)} ppm/scale</b></span><span>Smoke<b>${Math.round(room.smoke || 0)} ppm/scale</b></span><span>Vibration<b>${Number(room.vibration || 0).toFixed(2)} g</b></span></div></div>`).join('') : '<div class="empty">Belum ada ruangan.</div>';
  }

  function renderReadings(readings, selector) {
    const body = $(selector);
    if (!body) return;
    body.innerHTML = readings.length ? readings.slice().reverse().map(item => `<tr><td>${escapeHTML(dateTime(item.timestamp))}</td><td><strong>${escapeHTML(item.room)}</strong></td><td>${Number(item.vibration).toFixed(2)} g</td><td>${Math.round(item.smoke)} ppm/scale</td><td>${Number(item.temperature).toFixed(1)} °C</td><td>${Math.round(item.gas)} ppm/scale</td><td><span class="table-status ${escapeHTML(String(item.status || 'NORMAL').toLowerCase())}">${escapeHTML(item.status || 'NORMAL')}</span></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Belum ada data.</td></tr>';
  }

  function renderRoomOptions(rooms, selector) {
    const select = $(selector);
    if (!select) return;
    const selected = select.value;
    select.replaceChildren(new Option('All rooms', ''));
    rooms.forEach(room => select.add(new Option(room.room, room.room)));
    if (rooms.some(room => room.room === selected)) select.value = selected;
  }

  function updateBadge(count) {
    const badge = $('#alert-count');
    if (badge) badge.textContent = Number(count || 0);
  }

  async function refresh() {
    try {
      const dashboard = await getJSON('/api/dashboard');
      dashboardStatus = dashboard.status;
      updateBadge(dashboard.alertCount);
      const demoPill = $('#demo-pill');
      if (demoPill) demoPill.hidden = !dashboard.demoMode;
      syncAlarm(dashboard.status);
      clearConnectionError();
      await window.pageRefresh(dashboard);
    } catch (error) {
      updateConnectionError();
      console.error(error);
    }
  }

  const hashRoutes = {
    '#monitoring': '/live-monitoring',
    '#live-monitoring': '/live-monitoring',
    '#rooms': '/rooms',
    '#history': '/history',
    '#alerts': '/alerts',
    '#settings': '/settings'
  };
  window.addEventListener('hashchange', () => {
    if (location.pathname === '/' && hashRoutes[location.hash]) location.replace(hashRoutes[location.hash]);
  });
  if (location.pathname === '/' && hashRoutes[location.hash]) {
    location.replace(hashRoutes[location.hash]);
    return;
  }

  renderHeader();
  window.SafeGuard = {
    getJSON, text, time, dateTime, escapeHTML, csvCell, renderAlerts, renderRooms,
    renderReadings, renderRoomOptions, updateBadge, refresh, updateConnectionError
  };
  window.refreshTimer = window.setInterval(refresh, 10000);
  window.addEventListener('beforeunload', () => clearInterval(window.refreshTimer));
  window.refreshPage = refresh;
  window.addEventListener('load', () => { void refresh(); }, { once: true });
})();
