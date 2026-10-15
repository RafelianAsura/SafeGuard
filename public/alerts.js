const { getJSON, text, renderAlerts, updateBadge } = window.SafeGuard;
let allAlerts = [];
let canLoadMore = false;

window.pageRefresh = async dashboard => {
  allAlerts = await getJSON('/api/alerts?limit=500');
  canLoadMore = allAlerts.length === 500;
  renderAlerts(allAlerts);
  document.querySelector('#load-more').hidden = !canLoadMore;
  text('#alert-summary', `${dashboard.alertCount} alerts`);
  updateBadge(dashboard.alertCount);
};

document.querySelector('#load-more').addEventListener('click', async () => {
  try {
    const next = await getJSON(`/api/alerts?limit=500&offset=${allAlerts.length}`);
    allAlerts = allAlerts.concat(next);
    canLoadMore = next.length === 500;
    renderAlerts(allAlerts);
    document.querySelector('#load-more').hidden = !canLoadMore;
  } catch (error) {
    window.SafeGuard.updateConnectionError();
    console.error(error);
  }
});
