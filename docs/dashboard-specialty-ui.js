export function applyCasePrepDashboardLayout({
  mainOptions,
  casePrepBtn,
  hideCme,
  casePrepMode
}) {
  const dashboardRows = mainOptions
    ? mainOptions.querySelectorAll('.dashboard-start-section')
    : [];
  const primaryRow = dashboardRows[0] || null;
  const secondaryRow = dashboardRows[1] || null;

  if (!primaryRow || !secondaryRow || !casePrepBtn) {
    return;
  }

  const hideCasePrep = casePrepMode === 'hidden';
  casePrepBtn.textContent = 'Case Prep';
  casePrepBtn.style.display = hideCasePrep ? 'none' : '';
  primaryRow.style.justifyContent = 'center';

  if (hideCasePrep) {
    secondaryRow.style.display = 'none';
    return;
  }

  if (hideCme) {
    if (casePrepBtn.parentElement !== primaryRow) {
      primaryRow.appendChild(casePrepBtn);
    }
    secondaryRow.style.display = 'none';
    return;
  }

  if (casePrepBtn.parentElement !== secondaryRow) {
    secondaryRow.appendChild(casePrepBtn);
  }
  secondaryRow.style.display = 'flex';
}
