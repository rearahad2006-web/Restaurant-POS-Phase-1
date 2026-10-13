import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA_VERSION = 1;
const PAYMENT_METHODS = new Set(['Cash', 'Card', 'Easypaisa', 'JazzCash', 'Other']);
const ORDER_TYPES = new Set(['Dine-in', 'Takeaway', 'Delivery']);
const ORDER_STATUSES = new Set(['paid', 'cancelled']);

const schema = `
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS restaurant_settings (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT NOT NULL,
    currency TEXT NOT NULL,
    receipt_footer TEXT NOT NULL,
    print_width TEXT NOT NULL CHECK (print_width IN ('narrow', 'wide')),
    compact_display INTEGER NOT NULL CHECK (compact_display IN (0, 1)),
    logo_data_url TEXT
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_salt TEXT,
    password_hash TEXT,
    role TEXT NOT NULL CHECK (role IN ('Manager', 'Cashier')),
    created_at TEXT NOT NULL,
    development_only INTEGER NOT NULL DEFAULT 0 CHECK (development_only IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS pos_tables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    capacity REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price REAL NOT NULL,
    category_id TEXT NOT NULL REFERENCES categories(id) ON UPDATE CASCADE ON DELETE RESTRICT,
    available INTEGER NOT NULL CHECK (available IN (0, 1)),
    image_data_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    fixed_price REAL NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS deal_items (
    deal_id TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    menu_item_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    name_snapshot TEXT,
    PRIMARY KEY (deal_id, position)
  );
  CREATE TABLE IF NOT EXISTS business_days (
    id TEXT PRIMARY KEY,
    business_date TEXT NOT NULL,
    start_at TEXT NOT NULL,
    started_by TEXT NOT NULL,
    opening_cash REAL,
    end_at TEXT,
    ended_by TEXT,
    closing_cash REAL,
    status TEXT NOT NULL CHECK (status IN ('open', 'closed'))
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Dine-in', 'Takeaway', 'Delivery')),
    status TEXT NOT NULL CHECK (status IN ('paid', 'cancelled')),
    table_id TEXT,
    table_name_snapshot TEXT,
    table_released_at TEXT,
    business_day_id TEXT REFERENCES business_days(id) ON DELETE SET NULL,
    customer_name TEXT,
    customer_phone TEXT,
    delivery_address TEXT,
    notes TEXT,
    subtotal REAL NOT NULL,
    discount REAL NOT NULL,
    delivery_charge REAL NOT NULL,
    total REAL NOT NULL,
    cashier_name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS order_items (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    menu_item_id TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    line_total REAL NOT NULL,
    note TEXT,
    PRIMARY KEY (order_id, position)
  );
  CREATE TABLE IF NOT EXISTS order_deals (
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    deal_id TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    description_snapshot TEXT,
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    line_total REAL NOT NULL,
    PRIMARY KEY (order_id, position)
  );
  CREATE TABLE IF NOT EXISTS order_deal_items (
    order_id TEXT NOT NULL,
    deal_position INTEGER NOT NULL,
    position INTEGER NOT NULL,
    menu_item_id TEXT NOT NULL,
    name_snapshot TEXT NOT NULL,
    quantity REAL NOT NULL,
    PRIMARY KEY (order_id, deal_position, position),
    FOREIGN KEY (order_id, deal_position)
      REFERENCES order_deals(order_id, position) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    date_time TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'Easypaisa', 'JazzCash', 'Other')),
    amount REAL NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('paid', 'cancelled')),
    amount_received REAL,
    change_amount REAL,
    reference TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    date_time TEXT NOT NULL,
    purpose TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    total REAL NOT NULL,
    direct_total INTEGER CHECK (direct_total IN (0, 1)),
    payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Card', 'Easypaisa', 'JazzCash', 'Other')),
    supplier TEXT,
    notes TEXT,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    business_day_id TEXT REFERENCES business_days(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_business_day ON orders(business_day_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_order_items_menu_item ON order_items(menu_item_id);
  CREATE INDEX IF NOT EXISTS idx_payments_date_time ON payments(date_time);
  CREATE INDEX IF NOT EXISTS idx_payments_method_status ON payments(method, status);
  CREATE INDEX IF NOT EXISTS idx_expenses_date_time ON expenses(date_time);
  CREATE INDEX IF NOT EXISTS idx_expenses_business_day ON expenses(business_day_id);
  CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
`;

export function openRestaurantDatabase(dbPath) {
  const absolutePath = path.resolve(dbPath);
  const db = new Database(absolutePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');

  const version = db.pragma('user_version', { simple: true });
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`Database schema version ${version} is newer than this app supports (${SCHEMA_VERSION}).`);
  }
  db.exec(schema);
  if (version === 0) db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

function record(value, pathName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${pathName} must be an object.`);
  return value;
}

function list(value, pathName) {
  if (!Array.isArray(value)) throw new Error(`${pathName} must be an array.`);
  return value;
}

function text(value, pathName, optional = false) {
  if (optional && value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`${pathName} must be text.`);
  return value;
}

function numeric(value, pathName, optional = false) {
  if (optional && value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${pathName} must be a finite number.`);
  return value;
}

