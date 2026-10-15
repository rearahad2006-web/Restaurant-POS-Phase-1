import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createPosHttpService } from './http-service.mjs';
import {
  authenticateUser,
  closeRestaurantDatabase,
  createManagerAccount,
  getDataRevision,
  getBootstrapInfo,
  importLegacyBackup,
  loadAppData,
  openRestaurantDatabase,
  saveAppData,
} from './database.mjs';

const stamp = '2026-10-13T08:00:00.000Z';

export function makeFixture() {
  const payment = {
    id: 'payment-1',
    orderId: 'order-1',
    dateTime: stamp,
    createdAt: stamp,
    method: 'Cash',
    amount: 330,
    status: 'paid',
    amountReceived: 350,
    change: 20,
    reference: 'counter',
  };
  return {
    users: [
      { id: 'manager-1', name: 'Juniper Manager', username: 'manager', password: '2468', role: 'Manager', createdAt: stamp, developmentOnly: true },
      { id: 'cashier-1', name: 'Ayesha Khan', username: 'cashier', password: '1234', role: 'Cashier', createdAt: stamp, developmentOnly: true },
    ],
    settings: { id: 'restaurant-1', name: 'Juniper & Hearth', address: '18 Garden Lane', phone: '+92 300 555 0184', currency: 'PKR', receiptFooter: 'Thank you.', printWidth: 'narrow', compactDisplay: false, logoDataUrl: '' },
    tables: [{ id: 'table-1', name: 'Table 1', capacity: 4, createdAt: stamp, updatedAt: stamp }],
    categories: [{ id: 'category-1', name: 'Mains', sortOrder: 0, createdAt: stamp, updatedAt: stamp }],
    menuItems: [{ id: 'item-1', name: 'Chicken karahi', description: 'Tomato and ginger', price: 100, categoryId: 'category-1', available: true, createdAt: stamp, updatedAt: stamp }],
    deals: [{ id: 'deal-1', name: 'Lunch set', description: 'Lunch special', fixedPrice: 150, active: true, items: [{ menuItemId: 'item-1', quantity: 1, nameSnapshot: 'Chicken karahi' }], createdAt: stamp, updatedAt: stamp }],
    businessDays: [{ id: 'day-1', businessDate: '2026-10-13', startAt: stamp, startedBy: 'Juniper Manager', openingCash: 500, status: 'open' }],
    orders: [{
      id: 'order-1',
      orderNumber: 'JH-0001',
      createdAt: stamp,
      updatedAt: stamp,
      type: 'Dine-in',
      status: 'paid',
      tableId: 'table-1',
      tableNameSnapshot: 'Table 1',
      businessDayId: 'day-1',
      customerName: 'Sam',
      customerPhone: '+92 300 000 0000',
      subtotal: 350,
      discount: 20,
      deliveryCharge: 0,
      total: 330,
      cashierName: 'Ayesha Khan',
      items: [{ menuItemId: 'item-1', name: 'Chicken karahi', unitPrice: 100, quantity: 2, lineTotal: 200, note: 'Mild' }],
      deals: [{ dealId: 'deal-1', name: 'Lunch set', description: 'Lunch special', unitPrice: 150, quantity: 1, lineTotal: 150, items: [{ menuItemId: 'item-1', name: 'Chicken karahi', quantity: 1 }] }],
      payment,
    }],
    payments: [payment],
    expenses: [{ id: 'expense-1', dateTime: stamp, purpose: 'Produce', category: 'Food', quantity: 1, unitPrice: 75, total: 75, directTotal: true, paymentMethod: 'Cash', supplier: 'Market', notes: 'Daily vegetables', addedBy: 'Juniper Manager', createdAt: stamp, updatedAt: stamp, businessDayId: 'day-1' }],
  };
}

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function startServiceWithManager(t, directory) {
  const dataDir = path.join(directory, 'service-data');
  const service = await createPosHttpService({ dataDir, staticDir: directory, port: 0 });
  t.after(() => service.close());
  service.db.pragma('wal_autocheckpoint = 0');

  const source = makeFixture();
  source.users = source.users.map(user => ({ ...user, password: '', developmentOnly: false }));
  saveAppData(service.db, source);
  createManagerAccount(service.db, { name: 'Juniper Manager', username: 'manager', password: 'temporary-test-pin' });

  const base = `http://127.0.0.1:${service.port}`;
  const response = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'manager', password: 'temporary-test-pin' }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cookie, 'the temporary manager login should create a session');
  return { service, base, cookie, dataDir };
}

async function requestJson(base, route, { method = 'GET', cookie, body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.cookie = cookie;
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${base}${route}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    // Keep the raw response available for useful assertions when an endpoint is not JSON.
  }
  return { response, body: payload, text };
}

function sessionCookie(response) {
  return response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
}

function requestLocalWithHeaders(port, headers) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: '/api/bootstrap',
      headers,
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, text }));
    });
    request.on('error', reject);
    request.end();
  });
}

