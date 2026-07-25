import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsDir = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(docsDir, 'index.html'), 'utf8');
const homepageHtml = readFileSync(resolve(docsDir, 'homepage.html'), 'utf8');

describe('specialty onboarding markup', () => {
  it('shows Urology as an enabled onboarding specialty', () => {
    expect(indexHtml).toContain('data-specialty="Urology"');
    expect(indexHtml).toMatch(/data-specialty="Urology"[^>]*>\s*Urology\s*<\/button>/);
    expect(indexHtml).not.toContain('data-specialty="Urology" disabled');
  });

  it('shows Anesthesiology as an enabled onboarding specialty', () => {
    expect(indexHtml).toContain('data-specialty="Anesthesiology"');
    expect(indexHtml).toMatch(
      /data-specialty="Anesthesiology"[^>]*>\s*Anesthesiology\s*<\/button>/
    );
    expect(indexHtml).not.toContain('data-specialty="Anesthesiology" disabled');
  });

  it('shows all supported specialties on the landing page without the hero rotator', () => {
    expect(homepageHtml).toContain('Otolaryngology');
    expect(homepageHtml).toContain('Neurosurgery');
    expect(homepageHtml).toContain('Urology');
    expect(homepageHtml).toContain('specialty-chip-row');
    expect(homepageHtml).not.toContain('specialty-rotator');
    expect(homepageHtml).not.toContain('specialty-current');
    expect(homepageHtml).not.toContain('Anesthesiology');
  });
});
