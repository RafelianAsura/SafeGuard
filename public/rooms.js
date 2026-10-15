const { text, renderRooms } = window.SafeGuard;

window.pageRefresh = dashboard => {
  text('#room-summary', `${dashboard.rooms.length} rooms monitored`);
  renderRooms(dashboard.rooms);
};
