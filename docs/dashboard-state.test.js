// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activateDashboardRoot } from './dashboard-state.js';

const docsDir = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(resolve(docsDir, 'app.js'), 'utf8');

describe('dashboard interaction state', () => {
  it('restores a dashboard left inert by onboarding', () => {
    document.body.innerHTML = `
      <main
        id="mainOptions"
        style="display: none; pointer-events: none"
        inert
        aria-hidden="true"
      >
        <button id="startQuizBtn">Start Quiz</button>
      </main>
    `;

    const dashboard = activateDashboardRoot();

    expect(dashboard.style.display).toBe('flex');
    expect(dashboard.style.pointerEvents).toBe('');
    expect(dashboard.hasAttribute('inert')).toBe(false);
    expect(dashboard.hasAttribute('aria-hidden')).toBe(false);
  });

  it('routes the onboarding paywall exit through the interactive dashboard helper', () => {
    const handlerSource = appSource.slice(
      appSource.indexOf('function initializePaywallFreeAccessButton'),
      appSource.indexOf('// --- Quiz Setup Modal')
    );

    expect(handlerSource).toContain('const mainOptions = showDashboard()');
    expect(handlerSource).not.toContain('mainOptions.style.display = "flex"');
  });
});
