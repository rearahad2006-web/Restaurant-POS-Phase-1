import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createPosHttpService } from './http-service.mjs';
import {
  authenticateUser,
  closeRestaurantDatabase,
  createManagerAccount,
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
  const sourceBackup = await requestBackup(base, cookie);
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
  assert.notDeepEqual(currentSaved, expected);
  assert.ok((await stat(path.join(dataDir, 'restaurant-pos.sqlite-wal'))).size > 0, 'the open database should contain WAL data');

  const unconfirmed = await requestRestore(base, cookie, sourceBackup, false);
  const unconfirmedBody = await unconfirmed.json();
  assert.equal(unconfirmed.status, 400, JSON.stringify(unconfirmedBody));
  assert.match(unconfirmedBody.error, /Confirm that you want to replace/);
  assert.deepEqual(loadAppData(service.db), currentSaved);

  const response = await requestRestore(base, cookie, sourceBackup);
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.restored, true);
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
  } finally {
    safetyDb.close();
  }

  const sessionResponse = await fetch(`${base}/api/session`, { headers: { cookie } });
  assert.deepEqual(await sessionResponse.json(), { user: null }, 'restore must require a fresh sign-in');
  assert.deepEqual((await readdir(dataDir)).filter(name => name.startsWith('.restore-')), [], 'staging database and SQLite sidecars must be removed');
});

test('corrupt and incompatible backups are rejected before live data or safety backups change', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-restore-invalid-');
  const { service, base, cookie } = await startServiceWithManager(t, directory);
  const original = loadAppData(service.db);
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
