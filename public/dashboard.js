const { getJSON, text, dateTime, renderAlerts, renderRooms } = window.SafeGuard;

window.pageRefresh = async dashboard => {
  const { latest, settings, status, alerts, rooms } = dashboard;
  const banner = document.querySelector('#status-banner');
  banner.className = `status-banner ${status === 'OFFLINE' ? 'warning' : status.toLowerCase()}`;
  text('#overall-status', status);
  text('#status-copy', status === 'NORMAL' ? 'Semua parameter berada dalam batas aman.' : status === 'WARNING' ? 'Perlu perhatian: cek sensor yang melewati ambang dan status ruangan.' : status === 'OFFLINE' ? 'Belum ada data pembacaan sensor yang diterima.' : 'Bahaya terdeteksi: segera periksa area terkait.');
  text('#last-sync', dateTime(latest.timestamp));
  const offlineWarning = document.querySelector('#offline-warning');
  const offlineRooms = dashboard.offlineRooms || [];
  offlineWarning.hidden = !offlineRooms.length;
  offlineWarning.textContent = offlineRooms.length ? `OFFLINE (${offlineRooms.length}): ${offlineRooms.join(', ')} belum mengirim data dalam ${dashboard.offlineThresholdSeconds} detik terakhir.` : '';
  text('#sensor-room', latest.room);
  text('#vibration-value', Number(latest.vibration).toFixed(2));
  text('#smoke-value', Math.round(latest.smoke));
  text('#temperature-value', Number(latest.temperature).toFixed(1));
  text('#gas-value', Math.round(latest.gas));
  text('#vibration-threshold', settings.vibration);
  text('#gas-threshold', settings.gas);
  document.querySelector('#vibration-meter').style.width = `${Math.min(100, latest.vibration / (settings.vibration * 2) * 100)}%`;
  document.querySelector('#smoke-meter').style.width = `${Math.min(100, latest.smoke / (settings.smoke * 2) * 100)}%`;
  document.querySelector('#gas-meter').style.width = `${Math.min(100, latest.gas / (settings.gas * 2) * 100)}%`;
  text('#room-summary', `${rooms.length} rooms monitored`);
  renderAlerts(alerts, 5);
  renderRooms(rooms, '#rooms-summary');
};