function databaseRecordCounts(db) {
  const tables = [
    'restaurant_settings',
    'users',
    'pos_tables',
    'categories',
    'menu_items',
    'deals',
    'deal_items',
    'business_days',
    'orders',
    'order_items',
    'order_deals',
    'order_deal_items',
    'payments',
    'expenses',
  ];
  return Object.fromEntries(tables.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

async function requestBackup(base, cookie) {
  const response = await fetch(`${base}/api/backup`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function requestRestore(base, cookie, backup, confirmed = true) {
  return fetch(`${base}/api/restore`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ filename: backup.filename, sha256: backup.sha256, confirmed }),
  });
}

function revisionHeader(response) {
  const revision = Number(response.headers.get('X-POS-Revision'));
  assert.ok(Number.isSafeInteger(revision) && revision >= 0, 'the API should return a valid revision header');
  return revision;
}

test('SQLite round-trips staff, register records and historical snapshots atomically', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-db-');
  const db = openRestaurantDatabase(path.join(directory, 'register.sqlite'));
  t.after(() => closeRestaurantDatabase(db));

  const source = makeFixture();
  saveAppData(db, source);
  const loaded = loadAppData(db);
  const countsBeforeFailure = databaseRecordCounts(db);

  assert.equal(loaded.settings.name, source.settings.name);
  assert.equal(loaded.menuItems[0].price, 100);
  assert.equal(loaded.users.find(user => user.id === 'manager-1').password, '');
  assert.equal(authenticateUser(db, 'manager', '2468', true).id, 'manager-1');
  assert.equal(authenticateUser(db, 'manager', '2468', false), null);
  assert.equal(loaded.orders[0].items[0].unitPrice, 100);
  assert.equal(loaded.orders[0].items[0].note, 'Mild');
  assert.deepEqual(loaded.orders[0].deals, source.orders[0].deals);
  assert.equal(loaded.orders[0].tableNameSnapshot, 'Table 1');
  assert.deepEqual(loaded.orders[0].payment, source.payments[0]);
  assert.deepEqual(loaded.payments[0], source.payments[0]);
  assert.equal(loaded.expenses[0].total, 75);

  db.exec(`
    CREATE TRIGGER reject_test_day BEFORE INSERT ON business_days
    WHEN NEW.id = 'fail-day'
    BEGIN SELECT RAISE(ABORT, 'forced test rollback'); END;
  `);
  const failing = {
    ...source,
    settings: { ...source.settings, name: 'This update must roll back' },
    businessDays: [...source.businessDays, { id: 'fail-day', businessDate: '2026-10-14', startAt: stamp, startedBy: 'Test', status: 'open' }],
  };
  assert.throws(() => saveAppData(db, failing), /forced test rollback/);
  assert.deepEqual(databaseRecordCounts(db), countsBeforeFailure);
  assert.deepEqual(loadAppData(db), loaded);
  assert.equal(loadAppData(db).settings.name, source.settings.name);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM business_days WHERE id = 'fail-day'").get().count, 0);
});

test('existing SQLite files without a sync revision are upgraded without changing register data', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-sync-revision-migration-');
  const databasePath = path.join(directory, 'register.sqlite');
  const original = makeFixture();
  const firstOpen = openRestaurantDatabase(databasePath);
  saveAppData(firstOpen, original);
  closeRestaurantDatabase(firstOpen);

  const migrationDb = new Database(databasePath);
  migrationDb.prepare("DELETE FROM app_meta WHERE key = 'data_revision'").run();
  migrationDb.close();

  const reopened = openRestaurantDatabase(databasePath);
  t.after(() => closeRestaurantDatabase(reopened));
  assert.equal(getDataRevision(reopened), 0);
  assert.equal(loadAppData(reopened).orders[0].id, original.orders[0].id);
  assert.equal(loadAppData(reopened).expenses[0].id, original.expenses[0].id);
});

test('legacy import verifies its source copy and is idempotent', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-import-');
  const db = openRestaurantDatabase(path.join(directory, 'register.sqlite'));
  t.after(() => closeRestaurantDatabase(db));

  const transfer = makeFixture();
  transfer.users = transfer.users.map(user => ({ ...user, password: '', developmentOnly: false }));
  const sourceText = JSON.stringify(transfer);
  const first = await importLegacyBackup(db, path.join(directory, 'backups'), sourceText);
  const countsAfterFirstImport = databaseRecordCounts(db);
  const second = await importLegacyBackup(db, path.join(directory, 'backups'), sourceText);

  assert.equal(first.alreadyImported, false);
  assert.equal(second.alreadyImported, true);
  assert.equal(first.sha256, second.sha256);
  assert.equal(first.backupPath, second.backupPath);
  assert.deepEqual(databaseRecordCounts(db), countsAfterFirstImport);
  assert.equal(await readFile(first.backupPath, 'utf8'), sourceText);
  assert.deepEqual(loadAppData(db).orders[0].deals, transfer.orders[0].deals);
  assert.equal(getBootstrapInfo(db, false).needsManagerSetup, true);
});

test('legacy import rejects a different backup once POS records exist', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-import-conflict-');
  const db = openRestaurantDatabase(path.join(directory, 'register.sqlite'));
  t.after(() => closeRestaurantDatabase(db));

  const transfer = makeFixture();
  transfer.users = transfer.users.map(user => ({ ...user, password: '', developmentOnly: false }));
  await importLegacyBackup(db, path.join(directory, 'backups'), JSON.stringify(transfer));
  const countsAfterFirstImport = databaseRecordCounts(db);

  const differentTransfer = structuredClone(transfer);
  differentTransfer.settings.name = 'Must not replace imported restaurant data';
  await assert.rejects(
    importLegacyBackup(db, path.join(directory, 'backups'), JSON.stringify(differentTransfer)),
    /This database already contains POS data/,
  );

  assert.deepEqual(databaseRecordCounts(db), countsAfterFirstImport);
  assert.equal(loadAppData(db).settings.name, transfer.settings.name);
});

test('manager setup reactivates a preserved manager account with a fresh PIN', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-manager-');
  const db = openRestaurantDatabase(path.join(directory, 'register.sqlite'));
  t.after(() => closeRestaurantDatabase(db));
  const source = makeFixture();
  source.users = source.users.map(user => ({ ...user, password: '', developmentOnly: false }));
  saveAppData(db, source);

  const manager = createManagerAccount(db, { name: 'Manager at Juniper', username: 'manager', password: 'new-pin-482' });
  assert.equal(manager.id, 'manager-1');
  assert.equal(manager.name, 'Manager at Juniper');
  assert.equal(authenticateUser(db, 'manager', '2468', false), null);
  assert.equal(authenticateUser(db, 'manager', 'new-pin-482', false).id, 'manager-1');
  assert.equal(getBootstrapInfo(db, false).needsManagerSetup, false);
});

