import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const posRoot = path.resolve(scriptDirectory, '..');
const workspaceRoot = path.resolve(posRoot, '../../..');
const expectedElectronVersion = '44.7.2';
const expectedBetterSqliteVersion = '12.6.0';
const expectedPnpmVersion = '10.26.1';

function run(command, args, { cwd, capture = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && command.toLowerCase().startsWith('pnpm'),
    stdio: capture ? 'pipe' : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? result.stderr?.trim() : '';
    throw new Error(`${command} exited with ${result.status ?? result.signal}.${detail ? ` ${detail}` : ''}`);
  }
  return capture ? result.stdout.trim() : '';
}

function isExcludedFromStaging(sourcePath) {
  const relativePath = path.relative(workspaceRoot, sourcePath);
  if (!relativePath) return true;

  const parts = relativePath.split(path.sep);
  const excludedDirectories = new Set([
    '.git',
    '.local',
    '.agents',
    '.cache',
    '.upm',
    'attached_assets',
    'backups',
    'coverage',
    'generated-artifacts',
    'node_modules',
    'tmp',
  ]);
  if (parts.some(part => excludedDirectories.has(part.toLowerCase()))) return false;

  const posDistPath = path.join('artifacts', 'restaurant-pos', 'dist');
  if (relativePath === posDistPath || relativePath.startsWith(`${posDistPath}${path.sep}`)) return false;

  const name = parts.at(-1).toLowerCase();
  if (name === '.env' || name.startsWith('.env.')) return false;
  if (/\.(?:sqlite|sqlite3|db|db3)(?:-(?:wal|shm|journal))?$/i.test(name)) return false;
  if (/\.(?:bak|backup)$/i.test(name)) return false;
  return true;
}

