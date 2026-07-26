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
    expect(homepageHtml).toContain('Anesthesiology');
    expect(homepageHtml).toContain('specialty-chip-row');
    expect(homepageHtml).not.toContain('specialty-rotator');
    expect(homepageHtml).not.toContain('specialty-current');
  });

  it('includes Anesthesiology in landing-page search and social metadata', () => {
    expect(homepageHtml).toContain(
      '<title>MedSwipe | Medical Specialty Board Review</title>'
    );
    expect(homepageHtml).toMatch(
      /<meta name="description" content="[^"]*Anesthesiology[^"]*">/
    );
    expect(homepageHtml).toMatch(
      /<meta name="keywords" content="[^"]*anesthesiology board review[^"]*">/
    );
    expect(homepageHtml).toMatch(
      /<meta property="og:description" content="[^"]*Anesthesiology[^"]*">/
    );
    expect(homepageHtml).toMatch(
      /<meta property="twitter:description" content="[^"]*Anesthesiology[^"]*">/
    );
    expect(homepageHtml).toMatch(
      /"description": "Gamified Anesthesiology, Otolaryngology, Neurosurgery, and Urology board review platform/
    );
    expect(homepageHtml).not.toContain('"priceValidUntil": "2025-12-31"');
  });
});