test('verified backup includes WAL changes and restores all POS records intact', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-verified-backup-');
  const { service, base, cookie, dataDir } = await startServiceWithManager(t, directory);
  const walPath = path.join(dataDir, 'restaurant-pos.sqlite-wal');
  assert.ok((await stat(walPath)).size > 0, 'test data should include uncheckpointed WAL frames');

  const expected = loadAppData(service.db);
  const beforeCounts = databaseRecordCounts(service.db);
  const response = await fetch(`${base}/api/backup`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: '{}',
  });
  const backup = await response.json();
  assert.equal(response.status, 200, JSON.stringify(backup));
  const backupPath = path.join(service.backupDir, backup.filename);
  const backupBytes = await readFile(backupPath);
  assert.equal(createHash('sha256').update(backupBytes).digest('hex'), backup.sha256);

  const restoredPath = path.join(directory, 'restored.sqlite');
  await copyFile(backupPath, restoredPath);
  const restoredDb = new Database(restoredPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(restoredDb.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(restoredDb.pragma('foreign_key_check'), []);
    assert.deepEqual(databaseRecordCounts(restoredDb), beforeCounts);

    const restored = loadAppData(restoredDb);
    assert.deepEqual(restored, expected);
    assert.equal(restored.orders[0].subtotal, 350);
    assert.equal(restored.orders[0].total, 330);
    assert.equal(restored.orders[0].payment.orderId, restored.orders[0].id);
    assert.equal(restored.payments[0].amount, 330);
    assert.deepEqual(restored.orders[0].deals, expected.orders[0].deals);
    assert.deepEqual(restored.businessDays, expected.businessDays);
  } finally {
    restoredDb.close();
  }
});

test('invalid or interrupted backups are rejected without changing the valid database', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-failed-backup-');
  const { service, base, cookie } = await startServiceWithManager(t, directory);
  const originalData = loadAppData(service.db);
  const originalCounts = databaseRecordCounts(service.db);
  const realBackup = service.db.backup;
  const failedBackupWriters = [
    ['incomplete backup output', async target => {
      await writeFile(target, Buffer.concat([Buffer.from('SQLite format 3'), Buffer.from([0]), Buffer.from('incomplete')]));
    }],
    ['interrupted backup operation', async target => {
      await writeFile(target, Buffer.concat([Buffer.from('SQLite format 3'), Buffer.from([0]), Buffer.from('partial')]));
      throw new Error('simulated interrupted backup');
    }],
  ];

  try {
    for (const [scenario, writeFailedBackup] of failedBackupWriters) {
      service.db.backup = writeFailedBackup;
      const response = await fetch(`${base}/api/backup`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: '{}',
      });
      const result = await response.json();
      assert.equal(response.status, 500, scenario);
      assert.match(result.error, /Could not create a verified SQLite backup/, scenario);
      assert.deepEqual(await readdir(service.backupDir), [], `${scenario} must not leave a published or partial backup`);
      assert.deepEqual(databaseRecordCounts(service.db), originalCounts, `${scenario} must not change source rows`);
      assert.deepEqual(loadAppData(service.db), originalData, `${scenario} must not alter the valid database`);
    }
  } finally {
    service.db.backup = realBackup;
  }
});

test('manager restore replaces the live database from a verified backup and preserves historical records', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-restore-success-');
  const { service, base, cookie, dataDir } = await startServiceWithManager(t, directory);
  const expected = loadAppData(service.db);
  const sourceRevision = getDataRevision(service.db);
  const sourceBackup = await requestBackup(base, cookie);
  const sourceBackupDb = new Database(path.join(service.backupDir, sourceBackup.filename), { readonly: true, fileMustExist: true });
  try {
    assert.equal(getDataRevision(sourceBackupDb), sourceRevision, 'backup files should retain their source revision');
  } finally {
    sourceBackupDb.close();
  }
  assert.deepEqual(
    (await readdir(service.backupDir)).filter(name => /(?:-wal|-shm|-journal)$/.test(name)),
    [],
    'a verified backup should be a self-contained SQLite file without sidecars',
  );
  const listed = await fetch(`${base}/api/backups`, { headers: { cookie } });
  const listedBody = await listed.json();
  assert.equal(listed.status, 200, JSON.stringify(listedBody));
  assert.ok(listedBody.backups.some(backup => backup.filename === sourceBackup.filename && backup.sha256 === sourceBackup.sha256));

  const current = structuredClone(expected);
  current.settings.name = 'Unsaved current database state';
  current.orders[0].total = 301;
  current.payments[0].amount = 301;
  saveAppData(service.db, current);
  const currentSaved = loadAppData(service.db);
  const currentRevision = getDataRevision(service.db);
  assert.notDeepEqual(currentSaved, expected);
  assert.ok((await stat(path.join(dataDir, 'restaurant-pos.sqlite-wal'))).size > 0, 'the open database should contain WAL data');

  const unconfirmed = await requestRestore(base, cookie, sourceBackup, false);
  const unconfirmedBody = await unconfirmed.json();
  assert.equal(unconfirmed.status, 400, JSON.stringify(unconfirmedBody));
  assert.match(unconfirmedBody.error, /Confirm that you want to replace/);
  assert.deepEqual(loadAppData(service.db), currentSaved);
  assert.equal(getDataRevision(service.db), currentRevision, 'an unconfirmed restore must not change the revision');

  const response = await requestRestore(base, cookie, sourceBackup);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.restored, true);
  assert.ok(result.revision > currentRevision, 'restore must advance beyond the live revision even when the backup is older');
  assert.equal(getDataRevision(service.db), result.revision);
  assert.deepEqual(result.backup, { filename: sourceBackup.filename, sha256: sourceBackup.sha256 });
  assert.deepEqual(loadAppData(service.db), expected);
  assert.equal(loadAppData(service.db).orders[0].subtotal, 350);
  assert.equal(loadAppData(service.db).orders[0].total, 330);
  assert.equal(loadAppData(service.db).orders[0].payment.orderId, 'order-1');
  assert.equal(loadAppData(service.db).payments[0].amount, 330);
  assert.deepEqual(loadAppData(service.db).orders[0].deals, expected.orders[0].deals);
  assert.deepEqual(loadAppData(service.db).businessDays, expected.businessDays);

  const reopenedDb = new Database(path.join(dataDir, 'restaurant-pos.sqlite'), { readonly: true, fileMustExist: true });
  try {
    assert.equal(reopenedDb.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(loadAppData(reopenedDb), expected, 'a new SQLite connection should see the restored records');
    assert.equal(getDataRevision(reopenedDb), result.revision);
  } finally {
    reopenedDb.close();
  }

  const safetyPath = path.join(service.backupDir, result.safetyBackup.filename);
  const safetyBytes = await readFile(safetyPath);
  assert.equal(createHash('sha256').update(safetyBytes).digest('hex'), result.safetyBackup.sha256);
  const safetyDb = new Database(safetyPath, { readonly: true, fileMustExist: true });
  try {
    assert.equal(safetyDb.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(loadAppData(safetyDb), currentSaved);
    assert.equal(getDataRevision(safetyDb), currentRevision, 'the automatic safety backup should retain the live pre-restore revision');
  } finally {
    safetyDb.close();
  }

  const sessionResponse = await fetch(`${base}/api/session`, { headers: { cookie } });
  assert.deepEqual(await sessionResponse.json(), { user: null }, 'restore must require a fresh sign-in');
  const refreshedLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'manager', password: 'temporary-test-pin' },
  });
  assert.equal(refreshedLogin.response.status, 200, JSON.stringify(refreshedLogin.body));
  const refreshedCookie = sessionCookie(refreshedLogin.response);
  const refreshedSnapshot = await requestJson(base, '/api/data', { cookie: refreshedCookie });
  assert.equal(refreshedSnapshot.response.status, 200);
  assert.equal(revisionHeader(refreshedSnapshot.response), result.revision);
  assert.deepEqual(refreshedSnapshot.body, expected, 'a newly signed-in client should load the restored snapshot');
  assert.deepEqual((await readdir(dataDir)).filter(name => name.startsWith('.restore-')), [], 'staging database and SQLite sidecars must be removed');
});

