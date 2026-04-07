import { constants as fsConstants } from 'node:fs';
import { access, lstat, open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoots = [
  'docs',
  'ios/App/App/public',
  'android/app/src/main/assets/public'
];
const forbiddenDirectories = new Set([
  'docs/node_modules',
  'ios/App/App/public/node_modules',
  'android/app/src/main/assets/public/node_modules'
]);
const forbiddenExtensions = new Set(['.node', '.dylib', '.so', '.a']);
const findings = [];

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function toRelative(targetPath) {
  return path.relative(repoRoot, targetPath) || '.';
}

function isMachO(buffer) {
  if (buffer.length < 4) {
    return false;
  }

  const magic = buffer.readUInt32BE(0);
  return new Set([
    0xfeedface,
    0xcefaedfe,
    0xfeedfacf,
    0xcffaedfe,
    0xcafebabe,
    0xbebafeca,
    0xcafed00d,
    0x0dd0feca
  ]).has(magic);
}

function isElf(buffer) {
  return buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46;
}

function isArchive(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).toString('utf8') === '!<arch>\n';
}

function isPortableExecutable(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a;
}

function hasShebang(buffer) {
  return buffer.length >= 2 && buffer[0] === 0x23 && buffer[1] === 0x21;
}

function isExecutableMode(mode) {
  return (mode & 0o111) !== 0;
}

async function readHeader(absolutePath, size = 32) {
  const fileHandle = await open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    const { bytesRead } = await fileHandle.read(buffer, 0, size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function inspectFile(absolutePath, relativePath, stats) {
  const extension = path.extname(relativePath).toLowerCase();
  if (forbiddenExtensions.has(extension)) {
    findings.push(`${relativePath}: forbidden native-library extension ${extension}`);
    return;
  }

  const firstBytes = await readHeader(absolutePath);

  if (isMachO(firstBytes)) {
    findings.push(`${relativePath}: Mach-O binary is not allowed in bundled web assets`);
    return;
  }

  if (isElf(firstBytes)) {
    findings.push(`${relativePath}: ELF binary is not allowed in bundled web assets`);
    return;
  }

  if (isPortableExecutable(firstBytes)) {
    findings.push(`${relativePath}: PE executable is not allowed in bundled web assets`);
    return;
  }

  if (isArchive(firstBytes)) {
    findings.push(`${relativePath}: static archive is not allowed in bundled web assets`);
    return;
  }

  if (isExecutableMode(stats.mode) && hasShebang(firstBytes)) {
    findings.push(`${relativePath}: executable script is not allowed in bundled web assets`);
  }
}

async function walkDirectory(relativeRoot) {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  if (!await pathExists(absoluteRoot)) {
    return;
  }

  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const dir = await opendir(current);

    for await (const entry of dir) {
      const entryPath = path.join(current, entry.name);
      const relativePath = toRelative(entryPath);

      if (entry.isDirectory()) {
        if (forbiddenDirectories.has(relativePath)) {
          findings.push(`${relativePath}: node_modules must never be copied into web assets`);
          continue;
        }

        stack.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = await lstat(entryPath);
      await inspectFile(entryPath, relativePath, stats);
    }
  }
}

for (const relativeRoot of scanRoots) {
  await walkDirectory(relativeRoot);
}

if (findings.length > 0) {
  console.error('Bundled web asset validation failed.');
  console.error('Remove Node tooling and native binaries from the Capacitor web assets before building.');
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log('Bundled web asset validation passed.');
