import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsDir = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(resolve(docsDir, 'styles.css'), 'utf8');

function cssRule(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

describe('onboarding mobile layout', () => {
  it('keeps the progress footer in flow below a scrollable content region', () => {
    const screenRule = cssRule('.onboarding-screen');
    const contentRule = cssRule('.onboarding-content');
    const progressRule = cssRule('.onboarding-progress-strip');

    expect(screenRule).toContain('height: 100dvh');
    expect(screenRule).toContain('flex-direction: column');
    expect(screenRule).toContain('overflow: hidden');
    expect(screenRule).toContain('env(safe-area-inset-bottom, 0px)');

    expect(contentRule).toContain('flex: 1 1 auto');
    expect(contentRule).toContain('min-height: 0');
    expect(contentRule).toContain('overflow-y: auto');

    expect(progressRule).toContain('position: static');
    expect(progressRule).toContain('flex: 0 0 auto');
    expect(progressRule).not.toContain('position: absolute');
    expect(progressRule).not.toContain('bottom:');
  });
});