test('corrupt and incompatible backups are rejected before live data or safety backups change', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-restore-invalid-');
  const { service, base, cookie } = await startServiceWithManager(t, directory);
  const original = loadAppData(service.db);
  const originalRevision = getDataRevision(service.db);
  const sourceBackup = await requestBackup(base, cookie);

  const corruptName = 'restaurant-pos-2026-10-13T08-00-00-000Z-deadbeef.sqlite';
  const corruptPath = path.join(service.backupDir, corruptName);
  await writeFile(corruptPath, Buffer.from('not a SQLite database'), { mode: 0o600 });
  const corruptBytes = await readFile(corruptPath);
  const corrupt = { filename: corruptName, sha256: createHash('sha256').update(corruptBytes).digest('hex') };

  const incompatibleName = 'restaurant-pos-2026-10-13T08-00-00-000Z-feedcafe.sqlite';
  const incompatiblePath = path.join(service.backupDir, incompatibleName);
  await copyFile(path.join(service.backupDir, sourceBackup.filename), incompatiblePath);
  const incompatibleDb = new Database(incompatiblePath);
  incompatibleDb.pragma('journal_mode = DELETE');
  incompatibleDb.pragma('user_version = 999');
  incompatibleDb.close();
  const incompatibleBytes = await readFile(incompatiblePath);
  const incompatible = { filename: incompatibleName, sha256: createHash('sha256').update(incompatibleBytes).digest('hex') };

  for (const backup of [corrupt, incompatible]) {
    const response = await requestRestore(base, cookie, backup);
    const body = await response.json();
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match(body.error, /could not be verified/);
    assert.deepEqual(loadAppData(service.db), original);
    assert.equal(getDataRevision(service.db), originalRevision);
  }

  const listedResponse = await fetch(`${base}/api/backups`, { headers: { cookie } });
  const listedBody = await listedResponse.json();
  assert.deepEqual(listedBody.backups.map(backup => backup.filename), [sourceBackup.filename]);
  const backupFiles = (await readdir(service.backupDir)).filter(name => name.endsWith('.sqlite')).sort();
  assert.deepEqual(backupFiles, [sourceBackup.filename, corruptName, incompatibleName].sort(), 'invalid inputs must not produce a safety backup');
  assert.deepEqual(
    (await readdir(service.backupDir)).filter(name => /(?:-wal|-shm|-journal)$/.test(name)),
    [],
    'verification should not leave SQLite sidecars',
  );
});

