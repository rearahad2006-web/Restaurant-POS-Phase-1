import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPosHttpService } from '../server/http-service.mjs';
import { startElectronPos } from './lifecycle.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

startElectronPos({
  app,
  BrowserWindow,
  dialog,
  createPosHttpService,
  appRoot,
});
