import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const buildScript = path.join(packageRoot, 'scripts', 'build-local.mjs');

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  }));
  return files.flat();
}

test('production assets exclude development sign-in credentials', async () => {
  const build = spawnSync(process.execPath, [buildScript], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(build.status, 0, 'the local production asset build must succeed');

  const outputDirectory = path.join(packageRoot, 'dist', 'public');
  const assetFiles = await listFiles(outputDirectory);
  assert.ok(assetFiles.length > 0, 'the production asset directory must not be empty');

  const assets = (await Promise.all(assetFiles.map(file => readFile(file, 'utf8')))).join('\n');
  assert.ok(
    !assets.includes('user-manager-dev') &&
      !assets.includes('user-cashier-1') &&
      !/password\s*:\s*["'](?:2468|1234)["']/.test(assets),
    'production assets must not contain development account IDs or PIN fields',
  );
});
