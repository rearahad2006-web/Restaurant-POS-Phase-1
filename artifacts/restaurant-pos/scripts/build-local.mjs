import { build } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
process.env.VITE_POS_STORAGE_MODE = 'sqlite';
process.env.PORT ??= '5173';
process.env.BASE_PATH ??= '/';

await build({
  configFile: path.join(packageRoot, 'vite.config.ts'),
});
