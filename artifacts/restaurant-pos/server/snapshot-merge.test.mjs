import assert from 'node:assert/strict';
import test from 'node:test';
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

  const merged = mergeAppDataSnapshots(base, local, remote);

  assert.deepEqual(merged.conflicts, ['orders.orderNumber (JH-0002)']);
  assert.ok(merged.data.orders.some(order => order.id === 'order-remote'));
  assert.ok(!merged.data.orders.some(order => order.id === 'order-local'));
});
