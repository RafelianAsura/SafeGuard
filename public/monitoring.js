const { getJSON, time, renderRoomOptions, renderReadings } = window.SafeGuard;
let chart;

window.pageRefresh = async dashboard => {
  const filter = document.querySelector('#room-filter');
  renderRoomOptions(dashboard.rooms, '#room-filter');
  const query = new URLSearchParams({ limit: '60' });
  if (filter.value) query.set('room', filter.value);
  const readings = await getJSON(`/api/readings?${query}`);
  if (chart) chart.destroy();
  chart = new Chart(document.querySelector('#sensor-chart').getContext('2d'), {
    type: 'line',
    data: {
      labels: readings.map(item => time(item.timestamp)),
      datasets: [
        { label: 'Vibration (g)', data: readings.map(item => item.vibration), borderColor: '#6f9fd0', backgroundColor: '#6f9fd020', tension: .35, pointRadius: 0, yAxisID: 'y' },
        { label: 'Smoke (ppm/scale)', data: readings.map(item => item.smoke), borderColor: '#ed9b50', backgroundColor: '#ed9b5020', tension: .35, pointRadius: 0, yAxisID: 'y1' },
        { label: 'Gas (ppm/scale)', data: readings.map(item => item.gas), borderColor: '#4fb48b', backgroundColor: '#4fb48b20', tension: .35, pointRadius: 0, yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 8, usePointStyle: true, padding: 18, font: { family: 'system-ui', size: 10 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: '#9ba8a6', font: { size: 10 } } },
        y: { position: 'left', grid: { color: '#edf1ef' }, ticks: { color: '#9ba8a6', font: { size: 10 } } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#9ba8a6', font: { size: 10 } } }
      }
    }
  });
  renderReadings(readings.slice(-15), '#live-body');
};

document.querySelector('#room-filter').addEventListener('change', () => window.refreshPage());
