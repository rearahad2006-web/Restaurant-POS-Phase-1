import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshRegisterSnapshot } from '../src/storage/register-sync.mjs';
import { mergeAppDataSnapshots } from '../src/storage/snapshot-merge.mjs';

function makeFixture() {
  const order = {
    id: 'order-1',
    orderNumber: 'JH-0001',
    status: 'paid',
    total: 50,
    items: [{ name: 'Tea', quantity: 1 }],
    deals: [],
  };
  const payment = { id: 'payment-1', orderId: order.id, amount: 50, status: 'paid' };
  return {
    users: [],
    settings: { id: 'restaurant-1', name: 'Test', currency: 'PKR' },
    tables: [],
    categories: [],
    menuItems: [],
    orders: [{ ...order, payment }],
    payments: [payment],
    expenses: [{ id: 'expense-1', purpose: 'Produce', total: 75 }],
    deals: [],
    businessDays: [],
  };
}

test('snapshot merge keeps separate-session expense, order, and payment additions', () => {
  const base = makeFixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.expenses.push({ ...base.expenses[0], id: 'expense-local', purpose: 'Local expense' });
  local.orders.push({ ...base.orders[0], id: 'order-local', orderNumber: 'JH-0002', payment: undefined });
  local.payments.push({ ...base.payments[0], id: 'payment-local', orderId: 'order-local' });
  remote.expenses.push({ ...base.expenses[0], id: 'expense-remote', purpose: 'Remote expense' });
  remote.orders.push({ ...base.orders[0], id: 'order-remote', orderNumber: 'JH-0003', payment: undefined });
  remote.payments.push({ ...base.payments[0], id: 'payment-remote', orderId: 'order-remote' });

  const merged = mergeAppDataSnapshots(base, local, remote);

  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(new Set(merged.data.expenses.map(expense => expense.id)), new Set(['expense-1', 'expense-local', 'expense-remote']));
  assert.deepEqual(new Set(merged.data.orders.map(order => order.id)), new Set(['order-1', 'order-local', 'order-remote']));
  assert.deepEqual(new Set(merged.data.payments.map(payment => payment.id)), new Set(['payment-1', 'payment-local', 'payment-remote']));
});

test('snapshot merge reports overlapping edits and defaults to latest saved fields', () => {
  const base = makeFixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.expenses[0].total = 90;
  remote.expenses[0].total = 110;

  const merged = mergeAppDataSnapshots(base, local, remote);
  const confirmed = mergeAppDataSnapshots(base, local, remote, { preferLocal: true });

  assert.deepEqual(merged.conflicts, ['expenses.expense-1.total']);
  assert.equal(merged.data.expenses[0].total, 110);
  assert.equal(confirmed.data.expenses[0].total, 90);
});

test('snapshot merge detects same ticket-number allocation across tabs', () => {
  const base = makeFixture();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.orders.push({ ...base.orders[0], id: 'order-local', orderNumber: 'JH-0002', payment: undefined });
  remote.orders.push({ ...base.orders[0], id: 'order-remote', orderNumber: 'JH-0002', payment: undefined });
  local.payments.push({ ...base.payments[0], id: 'payment-local', orderId: 'order-local' });
  remote.payments.push({ ...base.payments[0], id: 'payment-remote', orderId: 'order-remote' });

  const merged = mergeAppDataSnapshots(base, local, remote);

  assert.deepEqual(merged.conflicts, ['orders.orderNumber (JH-0002)']);
  assert.ok(merged.data.orders.some(order => order.id === 'order-remote'));
  assert.ok(!merged.data.orders.some(order => order.id === 'order-local'));
  assert.ok(merged.data.payments.some(payment => payment.id === 'payment-remote'));
  assert.ok(!merged.data.payments.some(payment => payment.id === 'payment-local'));
  assert.equal(merged.data.orders.filter(order => order.orderNumber === 'JH-0002').length, 1);
});

test('revision polling refreshes orders, payments, and expenses from a second session', async () => {
  const base = makeFixture();
  const latest = structuredClone(base);
  latest.orders.push({ ...base.orders[0], id: 'order-other-tab', orderNumber: 'JH-0002' });
  latest.payments.push({ ...base.payments[0], id: 'payment-other-tab', orderId: 'order-other-tab' });
  latest.expenses.push({ ...base.expenses[0], id: 'expense-other-tab', purpose: 'Second-session expense' });

  let revision = 7;
  let accepted = null;
  let remoteUpdateNotices = 0;
  const result = await refreshRegisterSnapshot({
    getCurrentRevision: () => 7,
    readRemoteRevision: async () => revision,
    loadSnapshot: async () => ({ data: latest, revision }),
    hasPendingChanges: () => false,
    acceptSnapshot: snapshot => { accepted = snapshot; },
    onRemoteUpdate: () => { remoteUpdateNotices += 1; },
  });

  assert.equal(result, 'refreshed');
  assert.equal(accepted.revision, 7);
  assert.deepEqual(accepted.data.orders.map(order => order.id), ['order-1', 'order-other-tab']);
  assert.deepEqual(accepted.data.payments.map(payment => payment.id), ['payment-1', 'payment-other-tab']);
  assert.deepEqual(accepted.data.expenses.map(expense => expense.id), ['expense-1', 'expense-other-tab']);
  assert.equal(remoteUpdateNotices, 0);
});

test('revision polling never replaces local edits while another session has saved updates', async () => {
  const localDraft = makeFixture();
  localDraft.expenses[0].purpose = 'Unsaved entry in this tab';
  let accepted = false;
  let remoteUpdateNotices = 0;
  const result = await refreshRegisterSnapshot({
    getCurrentRevision: () => 7,
    readRemoteRevision: async () => 8,
    loadSnapshot: async () => ({ data: makeFixture(), revision: 8 }),
    hasPendingChanges: () => true,
    acceptSnapshot: () => { accepted = true; },
    onRemoteUpdate: () => { remoteUpdateNotices += 1; },
  });

  assert.equal(result, 'pending');
  assert.equal(localDraft.expenses[0].purpose, 'Unsaved entry in this tab');
  assert.equal(accepted, false);
  assert.equal(remoteUpdateNotices, 1);
});
