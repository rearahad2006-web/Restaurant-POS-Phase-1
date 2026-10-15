import { AppData, Payment, seededData } from '../domain';

/** Replace this browser adapter with a SQLite adapter in the native Windows package. */
export interface RestaurantRepository {
  load(): Promise<AppData>;
  save(data: AppData, revision?: number): Promise<void | number>;
}

const STORAGE_KEY = 'juniper-pos.phase1.data.v1';
export class BrowserLocalRepository implements RestaurantRepository {
  async load(): Promise<AppData> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const old = JSON.parse(stored) as Partial<AppData>;
        const merged = {
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
        await this.save(merged);
        return merged;
      }
      const fresh = structuredClone(seededData);
      await this.save(fresh);
      return fresh;
    } catch {
      return structuredClone(seededData);
    }
  }
  async save(data: AppData, _revision?: number): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}
export const repository: RestaurantRepository = new BrowserLocalRepository();
