import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const filename of ['package-lock.json', 'yarn.lock']) {
  rmSync(path.join(workspaceRoot, filename), { force: true });
}

const userAgent = process.env.npm_config_user_agent ?? '';
if (!userAgent.startsWith('pnpm/')) {
  console.error('Use pnpm instead.');
  process.exitCode = 1;
}