function boolean(value, pathName) {
  if (typeof value !== 'boolean') throw new Error(`${pathName} must be true or false.`);
  return value;
}

function uniqueIds(rows, pathName) {
  const ids = new Set();
  for (const [index, item] of rows.entries()) {
    const id = text(record(item, `${pathName}[${index}]`).id, `${pathName}[${index}].id`);
    if (!id || ids.has(id)) throw new Error(`${pathName} contains a missing or duplicate id.`);
    ids.add(id);
  }
}

function addLegacyPayments(data) {
  const payments = [...data.payments];
  const ordersById = new Map(data.orders.map(order => [order.id, order]));
  const paymentOrders = new Set();
  for (const payment of payments) {
    if (paymentOrders.has(payment.orderId)) throw new Error(`More than one payment is linked to order ${payment.orderId}.`);
    paymentOrders.add(payment.orderId);
  }
  for (const order of data.orders) {
    if (!order.payment || paymentOrders.has(order.id)) continue;
    const embedded = order.payment;
    const dateTime = embedded.dateTime || embedded.createdAt || order.createdAt;
    payments.push({
      ...embedded,
      id: embedded.id || `legacy-${order.id}`,
      orderId: order.id,
      dateTime,
      createdAt: embedded.createdAt || dateTime,
      amount: embedded.amount ?? order.total,
      status: embedded.status || (order.status === 'cancelled' ? 'cancelled' : 'paid'),
    });
    paymentOrders.add(order.id);
  }
  for (const payment of payments) {
    if (!ordersById.has(payment.orderId)) throw new Error(`Payment ${payment.id} references a missing order.`);
  }
  return { ...data, payments };
}