test('a failed restore rolls back all changes and retains the verified safety backup', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-restore-rollback-');
  const { service, base, cookie, dataDir } = await startServiceWithManager(t, directory);
  const sourceBackup = await requestBackup(base, cookie);
  const current = loadAppData(service.db);
  current.settings.name = 'Current data that must survive a failed restore';
  current.orders[0].total = 321;
  current.payments[0].amount = 321;
  saveAppData(service.db, current);
  const expectedCurrent = loadAppData(service.db);
  const currentRevision = getDataRevision(service.db);
  const expectedCounts = databaseRecordCounts(service.db);
  service.db.exec(`
    CREATE TRIGGER fail_restore_insert
    BEFORE INSERT ON orders
    BEGIN SELECT RAISE(ABORT, 'simulated restore failure'); END;
  `);

  const response = await requestRestore(base, cookie, sourceBackup);
  const body = await response.json();
  assert.equal(response.status, 500, JSON.stringify(body));
  assert.match(body.error, /original data was preserved/);
  assert.deepEqual(loadAppData(service.db), expectedCurrent);
  assert.deepEqual(databaseRecordCounts(service.db), expectedCounts);
  assert.equal(getDataRevision(service.db), currentRevision, 'a failed restore must not advance or roll back the revision');

  const backupsResponse = await fetch(`${base}/api/backups`, { headers: { cookie } });
  const backupsBody = await backupsResponse.json();
  assert.equal(backupsResponse.status, 200);
  assert.equal(backupsBody.backups.length, 2, 'the original restore source and the safety backup should remain verified');
  const safetyBackup = backupsBody.backups.find(backup => backup.filename !== sourceBackup.filename);
  assert.ok(safetyBackup);
  assert.deepEqual((await readFile(path.join(service.backupDir, safetyBackup.filename))).length, safetyBackup.size);
  const safetyDb = new Database(path.join(service.backupDir, safetyBackup.filename), { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(loadAppData(safetyDb), expectedCurrent);
    assert.equal(getDataRevision(safetyDb), currentRevision, 'the safety backup should retain its revision on failed restore');
  } finally {
    safetyDb.close();
  }
  assert.deepEqual((await readdir(dataDir)).filter(name => name.startsWith('.restore-')), []);
});

test('cashier accounts cannot list or restore SQLite backups', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-restore-manager-only-');
  const { service, base } = await startServiceWithManager(t, directory);
  const data = loadAppData(service.db);
  data.users = data.users.map(user => user.id === 'cashier-1' ? { ...user, password: 'temporary-cashier-pin' } : user);
  saveAppData(service.db, data);

  const loginResponse = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'cashier', password: 'temporary-cashier-pin' }),
  });
  const loginBody = await loginResponse.json();
  assert.equal(loginResponse.status, 200, JSON.stringify(loginBody));
  const cashierCookie = loginResponse.headers.get('set-cookie')?.split(';', 1)[0];
  assert.ok(cashierCookie);

  const listResponse = await fetch(`${base}/api/backups`, { headers: { cookie: cashierCookie } });
  assert.equal(listResponse.status, 403);
  assert.match((await listResponse.json()).error, /Manager access is required/);
  const restoreResponse = await fetch(`${base}/api/restore`, {
    method: 'POST',
    headers: { cookie: cashierCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(restoreResponse.status, 403);
  assert.match((await restoreResponse.json()).error, /Manager access is required/);
});

test('local service starts in SQLite mode on loopback and gates a new database behind import', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-local-runtime-');
  const dataDir = path.join(directory, 'fresh-data');
  const service = await createPosHttpService({ dataDir, staticDir: directory, port: 0 });
  t.after(() => service.close());

  assert.equal(service.server.address().address, '127.0.0.1');
  const base = `http://127.0.0.1:${service.port}`;
  const runtime = await fetch(`${base}/runtime-config.js`);
  assert.equal(runtime.status, 200);
  assert.match(await runtime.text(), /__RESTAURANT_POS_STORAGE__ = "sqlite"/);

  const bootstrap = await requestJson(base, '/api/bootstrap');
  assert.equal(bootstrap.response.status, 200);
  assert.equal(bootstrap.body.initialized, false);
  assert.equal(bootstrap.body.needsImport, true);
  assert.equal(bootstrap.body.needsManagerSetup, false);

  const defaultLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'manager', password: '2468' },
  });
  assert.equal(defaultLogin.response.status, 401, 'a new SQLite database must not fall back to seeded browser accounts');
  const unauthenticatedData = await requestJson(base, '/api/data');
  assert.equal(unauthenticatedData.response.status, 401);

  const port = service.port;
  const badHost = await requestLocalWithHeaders(port, { host: `remote.example:${port}` });
  assert.equal(badHost.status, 403);
  const badOrigin = await requestLocalWithHeaders(port, {
    host: `127.0.0.1:${port}`,
    origin: 'https://remote.example',
  });
  assert.equal(badOrigin.status, 403);
});

test('local startup refuses damaged or incompatible SQLite files without changing them', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-startup-safety-');
  const staticDir = directory;
  const serviceOptions = dataDir => ({ dataDir, staticDir, port: 0 });

  const emptyDir = path.join(directory, 'empty-data');
  await mkdir(emptyDir);
  const emptyPath = path.join(emptyDir, 'restaurant-pos.sqlite');
  await writeFile(emptyPath, Buffer.alloc(0));
  await assert.rejects(createPosHttpService(serviceOptions(emptyDir)), /database file is empty/);
  assert.equal((await stat(emptyPath)).size, 0, 'an existing empty file must not be initialized');

  const corruptDir = path.join(directory, 'corrupt-data');
  await mkdir(corruptDir);
  const corruptPath = path.join(corruptDir, 'restaurant-pos.sqlite');
  const corruptBytes = Buffer.from('not a SQLite database');
  await writeFile(corruptPath, corruptBytes);
  await assert.rejects(createPosHttpService(serviceOptions(corruptDir)), /not a database/);
  assert.deepEqual(await readFile(corruptPath), corruptBytes);

  const unversionedDir = path.join(directory, 'unversioned-data');
  await mkdir(unversionedDir);
  const unversionedPath = path.join(unversionedDir, 'restaurant-pos.sqlite');
  const unversionedDb = new Database(unversionedPath);
  unversionedDb.exec('CREATE TABLE legacy_data (value TEXT)');
  unversionedDb.close();
  const unversionedBytes = await readFile(unversionedPath);
  await assert.rejects(createPosHttpService(serviceOptions(unversionedDir)), /no supported schema version/);
  assert.deepEqual(await readFile(unversionedPath), unversionedBytes);

  const missingTableDir = path.join(directory, 'missing-table-data');
  await mkdir(missingTableDir);
  const missingTablePath = path.join(missingTableDir, 'restaurant-pos.sqlite');
  const missingTableDb = openRestaurantDatabase(missingTablePath);
  missingTableDb.exec('DROP TABLE users');
  closeRestaurantDatabase(missingTableDb);
  const missingTableBytes = await readFile(missingTablePath);
  await assert.rejects(createPosHttpService(serviceOptions(missingTableDir)), /database does not contain the expected Restaurant POS tables/);
  assert.deepEqual(await readFile(missingTablePath), missingTableBytes, 'startup must not recreate a missing staff table');

  const futureDir = path.join(directory, 'future-schema-data');
  await mkdir(futureDir);
  const futurePath = path.join(futureDir, 'restaurant-pos.sqlite');
  const futureDb = openRestaurantDatabase(futurePath);
  futureDb.pragma('journal_mode = DELETE');
  futureDb.pragma('user_version = 999');
  closeRestaurantDatabase(futureDb);
  const futureBytes = await readFile(futurePath);
  await assert.rejects(createPosHttpService(serviceOptions(futureDir)), /schema version 999 is newer/);
  assert.deepEqual(await readFile(futurePath), futureBytes, 'a newer schema must be rejected before changing journal mode');
});

