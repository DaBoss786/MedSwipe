import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const files = [
  ['node_modules/swiper/swiper-bundle.min.js', 'docs/vendor/swiper/swiper-bundle.min.js'],
  ['node_modules/swiper/swiper-bundle.min.css', 'docs/vendor/swiper/swiper-bundle.min.css'],
  ['node_modules/swiper/LICENSE', 'docs/vendor/swiper/LICENSE']
];

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

let failed = false;
for (const [sourceRelative, destinationRelative] of files) {
  const source = resolve(projectRoot, sourceRelative);
  const destination = resolve(projectRoot, destinationRelative);
  if (!existsSync(source)) {
    console.error(`Missing pinned vendor source: ${sourceRelative}`);
    failed = true;
    continue;
  }

  const sourceContents = readFileSync(source);
  if (checkOnly) {
    if (!existsSync(destination)) {
      console.error(`Missing tracked vendor asset: ${destinationRelative}`);
      failed = true;
      continue;
    }
    const destinationContents = readFileSync(destination);
    if (digest(sourceContents) !== digest(destinationContents)) {
      console.error(`Vendor asset is out of sync: ${destinationRelative}`);
      failed = true;
    }
    continue;
  }

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, sourceContents);
  console.log(`Synced ${destinationRelative}`);
}

if (failed) process.exitCode = 1;
if (checkOnly && !failed) console.log('Pinned web vendor assets are in sync.');