async function hashIfPresent(filePath) {
  try {
    return createHash('sha256').update(await readFile(filePath)).digest('hex');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function assertWindowsX64Pe(filePath, bytes) {
  if (bytes.length < 70 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    throw new Error(`The rebuilt native addon is not a Windows PE file: ${filePath}`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset + 6 > bytes.length || bytes.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error(`The rebuilt native addon has an invalid PE header: ${filePath}`);
  }
  if (bytes.readUInt16LE(peOffset + 4) !== 0x8664) {
    throw new Error(`The rebuilt native addon is not Windows x64: ${filePath}`);
  }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Windows Electron preparation is Windows x64 only. No copy, install, or cross-build was attempted.');
  }

  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  if (nodeMajor !== 22 || nodeMinor < 12) {
    throw new Error(`Use Node.js 22.12 or newer in the 22.x line; found ${process.version}.`);
  }
  if (!process.env.LOCALAPPDATA) {
    throw new Error('LOCALAPPDATA is required for an isolated preparation directory.');
  }

  const pnpmVersion = run('pnpm', ['--version'], { cwd: workspaceRoot, capture: true });
  if (pnpmVersion !== expectedPnpmVersion) {
    throw new Error(`Use pnpm ${expectedPnpmVersion}; found ${pnpmVersion}.`);
  }

  const posPackage = JSON.parse(await readFile(path.join(posRoot, 'package.json'), 'utf8'));
  if (posPackage.devDependencies?.electron !== expectedElectronVersion) {
    throw new Error(`Expected Electron ${expectedElectronVersion} in the POS package manifest.`);
  }
  if (posPackage.dependencies?.['better-sqlite3'] !== expectedBetterSqliteVersion) {
    throw new Error(`Expected better-sqlite3 ${expectedBetterSqliteVersion} in the POS package manifest.`);
  }

  const sourceWebBuild = path.join(posRoot, 'dist', 'public');
  const sourceIndex = path.join(sourceWebBuild, 'index.html');
  await readFile(sourceIndex);

  const sourceCommit = run('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, capture: true });
  const sourceBranch = run('git', ['branch', '--show-current'], { cwd: workspaceRoot, capture: true });
  const sourceStatus = run('git', ['status', '--short'], { cwd: workspaceRoot, capture: true }) || '(clean)';
  const lockHash = await hashIfPresent(path.join(workspaceRoot, 'pnpm-lock.yaml'));
  if (!lockHash) throw new Error('The repository lockfile is missing.');

  const originalNodeAddon = path.join(posRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const originalNodeAddonHash = await hashIfPresent(originalNodeAddon);
  const preparationBase = path.resolve(process.env.LOCALAPPDATA, 'RestaurantPOS-ElectronPreparation');
  const relativePreparationBase = path.relative(workspaceRoot, preparationBase);
  if (relativePreparationBase && !relativePreparationBase.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePreparationBase)) {
    throw new Error('The preparation directory must be outside the project workspace.');
  }
  if (preparationBase === path.resolve(process.env.LOCALAPPDATA, 'JuniperPOS')) {
    throw new Error('The preparation directory must not overlap the restaurant data directory.');
  }

  await mkdir(preparationBase, { recursive: true });
  const stageRoot = await mkdtemp(path.join(preparationBase, `windows-x64-${sourceCommit.slice(0, 10)}-`));
  const stageWorkspace = path.join(stageRoot, 'workspace');
  const stagePosRoot = path.join(stageWorkspace, 'artifacts', 'restaurant-pos');

  await cp(workspaceRoot, stageWorkspace, {
    recursive: true,
    filter: isExcludedFromStaging,
  });
  await cp(sourceWebBuild, path.join(stagePosRoot, 'dist', 'public'), { recursive: true });

  const manifest = [
    'Restaurant POS isolated Electron preparation',
    `Source commit: ${sourceCommit}`,
    `Source branch: ${sourceBranch || '(detached)'}`,
    `Source working-tree status: ${sourceStatus}`,
    `pnpm-lock.yaml SHA-256: ${lockHash}`,
    `Node: ${process.version} (${process.arch})`,
    `Electron: ${expectedElectronVersion} (ABI 149)`,
    `better-sqlite3: ${expectedBetterSqliteVersion}`,
    `Target: win32-x64`,
    'The staged workspace excludes node_modules, attached_assets, environment files, database files, and backups.',
    'The POS was not launched. No restaurant database or backup was opened.',
    '',
  ].join('\n');
  await writeFile(path.join(stageRoot, 'PREPARATION.txt'), manifest, 'utf8');

  console.log(`Installing the frozen POS workspace in ${stageWorkspace}`);
  run('pnpm', ['install', '--frozen-lockfile', '--filter', '@workspace/restaurant-pos...'], {
    cwd: stageWorkspace,
  });

  try {
    console.log('Building better-sqlite3 for Electron 44.7.2, Windows x64, in the isolated staging copy.');
    run('pnpm', [
      '--filter',
      '@workspace/restaurant-pos',
      'exec',
      'electron-rebuild',
      '--force',
      '--which-module',
      'better-sqlite3',
      '--version',
      expectedElectronVersion,
      '--platform',
      'win32',
      '--arch',
      'x64',
      '--build-from-source',
    ], { cwd: stageWorkspace });
  } finally {
    const afterHash = await hashIfPresent(originalNodeAddon);
    if (afterHash !== originalNodeAddonHash) {
      throw new Error('The source checkout better-sqlite3 binary changed unexpectedly; do not use the Node launcher until it is restored.');
    }
  }

  const stagedAddon = path.join(stagePosRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const stagedBytes = await readFile(stagedAddon);
  assertWindowsX64Pe(stagedAddon, stagedBytes);
  const stagedHash = createHash('sha256').update(stagedBytes).digest('hex');

  console.log(`Prepared Windows x64 Electron addon at ${stagedAddon}`);
  console.log(`SHA-256: ${stagedHash}`);
  console.log(`Staging directory: ${stageRoot}`);
  console.log('The shared Node addon and Windows launcher were left unchanged. The POS was not launched.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