test('a missing live database with verified backups does not initialize an empty register', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-missing-live-database-');
  const dataDir = path.join(directory, 'service-data');
  let service = await createPosHttpService({ dataDir, staticDir: directory, port: 0 });
  t.after(async () => {
    if (service) await service.close();
  });

  const source = makeFixture();
  source.users = source.users.map(user => ({ ...user, password: '', developmentOnly: false }));
  saveAppData(service.db, source);
  createManagerAccount(service.db, { name: 'Juniper Manager', username: 'manager', password: 'temporary-test-pin' });
  const base = `http://127.0.0.1:${service.port}`;
  const login = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'manager', password: 'temporary-test-pin' },
  });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  const backup = await requestBackup(base, sessionCookie(login.response));
  const backupDir = path.join(dataDir, 'backups');
  assert.ok((await stat(path.join(backupDir, backup.filename))).size > 0);

  await service.close();
  service = null;
  const databasePath = path.join(dataDir, 'restaurant-pos.sqlite');
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    await rm(`${databasePath}${suffix}`, { force: true });
  }

  let unexpectedService;
  try {
    unexpectedService = await createPosHttpService({ dataDir, staticDir: directory, port: 0 });
  } catch (error) {
    assert.match(error.message, /database is missing but verified backups exist/);
  }
  if (unexpectedService) {
    await unexpectedService.close();
    assert.fail('startup must not replace a missing live database when verified backups are available');
  }
  await assert.rejects(stat(databasePath), { code: 'ENOENT' });
  assert.ok((await readdir(backupDir)).includes(backup.filename), 'the verified backup should remain available for recovery');
});

