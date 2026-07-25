// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyCasePrepDashboardLayout } from './dashboard-specialty-ui.js';

function setupDashboardActions() {
  document.body.innerHTML = `
    <div id="mainOptions">
      <div class="dashboard-start-section" style="display:flex;justify-content:center">
        <button id="startQuizBtn">Start Quiz</button>
      </div>
      <div class="dashboard-start-section" style="display:flex;justify-content:center">
        <button id="casePrepBtn">Case Prep</button>
      </div>
    </div>
  `;

  return {
    mainOptions: document.getElementById('mainOptions'),
    casePrepBtn: document.getElementById('casePrepBtn'),
    startQuizBtn: document.getElementById('startQuizBtn'),
    rows: document.querySelectorAll('.dashboard-start-section')
  };
}

describe('specialty dashboard actions', () => {
  let dashboard;

  beforeEach(() => {
    dashboard = setupDashboardActions();
  });

  it('centers Start Quiz as the only visible action when Case Prep is hidden', () => {
    applyCasePrepDashboardLayout({
      mainOptions: dashboard.mainOptions,
      casePrepBtn: dashboard.casePrepBtn,
      hideCme: true,
      casePrepMode: 'hidden'
    });

    expect(dashboard.startQuizBtn.style.display).not.toBe('none');
    expect(dashboard.casePrepBtn.style.display).toBe('none');
    expect(dashboard.rows[0].style.justifyContent).toBe('center');
    expect(dashboard.rows[1].style.display).toBe('none');
  });

  it.each(['default', 'coming_soon'])(
    'restores visible Case Prep for %s mode after it was hidden',
    (casePrepMode) => {
      applyCasePrepDashboardLayout({
        mainOptions: dashboard.mainOptions,
        casePrepBtn: dashboard.casePrepBtn,
        hideCme: true,
        casePrepMode: 'hidden'
      });

      applyCasePrepDashboardLayout({
        mainOptions: dashboard.mainOptions,
        casePrepBtn: dashboard.casePrepBtn,
        hideCme: true,
        casePrepMode
      });

      expect(dashboard.casePrepBtn.style.display).toBe('');
      expect(dashboard.casePrepBtn.parentElement).toBe(dashboard.rows[0]);
      expect(dashboard.rows[0].style.justifyContent).toBe('center');
      expect(dashboard.rows[1].style.display).toBe('none');
    }
  );

  it('keeps Case Prep in its secondary row when CME is visible', () => {
    applyCasePrepDashboardLayout({
      mainOptions: dashboard.mainOptions,
      casePrepBtn: dashboard.casePrepBtn,
      hideCme: false,
      casePrepMode: 'default'
    });

    expect(dashboard.casePrepBtn.style.display).toBe('');
    expect(dashboard.casePrepBtn.parentElement).toBe(dashboard.rows[1]);
    expect(dashboard.rows[1].style.display).toBe('flex');
  });
});