export function validateAppData(input) {
  const source = record(input, 'backup');
  const users = list(source.users, 'users');
  const settings = record(source.settings, 'settings');
  const tables = list(source.tables, 'tables');
  const categories = list(source.categories, 'categories');
  const menuItems = list(source.menuItems, 'menuItems');
  const orders = list(source.orders, 'orders');
  const payments = list(source.payments, 'payments');
  const expenses = list(source.expenses, 'expenses');
  const deals = list(source.deals, 'deals');
  const businessDays = list(source.businessDays, 'businessDays');
  const data = { users, settings, tables, categories, menuItems, orders, payments, expenses, deals, businessDays };

  for (const key of ['users', 'tables', 'categories', 'menuItems', 'orders', 'payments', 'expenses', 'deals', 'businessDays']) uniqueIds(data[key], key);

  text(settings.id, 'settings.id');
  text(settings.name, 'settings.name');
  text(settings.address, 'settings.address');
  text(settings.phone, 'settings.phone');
  text(settings.currency, 'settings.currency');
  text(settings.receiptFooter, 'settings.receiptFooter');
  if (!['narrow', 'wide'].includes(settings.printWidth)) throw new Error('settings.printWidth must be narrow or wide.');
  boolean(settings.compactDisplay, 'settings.compactDisplay');
  text(settings.logoDataUrl, 'settings.logoDataUrl', true);

  const usernames = new Set();
  for (const [i, value] of users.entries()) {
    const user = record(value, `users[${i}]`);
    text(user.name, `users[${i}].name`);
    const username = text(user.username, `users[${i}].username`);
    text(user.password, `users[${i}].password`, true);
    text(user.createdAt, `users[${i}].createdAt`);
    if (!['Manager', 'Cashier'].includes(user.role)) throw new Error(`users[${i}].role is invalid.`);
    if (user.developmentOnly != null) boolean(user.developmentOnly, `users[${i}].developmentOnly`);
    const normalized = username.trim().toLowerCase();
    if (!normalized || usernames.has(normalized)) throw new Error('Staff usernames must be unique and non-empty.');
    usernames.add(normalized);
  }
  for (const [i, value] of tables.entries()) {
    const row = record(value, `tables[${i}]`);
    text(row.name, `tables[${i}].name`);
    numeric(row.capacity, `tables[${i}].capacity`);
    text(row.createdAt, `tables[${i}].createdAt`);
    text(row.updatedAt, `tables[${i}].updatedAt`);
  }
  for (const [i, value] of categories.entries()) {
    const row = record(value, `categories[${i}]`);
    text(row.name, `categories[${i}].name`);
    numeric(row.sortOrder, `categories[${i}].sortOrder`);
    text(row.createdAt, `categories[${i}].createdAt`);
    text(row.updatedAt, `categories[${i}].updatedAt`);
  }
  const categoryIds = new Set(categories.map(item => item.id));
  for (const [i, value] of menuItems.entries()) {
    const row = record(value, `menuItems[${i}]`);
    text(row.name, `menuItems[${i}].name`);
    text(row.description, `menuItems[${i}].description`);
    numeric(row.price, `menuItems[${i}].price`);
    const categoryId = text(row.categoryId, `menuItems[${i}].categoryId`);
    if (!categoryIds.has(categoryId)) throw new Error(`Menu item ${row.id} references a missing category.`);
    boolean(row.available, `menuItems[${i}].available`);
    text(row.imageDataUrl, `menuItems[${i}].imageDataUrl`, true);
    text(row.createdAt, `menuItems[${i}].createdAt`);
    text(row.updatedAt, `menuItems[${i}].updatedAt`);
  }
  for (const [i, value] of deals.entries()) {
    const row = record(value, `deals[${i}]`);
    text(row.name, `deals[${i}].name`);
    text(row.description, `deals[${i}].description`, true);
    numeric(row.fixedPrice, `deals[${i}].fixedPrice`);
    boolean(row.active, `deals[${i}].active`);
    text(row.createdAt, `deals[${i}].createdAt`);
    text(row.updatedAt, `deals[${i}].updatedAt`);
    for (const [j, itemValue] of list(row.items, `deals[${i}].items`).entries()) {
      const item = record(itemValue, `deals[${i}].items[${j}]`);
      text(item.menuItemId, `deals[${i}].items[${j}].menuItemId`);
      numeric(item.quantity, `deals[${i}].items[${j}].quantity`);
      text(item.nameSnapshot, `deals[${i}].items[${j}].nameSnapshot`, true);
    }
  }
  for (const [i, value] of businessDays.entries()) {
    const row = record(value, `businessDays[${i}]`);
    text(row.businessDate, `businessDays[${i}].businessDate`);
    text(row.startAt, `businessDays[${i}].startAt`);
    text(row.startedBy, `businessDays[${i}].startedBy`);
    numeric(row.openingCash, `businessDays[${i}].openingCash`, true);
    text(row.endAt, `businessDays[${i}].endAt`, true);
    text(row.endedBy, `businessDays[${i}].endedBy`, true);
    numeric(row.closingCash, `businessDays[${i}].closingCash`, true);
    if (!['open', 'closed'].includes(row.status)) throw new Error(`businessDays[${i}].status is invalid.`);
  }
  const businessDayIds = new Set(businessDays.map(day => day.id));
  for (const [i, value] of orders.entries()) {
    const row = record(value, `orders[${i}]`);
    text(row.orderNumber, `orders[${i}].orderNumber`);
    text(row.createdAt, `orders[${i}].createdAt`);
    text(row.updatedAt, `orders[${i}].updatedAt`);
    if (!ORDER_TYPES.has(row.type)) throw new Error(`orders[${i}].type is invalid.`);
    if (!ORDER_STATUSES.has(row.status)) throw new Error(`orders[${i}].status is invalid.`);
    for (const key of ['tableId', 'tableNameSnapshot', 'tableReleasedAt', 'businessDayId', 'customerName', 'customerPhone', 'deliveryAddress', 'notes']) {
      text(row[key], `orders[${i}].${key}`, true);
    }
    if (row.businessDayId && !businessDayIds.has(row.businessDayId)) throw new Error(`Order ${row.id} references a missing business day.`);
    for (const key of ['subtotal', 'discount', 'deliveryCharge', 'total']) numeric(row[key], `orders[${i}].${key}`);
    text(row.cashierName, `orders[${i}].cashierName`);
    for (const [j, itemValue] of list(row.items, `orders[${i}].items`).entries()) {
      const item = record(itemValue, `orders[${i}].items[${j}]`);
      text(item.menuItemId, `orders[${i}].items[${j}].menuItemId`);
      text(item.name, `orders[${i}].items[${j}].name`);
      numeric(item.unitPrice, `orders[${i}].items[${j}].unitPrice`);
      numeric(item.quantity, `orders[${i}].items[${j}].quantity`);
      numeric(item.lineTotal, `orders[${i}].items[${j}].lineTotal`);
      text(item.note, `orders[${i}].items[${j}].note`, true);
    }
    for (const [j, dealValue] of list(row.deals || [], `orders[${i}].deals`).entries()) {
      const deal = record(dealValue, `orders[${i}].deals[${j}]`);
      text(deal.dealId, `orders[${i}].deals[${j}].dealId`);
      text(deal.name, `orders[${i}].deals[${j}].name`);
      text(deal.description, `orders[${i}].deals[${j}].description`, true);
      numeric(deal.unitPrice, `orders[${i}].deals[${j}].unitPrice`);
      numeric(deal.quantity, `orders[${i}].deals[${j}].quantity`);
      numeric(deal.lineTotal, `orders[${i}].deals[${j}].lineTotal`);
      for (const [k, itemValue] of list(deal.items, `orders[${i}].deals[${j}].items`).entries()) {
        const item = record(itemValue, `orders[${i}].deals[${j}].items[${k}]`);
        text(item.menuItemId, `orders[${i}].deals[${j}].items[${k}].menuItemId`);
        text(item.name, `orders[${i}].deals[${j}].items[${k}].name`);
        numeric(item.quantity, `orders[${i}].deals[${j}].items[${k}].quantity`);
      }
    }
  }
  const orderIds = new Set(orders.map(order => order.id));
  for (const [i, value] of payments.entries()) {
    const row = record(value, `payments[${i}]`);
    text(row.orderId, `payments[${i}].orderId`);
    if (!orderIds.has(row.orderId)) throw new Error(`Payment ${row.id} references a missing order.`);
    text(row.dateTime, `payments[${i}].dateTime`);
    if (!PAYMENT_METHODS.has(row.method)) throw new Error(`payments[${i}].method is invalid.`);
    numeric(row.amount, `payments[${i}].amount`);
    if (!['paid', 'cancelled'].includes(row.status)) throw new Error(`payments[${i}].status is invalid.`);
    numeric(row.amountReceived, `payments[${i}].amountReceived`, true);
    numeric(row.change, `payments[${i}].change`, true);
    text(row.reference, `payments[${i}].reference`, true);
    text(row.createdAt, `payments[${i}].createdAt`, true);
  }
  const normalized = addLegacyPayments(data);
  const seenPaymentOrders = new Set();
  for (const payment of normalized.payments) {
    if (seenPaymentOrders.has(payment.orderId)) throw new Error(`More than one payment is linked to order ${payment.orderId}.`);
    seenPaymentOrders.add(payment.orderId);
  }
  for (const [i, value] of expenses.entries()) {
    const row = record(value, `expenses[${i}]`);
    text(row.dateTime, `expenses[${i}].dateTime`);
    text(row.purpose, `expenses[${i}].purpose`);
    text(row.category, `expenses[${i}].category`);
    numeric(row.quantity, `expenses[${i}].quantity`);
    numeric(row.unitPrice, `expenses[${i}].unitPrice`);
    numeric(row.total, `expenses[${i}].total`);
    if (row.directTotal != null) boolean(row.directTotal, `expenses[${i}].directTotal`);
    if (!PAYMENT_METHODS.has(row.paymentMethod)) throw new Error(`expenses[${i}].paymentMethod is invalid.`);
    for (const key of ['supplier', 'notes']) text(row[key], `expenses[${i}].${key}`, true);
    text(row.addedBy, `expenses[${i}].addedBy`);
    text(row.createdAt, `expenses[${i}].createdAt`);
    text(row.updatedAt, `expenses[${i}].updatedAt`);
    text(row.businessDayId, `expenses[${i}].businessDayId`, true);
    if (row.businessDayId && !businessDayIds.has(row.businessDayId)) throw new Error(`Expense ${row.id} references a missing business day.`);
  }
  return normalized;
}

