const { getJSON, text } = window.SafeGuard;
const fields = ['vibration', 'smoke', 'temperature', 'gas'];

window.pageRefresh = async dashboard => {
  fields.forEach(key => {
    document.querySelector(`#setting-${key}`).value = dashboard.settings[key];
  });
};

document.querySelector('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const settings = Object.fromEntries(fields.map(key => [key, Number(document.querySelector(`#setting-${key}`).value)]));
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = document.querySelector('#api-key').value.trim();
  if (apiKey) headers['x-api-key'] = apiKey;
  try {
    await getJSON('/api/settings', { method: 'PUT', headers, body: JSON.stringify(settings) });
    text('#settings-note', 'Settings tersimpan.');
    await window.refreshPage();
  } catch (error) {
    text('#settings-note', error.message === 'API request failed (401)' ? 'Settings gagal disimpan. Cek nilai threshold dan API key.' : 'Settings gagal disimpan. Cek koneksi backend dan nilai threshold.');
    if (error.message.includes('(5') || error instanceof TypeError) window.SafeGuard.updateConnectionError();
  }
});
