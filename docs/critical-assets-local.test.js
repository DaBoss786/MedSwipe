import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsDir = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(resolve(docsDir, 'index.html'), 'utf8');

describe('quiz-critical assets', () => {
  it('loads Swiper 8.4.7 from tracked local files', () => {
    expect(indexHtml).toContain('vendor/swiper/swiper-bundle.min.css');
    expect(indexHtml).toContain('vendor/swiper/swiper-bundle.min.js');
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/swiper/i);
    expect(existsSync(resolve(docsDir, 'vendor/swiper/swiper-bundle.min.css'))).toBe(true);
    expect(existsSync(resolve(docsDir, 'vendor/swiper/swiper-bundle.min.js'))).toBe(true);
    expect(existsSync(resolve(docsDir, 'vendor/swiper/LICENSE'))).toBe(true);
  });
});
