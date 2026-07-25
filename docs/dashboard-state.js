export function activateDashboardRoot(mainOptions = null) {
  const dashboard = mainOptions || document.getElementById('mainOptions');
  if (!dashboard) {
    return null;
  }

  dashboard.style.display = 'flex';
  dashboard.style.pointerEvents = '';
  dashboard.removeAttribute('inert');
  dashboard.removeAttribute('aria-hidden');
  return dashboard;
}