test('manager setup, manager and cashier sign-in, failed saves, and register data survive a service restart', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-restart-runtime-');
  const dataDir = path.join(directory, 'service-data');
  let service = await createPosHttpService({ dataDir, staticDir: directory, port: 0 });
  t.after(async () => {
    if (service) await service.close();
  });
  let base = `http://127.0.0.1:${service.port}`;

  const source = makeFixture();
  source.users = source.users.map(user => ({ ...user, password: '', developmentOnly: false }));
  const imported = await requestJson(base, '/api/import', { method: 'POST', body: source });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.bootstrap.needsManagerSetup, true);

  const setup = await requestJson(base, '/api/manager-setup', {
    method: 'POST',
    body: { name: 'Juniper Manager', username: 'manager', password: 'runtime-manager-pin' },
  });
  assert.equal(setup.response.status, 200, JSON.stringify(setup.body));
  assert.equal(setup.body.user.role, 'Manager');
  assert.ok(sessionCookie(setup.response), 'manager setup should issue a local session');

  const managerLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'manager', password: 'runtime-manager-pin' },
  });
  assert.equal(managerLogin.response.status, 200, JSON.stringify(managerLogin.body));
  assert.equal(managerLogin.body.user.role, 'Manager');
  const managerCookie = sessionCookie(managerLogin.response);
  assert.ok(managerCookie);

  const loaded = await requestJson(base, '/api/data', { cookie: managerCookie });
  assert.equal(loaded.response.status, 200);
  const loadedRevision = revisionHeader(loaded.response);
  const data = loaded.body;
  data.settings.name = 'Restart Test Restaurant';
  data.settings.address = 'Temporary runtime-test address';
  data.users = data.users.map(user => user.id === 'cashier-1'
    ? { ...user, password: 'runtime-cashier-pin' }
    : user);

  const secondOrder = structuredClone(data.orders[0]);
  secondOrder.id = 'order-runtime-2';
  secondOrder.orderNumber = 'JH-0002';
  secondOrder.createdAt = '2026-10-14T09:00:00.000Z';
  secondOrder.updatedAt = '2026-10-14T09:00:00.000Z';
  secondOrder.customerName = 'Restart Test Guest';
  secondOrder.subtotal = 125;
  secondOrder.discount = 0;
  secondOrder.total = 125;
  secondOrder.items = [{ ...secondOrder.items[0], unitPrice: 125, quantity: 1, lineTotal: 125 }];
  secondOrder.deals = [];
  const secondPayment = {
    ...data.payments[0],
    id: 'payment-runtime-2',
    orderId: secondOrder.id,
    dateTime: '2026-10-14T09:00:00.000Z',
    createdAt: '2026-10-14T09:00:00.000Z',
    amount: 125,
    amountReceived: 150,
    change: 25,
    reference: 'restart-test',
  };
  secondOrder.payment = secondPayment;
  data.orders.push(secondOrder);
  data.payments.push(secondPayment);

  const saved = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: managerCookie,
    headers: { 'X-POS-Revision': String(loadedRevision) },
    body: data,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.revision, loadedRevision + 1);
  assert.equal(revisionHeader(saved.response), saved.body.revision);
  const expected = await requestJson(base, '/api/data', { cookie: managerCookie });
  assert.equal(expected.response.status, 200);
  const expectedRevision = revisionHeader(expected.response);
  assert.equal(expected.body.settings.name, 'Restart Test Restaurant');
  assert.ok(expected.body.orders.some(order => order.id === secondOrder.id));
  assert.ok(expected.body.payments.some(payment => payment.id === secondPayment.id));

  service.db.exec(`
    CREATE TRIGGER reject_runtime_settings_update
    BEFORE UPDATE ON restaurant_settings
    BEGIN
      SELECT RAISE(ABORT, 'simulated runtime save failure');
    END;
  `);
  const rejectedData = structuredClone(expected.body);
  rejectedData.settings.address = 'This failed change must not be saved';
  const failedSave = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: managerCookie,
    headers: { 'X-POS-Revision': String(expectedRevision) },
    body: rejectedData,
  });
  assert.equal(failedSave.response.status, 500);
  assert.match(failedSave.body.error, /simulated runtime save failure/);
  const afterFailedSave = await requestJson(base, '/api/data', { cookie: managerCookie });
  assert.deepEqual(afterFailedSave.body, expected.body, 'a failed request must not overwrite the last saved register state');
  assert.equal(revisionHeader(afterFailedSave.response), expectedRevision, 'a rolled-back save must not advance the revision');
  service.db.exec('DROP TRIGGER reject_runtime_settings_update');

  const cashierLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'cashier', password: 'runtime-cashier-pin' },
  });
  assert.equal(cashierLogin.response.status, 200, JSON.stringify(cashierLogin.body));
  assert.equal(cashierLogin.body.user.role, 'Cashier');
  const cashierCookie = sessionCookie(cashierLogin.response);
  assert.ok(cashierCookie);
  const cashierData = structuredClone(expected.body);
  cashierData.settings.phone = '+92 300 000 0000';
  const cashierRestrictedSave = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: cashierCookie,
    body: cashierData,
  });
  assert.equal(cashierRestrictedSave.response.status, 403);
  assert.match(cashierRestrictedSave.body.error, /Cashier accounts cannot change/);

  await service.close();
  service = await createPosHttpService({ dataDir, staticDir: directory, port: 0 });
  base = `http://127.0.0.1:${service.port}`;

  const staleManagerSession = await requestJson(base, '/api/data', { cookie: managerCookie });
  assert.equal(staleManagerSession.response.status, 401, 'service restart should invalidate prior sessions');
  const staleCashierSession = await requestJson(base, '/api/data', { cookie: cashierCookie });
  assert.equal(staleCashierSession.response.status, 401, 'service restart should invalidate cashier sessions too');

  const restartedManagerLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'manager', password: 'runtime-manager-pin' },
  });
  assert.equal(restartedManagerLogin.response.status, 200, JSON.stringify(restartedManagerLogin.body));
  assert.equal(restartedManagerLogin.body.user.role, 'Manager');
  const restartedManagerCookie = sessionCookie(restartedManagerLogin.response);
  const reloaded = await requestJson(base, '/api/data', { cookie: restartedManagerCookie });
  assert.equal(reloaded.response.status, 200);
  assert.deepEqual(reloaded.body, expected.body, 'settings, orders, payments, and historical records should persist across restart');
  assert.equal(revisionHeader(reloaded.response), expectedRevision, 'data revision should persist across restart');

  const restartedCashierLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'cashier', password: 'runtime-cashier-pin' },
  });
  assert.equal(restartedCashierLogin.response.status, 200, JSON.stringify(restartedCashierLogin.body));
  assert.equal(restartedCashierLogin.body.user.role, 'Cashier');
});