function passwordDigest(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

function safeUser(row) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    password: '',
    role: row.role,
    createdAt: row.created_at,
    ...(row.development_only ? { developmentOnly: true } : {}),
  };
}

function isDatabaseEmpty(db) {
  const tables = ['restaurant_settings', 'users', 'pos_tables', 'categories', 'menu_items', 'orders', 'payments', 'expenses', 'deals', 'business_days'];
  return tables.every(table => db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count === 0);
}

function saveDataInTransaction(db, data) {
  const settings = data.settings;
  db.prepare(`
    INSERT INTO restaurant_settings (id, name, address, phone, currency, receipt_footer, print_width, compact_display, logo_data_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, address=excluded.address, phone=excluded.phone,
      currency=excluded.currency, receipt_footer=excluded.receipt_footer, print_width=excluded.print_width,
      compact_display=excluded.compact_display, logo_data_url=excluded.logo_data_url
  `).run(settings.id, settings.name, settings.address, settings.phone, settings.currency, settings.receiptFooter, settings.printWidth, Number(settings.compactDisplay), settings.logoDataUrl ?? null);

  const findUser = db.prepare('SELECT password_salt, password_hash FROM users WHERE id = ?');
  const upsertUser = db.prepare(`
    INSERT INTO users (id, name, username, password_salt, password_hash, role, created_at, development_only)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, username=excluded.username,
      password_salt=excluded.password_salt, password_hash=excluded.password_hash, role=excluded.role,
      created_at=excluded.created_at, development_only=excluded.development_only
  `);
  for (const user of data.users) {
    const existing = findUser.get(user.id);
    const password = typeof user.password === 'string' ? user.password : '';
    const credentials = password
      ? passwordDigest(password)
      : { salt: existing?.password_salt ?? null, hash: existing?.password_hash ?? null };
    upsertUser.run(user.id, user.name, user.username.trim(), credentials.salt, credentials.hash, user.role, user.createdAt, Number(Boolean(user.developmentOnly)));
  }
  deleteMissing(db, 'users', data.users.map(item => item.id));

  const upsertBusinessDay = db.prepare(`
    INSERT INTO business_days (id, business_date, start_at, started_by, opening_cash, end_at, ended_by, closing_cash, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET business_date=excluded.business_date, start_at=excluded.start_at, started_by=excluded.started_by,
      opening_cash=excluded.opening_cash, end_at=excluded.end_at, ended_by=excluded.ended_by, closing_cash=excluded.closing_cash, status=excluded.status
  `);
  for (const day of data.businessDays) upsertBusinessDay.run(day.id, day.businessDate, day.startAt, day.startedBy, day.openingCash ?? null, day.endAt ?? null, day.endedBy ?? null, day.closingCash ?? null, day.status);

  const upsertTable = db.prepare(`
    INSERT INTO pos_tables (id, name, capacity, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, capacity=excluded.capacity, created_at=excluded.created_at, updated_at=excluded.updated_at
  `);
  for (const table of data.tables) upsertTable.run(table.id, table.name, table.capacity, table.createdAt, table.updatedAt);

  const upsertCategory = db.prepare(`
    INSERT INTO categories (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, created_at=excluded.created_at, updated_at=excluded.updated_at
  `);
  for (const category of data.categories) upsertCategory.run(category.id, category.name, category.sortOrder, category.createdAt, category.updatedAt);

  const upsertMenuItem = db.prepare(`
    INSERT INTO menu_items (id, name, description, price, category_id, available, image_data_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, price=excluded.price,
      category_id=excluded.category_id, available=excluded.available, image_data_url=excluded.image_data_url,
      created_at=excluded.created_at, updated_at=excluded.updated_at
  `);
  for (const item of data.menuItems) upsertMenuItem.run(item.id, item.name, item.description, item.price, item.categoryId, Number(item.available), item.imageDataUrl ?? null, item.createdAt, item.updatedAt);
  deleteMissing(db, 'menu_items', data.menuItems.map(item => item.id));
  deleteMissing(db, 'categories', data.categories.map(item => item.id));
  deleteMissing(db, 'pos_tables', data.tables.map(item => item.id));

  const upsertDeal = db.prepare(`
    INSERT INTO deals (id, name, description, fixed_price, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, fixed_price=excluded.fixed_price,
      active=excluded.active, created_at=excluded.created_at, updated_at=excluded.updated_at
  `);
  const deleteDealItems = db.prepare('DELETE FROM deal_items WHERE deal_id = ?');
  const insertDealItem = db.prepare('INSERT INTO deal_items (deal_id, position, menu_item_id, quantity, name_snapshot) VALUES (?, ?, ?, ?, ?)');
  for (const deal of data.deals) {
    upsertDeal.run(deal.id, deal.name, deal.description ?? null, deal.fixedPrice, Number(deal.active), deal.createdAt, deal.updatedAt);
    deleteDealItems.run(deal.id);
    deal.items.forEach((item, position) => insertDealItem.run(deal.id, position, item.menuItemId, item.quantity, item.nameSnapshot ?? null));
  }
  deleteMissing(db, 'deals', data.deals.map(item => item.id));

  const upsertOrder = db.prepare(`
    INSERT INTO orders (id, order_number, created_at, updated_at, type, status, table_id, table_name_snapshot, table_released_at,
      business_day_id, customer_name, customer_phone, delivery_address, notes, subtotal, discount, delivery_charge, total, cashier_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET order_number=excluded.order_number, created_at=excluded.created_at, updated_at=excluded.updated_at,
      type=excluded.type, status=excluded.status, table_id=excluded.table_id, table_name_snapshot=excluded.table_name_snapshot,
      table_released_at=excluded.table_released_at, business_day_id=excluded.business_day_id, customer_name=excluded.customer_name,
      customer_phone=excluded.customer_phone, delivery_address=excluded.delivery_address, notes=excluded.notes,
      subtotal=excluded.subtotal, discount=excluded.discount, delivery_charge=excluded.delivery_charge,
      total=excluded.total, cashier_name=excluded.cashier_name
  `);
  const deleteOrderItems = db.prepare('DELETE FROM order_items WHERE order_id = ?');
  const deleteOrderDeals = db.prepare('DELETE FROM order_deals WHERE order_id = ?');
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, position, menu_item_id, name_snapshot, unit_price, quantity, line_total, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrderDeal = db.prepare(`
    INSERT INTO order_deals (order_id, position, deal_id, name_snapshot, description_snapshot, unit_price, quantity, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertOrderDealItem = db.prepare(`
    INSERT INTO order_deal_items (order_id, deal_position, position, menu_item_id, name_snapshot, quantity)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const order of data.orders) {
    upsertOrder.run(order.id, order.orderNumber, order.createdAt, order.updatedAt, order.type, order.status,
      order.tableId ?? null, order.tableNameSnapshot ?? null, order.tableReleasedAt ?? null, order.businessDayId ?? null,
      order.customerName ?? null, order.customerPhone ?? null, order.deliveryAddress ?? null, order.notes ?? null,
      order.subtotal, order.discount, order.deliveryCharge, order.total, order.cashierName);
    deleteOrderItems.run(order.id);
    deleteOrderDeals.run(order.id);
    order.items.forEach((item, position) => insertOrderItem.run(order.id, position, item.menuItemId, item.name, item.unitPrice, item.quantity, item.lineTotal, item.note ?? null));
    (order.deals ?? []).forEach((deal, dealPosition) => {
      insertOrderDeal.run(order.id, dealPosition, deal.dealId, deal.name, deal.description ?? null, deal.unitPrice, deal.quantity, deal.lineTotal);
      deal.items.forEach((item, position) => insertOrderDealItem.run(order.id, dealPosition, position, item.menuItemId, item.name, item.quantity));
    });
  }
  protectHistoricalRows(db, 'orders', data.orders.map(item => item.id));

  const upsertPayment = db.prepare(`
    INSERT INTO payments (id, order_id, date_time, method, amount, status, amount_received, change_amount, reference, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET order_id=excluded.order_id, date_time=excluded.date_time, method=excluded.method,
      amount=excluded.amount, status=excluded.status, amount_received=excluded.amount_received,
      change_amount=excluded.change_amount, reference=excluded.reference, created_at=excluded.created_at
  `);
  for (const payment of data.payments) upsertPayment.run(payment.id, payment.orderId, payment.dateTime, payment.method, payment.amount, payment.status, payment.amountReceived ?? null, payment.change ?? null, payment.reference ?? null, payment.createdAt ?? null);
  protectHistoricalRows(db, 'payments', data.payments.map(item => item.id));

  const upsertExpense = db.prepare(`
    INSERT INTO expenses (id, date_time, purpose, category, quantity, unit_price, total, direct_total, payment_method,
      supplier, notes, added_by, created_at, updated_at, business_day_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET date_time=excluded.date_time, purpose=excluded.purpose, category=excluded.category,
      quantity=excluded.quantity, unit_price=excluded.unit_price, total=excluded.total, direct_total=excluded.direct_total,
      payment_method=excluded.payment_method, supplier=excluded.supplier, notes=excluded.notes, added_by=excluded.added_by,
      created_at=excluded.created_at, updated_at=excluded.updated_at, business_day_id=excluded.business_day_id
  `);
  for (const expense of data.expenses) upsertExpense.run(expense.id, expense.dateTime, expense.purpose, expense.category, expense.quantity, expense.unitPrice, expense.total, expense.directTotal == null ? null : Number(expense.directTotal), expense.paymentMethod, expense.supplier ?? null, expense.notes ?? null, expense.addedBy, expense.createdAt, expense.updatedAt, expense.businessDayId ?? null);
  deleteMissing(db, 'expenses', data.expenses.map(item => item.id));
}

