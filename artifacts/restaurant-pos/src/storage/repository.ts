import { AppData, Payment, seededData } from '../domain';

/** Replace this browser adapter with a SQLite adapter in the native Windows package. */
export interface RestaurantRepository {
  load(): Promise<AppData>;
  save(data: AppData, revision?: number): Promise<void | number>;
}

const STORAGE_KEY = 'juniper-pos.phase1.data.v1';

const STORAGE_COLLECTIONS = [
  'users',
  'tables',
  'categories',
  'menuItems',
  'orders',
  'payments',
  'expenses',
  'deals',
  'businessDays',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStoredData(): Partial<AppData> | null {
  let stored: string | null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error(
      'Could not access saved restaurant data in this browser. No migration file was created; check browser storage access and retry.',
      { cause: error },
    );
  }

  if (stored === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch (error) {
    throw new Error(
      `Saved restaurant data under "${STORAGE_KEY}" is malformed and was not changed. No migration file was created.`,
      { cause: error },
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      `Saved restaurant data under "${STORAGE_KEY}" is not a valid data object. It was not changed; no migration file was created.`,
    );
  }

  for (const collection of STORAGE_COLLECTIONS) {
    if (Object.prototype.hasOwnProperty.call(parsed, collection) && !Array.isArray(parsed[collection])) {
      throw new Error(
        `Saved restaurant data field "${collection}" is malformed. The stored value was not changed; no migration file was created.`,
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'settings') && !isRecord(parsed.settings)) {
    throw new Error(
      'Saved restaurant settings are malformed. The stored value was not changed; no migration file was created.',
    );
  }

  return parsed as Partial<AppData>;
}

export class BrowserLocalRepository implements RestaurantRepository {
  async load(): Promise<AppData> {
    const old = readStoredData();
    if (old) {
      let merged: AppData;
      try {
        merged = {
          ...structuredClone(seededData),
          ...old,
          settings: { ...seededData.settings, ...(old.settings || {}) },
          users: Array.isArray(old.users) ? old.users : structuredClone(seededData.users),
          tables: Array.isArray(old.tables) ? old.tables : structuredClone(seededData.tables),
          categories: Array.isArray(old.categories) ? old.categories : structuredClone(seededData.categories),
          menuItems: Array.isArray(old.menuItems) ? old.menuItems : structuredClone(seededData.menuItems),
          orders: Array.isArray(old.orders) ? old.orders : [],
          payments: Array.isArray(old.payments) ? [...old.payments] : [],
          expenses: Array.isArray(old.expenses) ? [...old.expenses] : [],
          deals: Array.isArray(old.deals) ? [...old.deals] : [],
          businessDays: Array.isArray(old.businessDays) ? [...old.businessDays] : [],
        } as AppData;
        const accounts = [...merged.users];
        for (const seeded of seededData.users) {
          if (!accounts.some(account => account.username.toLowerCase() === seeded.username)) accounts.push(seeded);
        }
        merged.users = accounts.map(account => {
          const sample = seededData.users.find(user => user.username === account.username.toLowerCase());
          return { ...account, role: account.role === 'Manager' ? 'Manager' : 'Cashier', developmentOnly: account.developmentOnly ?? sample?.developmentOnly };
        });
        const knownOrders = new Set(merged.payments.map(payment => payment.orderId));
        const legacy: Payment[] = [];
        for (const order of merged.orders) {
          const embedded = order.payment;
          if (!embedded || knownOrders.has(order.id)) continue;
          const dateTime = embedded.createdAt || order.createdAt;
          legacy.push({
            id: embedded.id || `legacy-${order.id}`,
            orderId: order.id,
            dateTime,
            createdAt: dateTime,
            amount: embedded.amount ?? order.total,
            method: embedded.method,
            status: order.status === 'cancelled' ? 'cancelled' : 'paid',
            amountReceived: embedded.amountReceived,
            change: embedded.change,
            reference: embedded.reference,
          });
          knownOrders.add(order.id);
        }
        const uniquePayments = new Map<string, Payment>();
        for (const payment of [...merged.payments, ...legacy]) if (!uniquePayments.has(payment.orderId)) uniquePayments.set(payment.orderId, payment);
        merged.payments = [...uniquePayments.values()].map(payment => ({
          ...payment,
          dateTime: payment.dateTime || payment.createdAt || merged.orders.find(order => order.id === payment.orderId)?.createdAt || new Date().toISOString(),
          status: payment.status || (merged.orders.find(order => order.id === payment.orderId)?.status === 'cancelled' ? 'cancelled' : 'paid'),
        }));
      } catch (error) {
        throw new Error(
          'Saved restaurant data could not be safely loaded. The browser value was not intentionally changed, and no migration file was created.',
          { cause: error },
        );
      }

      await this.save(merged);
      return merged;
    }

    const fresh = structuredClone(seededData);
    await this.save(fresh);
    return fresh;
  }
  async save(data: AppData, _revision?: number): Promise<void> {
    const serialized = JSON.stringify(data);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (error) {
      throw new Error(
        'Could not save register data to browser storage. The register will not continue with unsaved data; resolve the storage issue and retry.',
        { cause: error },
      );
    }
  }
}
export const repository: RestaurantRepository = new BrowserLocalRepository();
