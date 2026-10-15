const { getJSON, renderRoomOptions, renderReadings, csvCell, text } = window.SafeGuard;
let currentReadings = [];

async function loadHistory(dashboard) {
  renderRoomOptions(dashboard.rooms, '#history-room');
  const query = new URLSearchParams({ limit: '500' });
  const room = document.querySelector('#history-room').value;
  const from = document.querySelector('#history-from').value;
  const to = document.querySelector('#history-to').value;
  if (from && to && from > to) {
    text('#history-note', 'Tanggal awal harus sama atau lebih awal dari tanggal akhir.');
    return;
  }
  text('#history-note', '');
  if (room) query.set('room', room);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  currentReadings = await getJSON(`/api/readings?${query}`);
  renderReadings(currentReadings.slice(-100), '#history-body');
}

window.pageRefresh = loadHistory;
document.querySelector('#history-filters').addEventListener('submit', event => {
  event.preventDefault();
  window.refreshPage();
});
document.querySelector('#download').addEventListener('click', () => {
  const rows = [['timestamp', 'room', 'vibration', 'smoke', 'temperature', 'gas'], ...currentReadings.map(item => [item.timestamp, item.room, item.vibration, item.smoke, item.temperature, item.gas])];
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  link.download = 'safeguard-history.csv';
  link.click();
  URL.revokeObjectURL(link.href);
});
