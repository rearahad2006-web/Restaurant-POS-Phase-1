import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const storageKey = 'juniper-pos.phase1.data.v1';
const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../..');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

globalThis.window = {};
const vite = await createServer({
  configFile: false,
  root: projectRoot,
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { middlewareMode: true },
});

const { BrowserLocalRepository } = await vite.ssrLoadModule('/src/storage/repository.ts');
const { downloadMigrationFile } = await vite.ssrLoadModule('/src/storage/local-service.ts');

after(async () => {
  await vite.close();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else delete globalThis.localStorage;
});

function installStorage(storage) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: storage,
  });
}

function createMemoryStorage(initialValue) {
  const values = new Map();
  const writes = [];
  if (initialValue !== undefined) values.set(storageKey, initialValue);

  return {
    writes,
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
}

test('genuinely empty browser storage still initializes first-run data', async () => {
  const storage = createMemoryStorage();
  installStorage(storage);

  const data = await new BrowserLocalRepository().load();

  assert.ok(data.settings.name);
  assert.ok(data.users.length > 0);
  assert.equal(storage.writes.length, 1);
  assert.equal(storage.writes[0][0], storageKey);
  assert.deepEqual(JSON.parse(storage.writes[0][1]), data);
});

test('browser storage access failure is explicit and does not seed or write data', async () => {
  let writes = 0;
  installStorage({
    getItem() {
      throw new Error('storage access denied');
    },
    setItem() {
      writes += 1;
    },
  });

  await assert.rejects(
    new BrowserLocalRepository().load(),
    /Could not access saved restaurant data.*No migration file was created/,
  );
  assert.equal(writes, 0);
});

test('malformed or structurally invalid stored values are preserved and never replaced by seed data', async t => {
  const invalidValues = [
    ['invalid JSON', '{not-json'],
    ['empty stored string', ''],
    ['non-object JSON', 'null'],
    ['invalid collection', JSON.stringify({ orders: 'not-an-array' })],
  ];

  for (const [label, rawValue] of invalidValues) {
    await t.test(label, async () => {
      const storage = createMemoryStorage(rawValue);
      installStorage(storage);

      await assert.rejects(
        new BrowserLocalRepository().load(),
        /Saved restaurant data.*(?:malformed|not a valid data object|field "orders" is malformed)/,
      );
      assert.equal(storage.getItem(storageKey), rawValue);
      assert.equal(storage.writes.length, 0);
    });
  }
});

test('migration export refuses to create a file when register data is unavailable', () => {
  assert.throws(
    () => downloadMigrationFile(null),
    /Register data has not been loaded safely; no migration file was created/,
  );
});
