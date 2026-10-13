import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPosHttpService } from './http-service.mjs';

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
const localDataRoot = process.env.POS_DATA_DIR
  || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'JuniperPOS') : '');
const staticDirectory = path.resolve(serverDirectory, '../dist/public');
const port = Number(process.env.POS_PORT || 4317);

if (!localDataRoot) {
  throw new Error('On Windows, LOCALAPPDATA is required. For local testing only, set POS_DATA_DIR to a writable folder.');
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('POS_PORT must be a port number between 0 and 65535.');
}

const service = await createPosHttpService({
  dataDir: localDataRoot,
  staticDir: staticDirectory,
  port,
});

console.log(`Restaurant POS local service is listening at http://127.0.0.1:${service.port}`);
console.log(`Register database: ${path.join(localDataRoot, 'restaurant-pos.sqlite')}`);
console.log(`Verified backups: ${service.backupDir}`);

const shutdown = async () => {
  try {
    await service.close();
    process.exit(0);
  } catch (error) {
    console.error('Could not close the local POS service cleanly:', error);
    process.exit(1);
  }
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