function deleteMissing(db, tableName, ids) {
  const allowed = new Set(['users', 'menu_items', 'categories', 'pos_tables', 'deals', 'expenses']);
  if (!allowed.has(tableName)) throw new Error(`Unsupported cleanup table ${tableName}.`);
  const incoming = new Set(ids);
  const remove = db.prepare(`DELETE FROM ${tableName} WHERE id = ?`);
  for (const row of db.prepare(`SELECT id FROM ${tableName}`).all()) if (!incoming.has(row.id)) remove.run(row.id);
}

function protectHistoricalRows(db, tableName, incomingIds) {
  const allowed = new Set(['orders', 'payments']);
  if (!allowed.has(tableName)) throw new Error(`Unsupported history table ${tableName}.`);
  const incoming = new Set(incomingIds);
  for (const row of db.prepare(`SELECT id FROM ${tableName}`).all()) {
    if (!incoming.has(row.id)) throw new Error(`Saving this change would remove saved ${tableName === 'orders' ? 'order' : 'payment'} ${row.id}. No saved transactions were changed.`);
  }
}

export function saveAppData(db, input) {
  const data = validateAppData(input);
  const transaction = db.transaction(() => saveDataInTransaction(db, data));
  transaction();
}

export function loadAppData(db) {
  const settingsRow = db.prepare('SELECT * FROM restaurant_settings LIMIT 1').get();
  if (!settingsRow) throw new Error('The local database has no restaurant settings. Import a verified browser backup to continue.');
  const settings = {
    id: settingsRow.id,
    name: settingsRow.name,
    address: settingsRow.address,
    phone: settingsRow.phone,
    currency: settingsRow.currency,
    receiptFooter: settingsRow.receipt_footer,
    printWidth: settingsRow.print_width,
    compactDisplay: Boolean(settingsRow.compact_display),
    ...(settingsRow.logo_data_url == null ? {} : { logoDataUrl: settingsRow.logo_data_url }),
  };
  const users = db.prepare('SELECT * FROM users ORDER BY rowid').all().map(safeUser);
  const tables = db.prepare('SELECT * FROM pos_tables ORDER BY rowid').all().map(row => ({
    id: row.id, name: row.name, capacity: row.capacity, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order, rowid').all().map(row => ({
    id: row.id, name: row.name, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  const menuItems = db.prepare('SELECT * FROM menu_items ORDER BY rowid').all().map(row => ({
    id: row.id, name: row.name, description: row.description, price: row.price, categoryId: row.category_id,
    available: Boolean(row.available), ...(row.image_data_url == null ? {} : { imageDataUrl: row.image_data_url }),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }));
  const dealItems = db.prepare('SELECT * FROM deal_items ORDER BY deal_id, position').all();
  const deals = db.prepare('SELECT * FROM deals ORDER BY rowid').all().map(row => ({
    id: row.id,
    name: row.name,
    ...(row.description == null ? {} : { description: row.description }),
    fixedPrice: row.fixed_price,
    active: Boolean(row.active),
    items: dealItems.filter(item => item.deal_id === row.id).map(item => ({
      menuItemId: item.menu_item_id, quantity: item.quantity, ...(item.name_snapshot == null ? {} : { nameSnapshot: item.name_snapshot }),
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  const businessDays = db.prepare('SELECT * FROM business_days ORDER BY rowid').all().map(row => ({
    id: row.id, businessDate: row.business_date, startAt: row.start_at, startedBy: row.started_by,
    ...(row.opening_cash == null ? {} : { openingCash: row.opening_cash }),
    ...(row.end_at == null ? {} : { endAt: row.end_at }),
    ...(row.ended_by == null ? {} : { endedBy: row.ended_by }),
    ...(row.closing_cash == null ? {} : { closingCash: row.closing_cash }),
    status: row.status,
  }));
  const itemRows = db.prepare('SELECT * FROM order_items ORDER BY order_id, position').all();
  const dealRows = db.prepare('SELECT * FROM order_deals ORDER BY order_id, position').all();
  const dealContentRows = db.prepare('SELECT * FROM order_deal_items ORDER BY order_id, deal_position, position').all();
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at, rowid').all().map(row => {
    const orderDeals = dealRows.filter(deal => deal.order_id === row.id).map(deal => ({
      dealId: deal.deal_id,
      name: deal.name_snapshot,
      ...(deal.description_snapshot == null ? {} : { description: deal.description_snapshot }),
      unitPrice: deal.unit_price,
      quantity: deal.quantity,
      lineTotal: deal.line_total,
      items: dealContentRows.filter(item => item.order_id === row.id && item.deal_position === deal.position).map(item => ({
        menuItemId: item.menu_item_id, name: item.name_snapshot, quantity: item.quantity,
      })),
    }));
    return {
      id: row.id, orderNumber: row.order_number, createdAt: row.created_at, updatedAt: row.updated_at,
      type: row.type, status: row.status,
      ...(row.table_id == null ? {} : { tableId: row.table_id }),
      ...(row.table_name_snapshot == null ? {} : { tableNameSnapshot: row.table_name_snapshot }),
      ...(row.table_released_at == null ? {} : { tableReleasedAt: row.table_released_at }),
      ...(row.business_day_id == null ? {} : { businessDayId: row.business_day_id }),
      ...(row.customer_name == null ? {} : { customerName: row.customer_name }),
      ...(row.customer_phone == null ? {} : { customerPhone: row.customer_phone }),
      ...(row.delivery_address == null ? {} : { deliveryAddress: row.delivery_address }),
      ...(row.notes == null ? {} : { notes: row.notes }),
      subtotal: row.subtotal, discount: row.discount, deliveryCharge: row.delivery_charge, total: row.total,
      cashierName: row.cashier_name,
      items: itemRows.filter(item => item.order_id === row.id).map(item => ({
        menuItemId: item.menu_item_id, name: item.name_snapshot, unitPrice: item.unit_price,
        quantity: item.quantity, lineTotal: item.line_total, ...(item.note == null ? {} : { note: item.note }),
      })),
      ...(orderDeals.length ? { deals: orderDeals } : { deals: [] }),
    };
  });
  const payments = db.prepare('SELECT * FROM payments ORDER BY date_time, rowid').all().map(row => ({
    id: row.id, orderId: row.order_id, dateTime: row.date_time, method: row.method, amount: row.amount, status: row.status,
    ...(row.amount_received == null ? {} : { amountReceived: row.amount_received }),
    ...(row.change_amount == null ? {} : { change: row.change_amount }),
    ...(row.reference == null ? {} : { reference: row.reference }),
    ...(row.created_at == null ? {} : { createdAt: row.created_at }),
  }));
  const paymentByOrder = new Map(payments.map(payment => [payment.orderId, payment]));
  const ordersWithPayment = orders.map(order => ({
    ...order,
    ...(paymentByOrder.has(order.id) ? { payment: paymentByOrder.get(order.id) } : {}),
  }));
  const expenses = db.prepare('SELECT * FROM expenses ORDER BY date_time, rowid').all().map(row => ({
    id: row.id, dateTime: row.date_time, purpose: row.purpose, category: row.category, quantity: row.quantity,
    unitPrice: row.unit_price, total: row.total,
    ...(row.direct_total == null ? {} : { directTotal: Boolean(row.direct_total) }),
    paymentMethod: row.payment_method,
    ...(row.supplier == null ? {} : { supplier: row.supplier }),
    ...(row.notes == null ? {} : { notes: row.notes }),
    addedBy: row.added_by, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.business_day_id == null ? {} : { businessDayId: row.business_day_id }),
  }));
  return { users, settings, tables, categories, menuItems, orders: ordersWithPayment, payments, expenses, deals, businessDays };
}

export function getBootstrapInfo(db, developmentMode) {
  const initialized = db.prepare('SELECT COUNT(*) AS count FROM restaurant_settings').get().count > 0;
  const manager = db.prepare(`
    SELECT COUNT(*) AS count FROM users
    WHERE role = 'Manager' AND development_only = 0 AND password_hash IS NOT NULL
  `).get().count > 0;
  const settings = db.prepare('SELECT name FROM restaurant_settings LIMIT 1').get();
  return {
    initialized,
    needsImport: !initialized,
    needsManagerSetup: initialized && !developmentMode && !manager,
    developmentMode,
    ...(settings ? { restaurantName: settings.name } : {}),
  };
}

export function isEmptyDatabase(db) {
  return isDatabaseEmpty(db);
}

export function initializeDevelopmentData(db, input) {
  if (!isDatabaseEmpty(db)) return false;
  saveAppData(db, input);
  return true;
}

export async function importLegacyBackup(db, backupDir, sourceText) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) throw new Error('Choose a non-empty browser backup file.');
  if (Buffer.byteLength(sourceText, 'utf8') > 50 * 1024 * 1024) throw new Error('The browser backup is larger than 50 MB.');
  const hash = createHash('sha256').update(sourceText, 'utf8').digest('hex');
  const prior = db.prepare("SELECT value FROM app_meta WHERE key = 'legacy_import_sha256'").get();
  if (prior?.value === hash) {
    return {
      alreadyImported: true,
      backupPath: db.prepare("SELECT value FROM app_meta WHERE key = 'legacy_backup_path'").get()?.value,
      sha256: hash,
    };
  }
  if (!isDatabaseEmpty(db)) throw new Error('This database already contains POS data. Import is allowed only into an empty database; no existing data was changed.');

  let parsed;
  try {
    parsed = JSON.parse(sourceText);
  } catch {
    throw new Error('The selected file is not valid JSON. The source browser data was not changed.');
  }
  const data = validateAppData(parsed);
  await mkdir(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `legacy-${hash}.json`);
  try {
    await writeFile(backupPath, sourceText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw new Error(`Could not create the verified source backup: ${error.message}`);
  }
  let backupText;
  try {
    backupText = await readFile(backupPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read back the source backup: ${error.message}`);
  }
  const verifiedHash = createHash('sha256').update(backupText, 'utf8').digest('hex');
  if (verifiedHash !== hash) throw new Error('The saved source backup did not pass SHA-256 verification. The database was not changed.');

  const importedAt = new Date().toISOString();
  db.transaction(() => {
    if (!isDatabaseEmpty(db)) throw new Error('The database changed before import. No records were overwritten.');
    saveDataInTransaction(db, data);
    const putMeta = db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    putMeta.run('legacy_import_sha256', hash);
    putMeta.run('legacy_backup_path', backupPath);
    putMeta.run('legacy_imported_at', importedAt);
  })();
  return { alreadyImported: false, backupPath, sha256: hash };
}

export function createManagerAccount(db, { name, username, password }) {
  const displayName = String(name ?? '').trim();
  const normalizedUsername = String(username ?? '').trim();
  const secret = String(password ?? '');
  if (!displayName || !normalizedUsername || secret.trim().length < 4) {
    throw new Error('Enter a name, username, and a PIN/password of at least four characters.');
  }
  if (!getBootstrapInfo(db, false).initialized) throw new Error('Import and verify the browser backup before creating the manager account.');
  if (!getBootstrapInfo(db, false).needsManagerSetup) throw new Error('A production manager account already exists.');
  const credentials = passwordDigest(secret);
  const existing = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(normalizedUsername);
  if (existing) {
    if (existing.role !== 'Manager' || existing.password_hash) {
      throw new Error('That username is already assigned to an account. Choose an unused username or an imported manager account without a PIN.');
    }
    db.prepare(`
      UPDATE users
      SET name = ?, password_salt = ?, password_hash = ?, development_only = 0
      WHERE id = ?
    `).run(displayName, credentials.salt, credentials.hash, existing.id);
    return safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id));
  }
  const id = randomUUID();
  try {
    db.prepare(`
      INSERT INTO users (id, name, username, password_salt, password_hash, role, created_at, development_only)
      VALUES (?, ?, ?, ?, ?, 'Manager', ?, 0)
    `).run(id, displayName, normalizedUsername, credentials.salt, credentials.hash, new Date().toISOString());
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw new Error('That username is already in use, including by a preserved development account.');
    throw error;
  }
  return safeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function authenticateUser(db, username, password, developmentMode) {
  if (typeof username !== 'string' || typeof password !== 'string') return null;
  const row = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim());
  if (!row || !row.password_salt || !row.password_hash) return null;
  if (row.development_only && !developmentMode) return null;
  const actual = scryptSync(password, row.password_salt, 64);
  const expected = Buffer.from(row.password_hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return safeUser(row);
}

export function closeRestaurantDatabase(db) {
  if (db.open) db.close();
}
