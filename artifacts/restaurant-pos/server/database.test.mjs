import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
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

test('SQLite round-trips staff, register records and historical snapshots atomically', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-db-');
  const db = openRestaurantDatabase(path.join(directory, 'register.sqlite'));
  t.after(() => closeRestaurantDatabase(db));

  const source = makeFixture();
  saveAppData(db, source);
  const loaded = loadAppData(db);

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

test('verified backups use SQLite backup and pass integrity_check', async t => {
  const directory = await temporaryDirectory(t, 'restaurant-pos-verified-backup-');
  const db = openRestaurantDatabase(path.join(directory, 'register.sqlite'));
  t.after(() => closeRestaurantDatabase(db));
  saveAppData(db, makeFixture());

  const target = path.join(directory, 'copy.sqlite');
  await db.backup(target);
  const copy = new Database(target, { readonly: true, fileMustExist: true });
  try {
    assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(copy.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
  } finally {
    copy.close();
  }
});