test('stale full snapshots are rejected atomically and a fresh client saves at the new revision', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-stale-snapshot-');
  const { service, base, cookie: managerCookie } = await startServiceWithManager(t, directory);
  const secondLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'manager', password: 'temporary-test-pin' },
  });
  assert.equal(secondLogin.response.status, 200);
  const secondManagerCookie = sessionCookie(secondLogin.response);

  const clientA = await requestJson(base, '/api/data', { cookie: managerCookie });
  const clientB = await requestJson(base, '/api/data', { cookie: secondManagerCookie });
  const startingRevision = revisionHeader(clientA.response);
  assert.equal(revisionHeader(clientB.response), startingRevision, 'both sessions start at the same revision');

  const missingRevision = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: managerCookie,
    body: clientA.body,
  });
  assert.equal(missingRevision.response.status, 428);
  const afterMissingRevision = await requestJson(base, '/api/data', { cookie: managerCookie });
  assert.equal(revisionHeader(afterMissingRevision.response), startingRevision);
  assert.deepEqual(afterMissingRevision.body, clientA.body, 'a request without a revision must not change register data');

  const fromA = structuredClone(clientA.body);
  fromA.orders[0].status = 'cancelled';
  fromA.orders[0].updatedAt = '2026-10-14T11:00:00.000Z';
  fromA.payments[0].status = 'cancelled';
  fromA.orders[0].payment.status = 'cancelled';
  fromA.expenses.push({
    ...fromA.expenses[0],
    id: 'expense-client-a',
    purpose: 'Saved by client A',
    createdAt: '2026-10-14T11:01:00.000Z',
    updatedAt: '2026-10-14T11:01:00.000Z',
  });
  const newOrder = structuredClone(fromA.orders[0]);
  newOrder.id = 'order-client-a';
  newOrder.orderNumber = 'JH-0002';
  newOrder.createdAt = '2026-10-14T11:02:00.000Z';
  newOrder.updatedAt = newOrder.createdAt;
  newOrder.status = 'paid';
  newOrder.subtotal = 125;
  newOrder.discount = 0;
  newOrder.total = 125;
  newOrder.items = [{ ...newOrder.items[0], unitPrice: 125, quantity: 1, lineTotal: 125 }];
  newOrder.deals = [];
  const newPayment = {
    ...fromA.payments[0],
    id: 'payment-client-a',
    orderId: newOrder.id,
    dateTime: newOrder.createdAt,
    createdAt: newOrder.createdAt,
    amount: 125,
    status: 'paid',
  };
  newOrder.payment = newPayment;
  fromA.orders.push(newOrder);
  fromA.payments.push(newPayment);

  const savedByA = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: managerCookie,
    headers: { 'X-POS-Revision': String(startingRevision) },
    body: fromA,
  });
  assert.equal(savedByA.response.status, 200, JSON.stringify(savedByA.body));
  assert.equal(savedByA.body.revision, startingRevision + 1);

  const staleFromB = structuredClone(clientB.body);
  staleFromB.orders[0].status = 'paid';
  staleFromB.orders[0].total = 999;
  staleFromB.orders[0].payment.status = 'paid';
  staleFromB.orders[0].payment.amount = 999;
  staleFromB.payments[0].status = 'paid';
  staleFromB.payments[0].amount = 999;
  staleFromB.expenses[0].total = 999;
  const duplicateAttempt = structuredClone(newOrder);
  duplicateAttempt.id = 'order-client-b';
  duplicateAttempt.payment = { ...newPayment, id: 'payment-client-b', orderId: duplicateAttempt.id };
  staleFromB.orders.push(duplicateAttempt);
  staleFromB.payments.push(duplicateAttempt.payment);

  const rejectedByRevision = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: secondManagerCookie,
    headers: { 'X-POS-Revision': String(startingRevision) },
    body: staleFromB,
  });
  assert.equal(rejectedByRevision.response.status, 409);
  assert.equal(rejectedByRevision.body.code, 'DATA_REVISION_CONFLICT');
  assert.equal(rejectedByRevision.body.revision, startingRevision + 1);

  const afterConflict = await requestJson(base, '/api/data', { cookie: secondManagerCookie });
  assert.equal(revisionHeader(afterConflict.response), startingRevision + 1);
  assert.deepEqual(afterConflict.body, fromA, 'a stale request must not apply any fields or records');
  const revisionEndpoint = await requestJson(base, '/api/revision', { cookie: secondManagerCookie });
  assert.equal(revisionEndpoint.response.status, 200);
  assert.equal(revisionEndpoint.body.revision, startingRevision + 1);
  assert.equal(afterConflict.body.orders.length, clientA.body.orders.length + 1, 'the rejected second checkout must not duplicate an order');
  assert.equal(afterConflict.body.payments.length, clientA.body.payments.length + 1, 'the rejected second checkout must not duplicate a payment');
  assert.ok(afterConflict.body.expenses.some(expense => expense.id === 'expense-client-a'), 'a stale expense snapshot must not delete a newer expense');

  const fresh = structuredClone(afterConflict.body);
  fresh.expenses.push({
    ...fresh.expenses[0],
    id: 'expense-fresh-client',
    purpose: 'Saved by the fresh client',
  });
  const freshSave = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: secondManagerCookie,
    headers: { 'X-POS-Revision': String(revisionHeader(afterConflict.response)) },
    body: fresh,
  });
  assert.equal(freshSave.response.status, 200, JSON.stringify(freshSave.body));
  assert.equal(freshSave.body.revision, startingRevision + 2);
  assert.ok(loadAppData(service.db).expenses.some(expense => expense.id === 'expense-fresh-client'));
});

test('Cashier data writes still allow orders while protecting Manager-only data', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-cashier-revision-');
  const { service, base, cookie: managerCookie } = await startServiceWithManager(t, directory);
  const managerData = loadAppData(service.db);
  managerData.users = managerData.users.map(user => user.id === 'cashier-1'
    ? { ...user, password: 'temporary-cashier-pin' }
    : user);
  saveAppData(service.db, managerData);

  const cashierLogin = await requestJson(base, '/api/login', {
    method: 'POST',
    body: { username: 'cashier', password: 'temporary-cashier-pin' },
  });
  assert.equal(cashierLogin.response.status, 200, JSON.stringify(cashierLogin.body));
  const cashierCookie = sessionCookie(cashierLogin.response);
  const loaded = await requestJson(base, '/api/data', { cookie: cashierCookie });
  const revision = revisionHeader(loaded.response);
  const cashierData = structuredClone(loaded.body);
  const order = structuredClone(cashierData.orders[0]);
  order.id = 'order-cashier-revision';
  order.orderNumber = 'JH-0002';
  order.createdAt = '2026-10-14T12:00:00.000Z';
  order.updatedAt = order.createdAt;
  order.subtotal = 125;
  order.discount = 0;
  order.total = 125;
  order.items = [{ ...order.items[0], unitPrice: 125, quantity: 1, lineTotal: 125 }];
  order.deals = [];
  const payment = {
    ...cashierData.payments[0],
    id: 'payment-cashier-revision',
    orderId: order.id,
    dateTime: order.createdAt,
    createdAt: order.createdAt,
    amount: 125,
  };
  order.payment = payment;
  cashierData.orders.push(order);
  cashierData.payments.push(payment);

  const allowedSave = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: cashierCookie,
    headers: { 'X-POS-Revision': String(revision) },
    body: cashierData,
  });
  assert.equal(allowedSave.response.status, 200, JSON.stringify(allowedSave.body));

  const restricted = structuredClone(cashierData);
  restricted.expenses[0].total = 500;
  const restrictedSave = await requestJson(base, '/api/data', {
    method: 'PUT',
    cookie: cashierCookie,
    headers: { 'X-POS-Revision': String(allowedSave.body.revision) },
    body: restricted,
  });
  assert.equal(restrictedSave.response.status, 403);
  assert.match(restrictedSave.body.error, /Cashier accounts cannot change/);
  assert.ok(loadAppData(service.db).orders.some(savedOrder => savedOrder.id === order.id));
  assert.equal(loadAppData(service.db).expenses[0].total, 75);
});
