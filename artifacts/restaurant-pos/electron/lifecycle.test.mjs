import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { startElectronPos } from './lifecycle.mjs';

class FakeApp extends EventEmitter {
  constructor({ hasLock = true } = {}) {
    super();
    this.hasLock = hasLock;
    this.quitCalls = 0;
  }

  requestSingleInstanceLock() {
    return this.hasLock;
  }

  whenReady() {
    return Promise.resolve();
  }

  quit() {
    this.quitCalls += 1;
  }
}

class FakeWindow extends EventEmitter {
  constructor(options, events) {
    super();
    this.options = options;
    this.events = events;
    this.showCalls = 0;
    this.focusCalls = 0;
    this.events.push('window-created');
  }

  async loadURL(url) {
    this.events.push(`load:${url}`);
  }

  show() {
    this.showCalls += 1;
  }

  focus() {
    this.focusCalls += 1;
  }

  isMinimized() {
    return false;
  }
}

async function makeBuiltApp(t) {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), 'restaurant-pos-electron-'));
  const publicDir = path.join(appRoot, 'dist', 'public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html>');
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  return appRoot;
}

function makeDialog(errors) {
  return {
    showErrorBox(title, message) {
      errors.push({ title, message });
    },
  };
}

test('waits for the loopback SQLite service before opening a hardened window', async (t) => {
  const appRoot = await makeBuiltApp(t);
  const app = new FakeApp();
  const events = [];
  const errors = [];
  const windows = [];
  const serviceConfig = [];
  let closeCalls = 0;

  class Window extends FakeWindow {
    constructor(options) {
      super(options, events);
      windows.push(this);
    }
  }

  const lifecycle = startElectronPos({
    app,
    BrowserWindow: Window,
    dialog: makeDialog(errors),
    appRoot,
    env: { LOCALAPPDATA: 'C:\\Users\\POS\\AppData\\Local' },
    platform: 'win32',
    createPosHttpService: async (config) => {
      events.push('service-ready');
      serviceConfig.push(config);
      return { port: 43891, async close() { closeCalls += 1; } };
    },
  });

  await lifecycle.ready;

  assert.deepEqual(serviceConfig, [{
    dataDir: path.join('C:\\Users\\POS\\AppData\\Local', 'JuniperPOS'),
    staticDir: path.join(appRoot, 'dist', 'public'),
    port: 0,
  }]);
  assert.deepEqual(events, ['service-ready', 'window-created', 'load:http://127.0.0.1:43891/']);
  assert.deepEqual(windows[0].options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  });
  assert.equal(windows[0].options.show, false);
  assert.equal(windows[0].showCalls, 1);
  assert.deepEqual(errors, []);

  app.emit('second-instance');
  assert.equal(windows[0].focusCalls, 1);

  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  app.emit('before-quit', event);
  await lifecycle.shutdown();
  assert.equal(event.prevented, true);
  assert.equal(closeCalls, 1);
  assert.equal(app.quitCalls, 1);
});

test('reports missing static files and quits without starting the SQLite service', async (t) => {
  const appRoot = await mkdtemp(path.join(os.tmpdir(), 'restaurant-pos-electron-empty-'));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  const app = new FakeApp();
  const errors = [];
  let serviceStarts = 0;

  const lifecycle = startElectronPos({
    app,
    BrowserWindow: FakeWindow,
    dialog: makeDialog(errors),
    appRoot,
    env: { LOCALAPPDATA: 'C:\\Users\\POS\\AppData\\Local' },
    createPosHttpService: async () => {
      serviceStarts += 1;
      throw new Error('unexpected service start');
    },
  });

  await lifecycle.ready;
  assert.equal(serviceStarts, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /ENOENT/);
  assert.equal(app.quitCalls, 1);
});

test('closes the service and reports an error if the register window fails to load', async (t) => {
  const appRoot = await makeBuiltApp(t);
  const app = new FakeApp();
  const events = [];
  const errors = [];
  let closeCalls = 0;

  class BrokenWindow extends FakeWindow {
    async loadURL() {
      throw new Error('window load failed');
    }
  }

  const lifecycle = startElectronPos({
    app,
    BrowserWindow: class extends BrokenWindow {
      constructor(options) {
        super(options, events);
      }
    },
    dialog: makeDialog(errors),
    appRoot,
    env: { POS_DATA_DIR: '/tmp/restaurant-pos-test-data' },
    createPosHttpService: async () => ({
      port: 43100,
      async close() { closeCalls += 1; },
    }),
  });

  await lifecycle.ready;
  assert.equal(closeCalls, 1);
  assert.equal(lifecycle.service, null);
  assert.match(errors[0].message, /window load failed/);
  assert.equal(app.quitCalls, 1);
});

test('exits immediately when another POS instance owns the single-instance lock', async () => {
  const app = new FakeApp({ hasLock: false });
  let serviceStarts = 0;
  const lifecycle = startElectronPos({
    app,
    BrowserWindow: FakeWindow,
    dialog: makeDialog([]),
    appRoot: '/unused',
    createPosHttpService: async () => {
      serviceStarts += 1;
      throw new Error('should not start');
    },
  });

  await lifecycle.ready;
  assert.equal(app.quitCalls, 1);
  assert.equal(serviceStarts, 0);
});

test('reports a missing local data location instead of silently falling back', async (t) => {
  const appRoot = await makeBuiltApp(t);
  const app = new FakeApp();
  const errors = [];
  let serviceStarts = 0;

  const lifecycle = startElectronPos({
    app,
    BrowserWindow: FakeWindow,
    dialog: makeDialog(errors),
    appRoot,
    env: {},
    createPosHttpService: async () => {
      serviceStarts += 1;
      throw new Error('unexpected service start');
    },
  });

  await lifecycle.ready;
  assert.equal(serviceStarts, 0);
  assert.match(errors[0].message, /LOCALAPPDATA or POS_DATA_DIR/);
  assert.equal(app.quitCalls, 1);
});
