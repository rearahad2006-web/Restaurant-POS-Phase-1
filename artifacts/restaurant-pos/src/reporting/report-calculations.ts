import type { Expense, Order, OrderType, Payment, PaymentMethod } from '../domain';

export type ReportPeriod =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'custom';

export type ReportFilterValue<T> = T | 'all';

export interface ReportFilters {
  paymentMethod: ReportFilterValue<PaymentMethod>;
  orderType: ReportFilterValue<OrderType>;
}

export interface ReportDataSource {
  orders: readonly Order[];
  payments: readonly Payment[];
  expenses: readonly Expense[];
}

export interface ReportDateRange {
  period: ReportPeriod;
  startDate: string;
  endDate: string;
  startInclusive: number;
  endExclusive: number;
  label: string;
}

export interface ReportPaymentRow {
  payment: Payment;
  orderNumber: string;
  orderType: OrderType;
  orderStatus: Order['status'];
}

export interface DailyReportRow {
  date: string;
  completedOrders: number;
  sales: number;
  expenses: number;
  netAmount: number;
}

export interface ItemSalesRow {
  menuItemId: string;
  name: string;
  quantity: number;
  sales: number;
}

export interface ReportResult {
  range: ReportDateRange;
  filters: ReportFilters;
  completedOrders: Order[];
  cancelledOrders: Order[];
  paymentRecords: ReportPaymentRow[];
  salesPaymentRecords: ReportPaymentRow[];
  expenses: Expense[];
  dailyBreakdown: DailyReportRow[];
  itemsSold: ItemSalesRow[];
  salesByPaymentMethod: { method: PaymentMethod; amount: number }[];
  salesByOrderType: { type: OrderType; orderCount: number; amount: number }[];
  expensesByCategory: { category: string; amount: number }[];
  totals: {
    sales: number;
    completedOrders: number;
    cancelledOrders: number;
    expenses: number;
    netAmount: number;
    discounts: number;
    deliveryCharges: number;
    averageOrderValue: number;
  };
}

export const REPORT_PERIOD_OPTIONS: { value: ReportPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This Week (Mon–Sun)' },
  { value: 'last-week', label: 'Last Week (Mon–Sun)' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'custom', label: 'Custom Date Range' },
];

export const REPORT_PAYMENT_METHODS: PaymentMethod[] = [
  'Cash',
  'Card',
  'Easypaisa',
  'JazzCash',
  'Other',
];

export const REPORT_ORDER_TYPES: OrderType[] = ['Dine-in', 'Takeaway', 'Delivery'];

export const NET_AMOUNT_NOTE =
  'Net Amount After Recorded Expenses = completed sales − recorded expenses. It is not guaranteed accounting profit; unrecorded inventory, bills, taxes, and other costs are excluded.';

export const ITEM_SALES_NOTE =
  'Item sales use saved order-line snapshots. Order-level discounts are not allocated to individual items, and combo contents are not stored separately, so combos are shown only by their saved line name and total.';

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseLocalDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(key: string, amount: number): string {
  const date = parseLocalDateKey(key);
  if (!date) throw new RangeError('Invalid local date.');
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function formatLocalDateKey(key: string): string {
  const date = parseLocalDateKey(key);
  if (!date) return key;
  return new Intl.DateTimeFormat('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatLocalDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-PK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function resolveReportDateRange(
  period: ReportPeriod,
  referenceDate = new Date(),
  customStart = '',
  customEnd = '',
): ReportDateRange {
  const today = localDateKey(referenceDate);
  let startDate: string;
  let endDate: string;

  if (period === 'custom') {
    if (!parseLocalDateKey(customStart) || !parseLocalDateKey(customEnd)) {
      throw new RangeError('Choose a valid start date and end date.');
    }
    if (customEnd < customStart) {
      throw new RangeError('The end date must be on or after the start date.');
    }
    startDate = customStart;
    endDate = customEnd;
  } else if (period === 'today') {
    startDate = today;
    endDate = today;
  } else if (period === 'yesterday') {
    startDate = addLocalDays(today, -1);
    endDate = startDate;
  } else if (period === 'this-week' || period === 'last-week') {
    const todayDate = parseLocalDateKey(today);
    if (!todayDate) throw new RangeError('Could not resolve today in local time.');
    const daysSinceMonday = (todayDate.getDay() + 6) % 7;
    const thisWeekStart = addLocalDays(today, -daysSinceMonday);
    if (period === 'this-week') {
      startDate = thisWeekStart;
      endDate = addLocalDays(thisWeekStart, 6);
    } else {
      endDate = addLocalDays(thisWeekStart, -1);
      startDate = addLocalDays(endDate, -6);
    }
  } else if (period === 'this-month') {
    const date = parseLocalDateKey(today);
    if (!date) throw new RangeError('Could not resolve this month in local time.');
    startDate = localDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
    endDate = addLocalDays(localDateKey(new Date(date.getFullYear(), date.getMonth() + 1, 1)), -1);
  } else {
    const date = parseLocalDateKey(today);
    if (!date) throw new RangeError('Could not resolve last month in local time.');
    startDate = localDateKey(new Date(date.getFullYear(), date.getMonth() - 1, 1));
    endDate = addLocalDays(localDateKey(new Date(date.getFullYear(), date.getMonth(), 1)), -1);
  }

  const start = parseLocalDateKey(startDate);
  const end = parseLocalDateKey(endDate);
  if (!start || !end) throw new RangeError('Could not create the report date range.');

  const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
  const periodLabel = REPORT_PERIOD_OPTIONS.find(option => option.value === period)?.label || 'Report';
  const dateLabel =
    startDate === endDate
      ? formatLocalDateKey(startDate)
      : `${formatLocalDateKey(startDate)} – ${formatLocalDateKey(endDate)}`;

  return {
    period,
    startDate,
    endDate,
    startInclusive: start.getTime(),
    endExclusive: endExclusive.getTime(),
    label: `${periodLabel}: ${dateLabel}`,
  };
}

export function timestampIsInRange(value: string, range: ReportDateRange): boolean {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) &&
    timestamp >= range.startInclusive &&
    timestamp < range.endExclusive;
}

function timestampLocalDateKey(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function effectivePayments(data: ReportDataSource): Payment[] {
  const payments: Payment[] = [];
  const seenIds = new Set<string>();
  const ordersWithPayments = new Set<string>();

  for (const payment of data.payments) {
    const uniqueId = payment.id || `${payment.orderId}-${payment.dateTime}-${payment.amount}`;
    if (seenIds.has(uniqueId)) continue;
    seenIds.add(uniqueId);
    ordersWithPayments.add(payment.orderId);
    payments.push(payment);
  }

  for (const order of data.orders) {
    if (!order.payment || ordersWithPayments.has(order.id)) continue;
    payments.push({
      ...order.payment,
      id: order.payment.id || `legacy-${order.id}`,
      orderId: order.id,
      dateTime: order.payment.dateTime || order.payment.createdAt || order.createdAt,
      status: order.status === 'cancelled' ? 'cancelled' : order.payment.status || 'paid',
    });
  }

  return payments;
}

export function calculateReport(
  data: ReportDataSource,
  range: ReportDateRange,
  filters: ReportFilters = { paymentMethod: 'all', orderType: 'all' },
): ReportResult {
  const ordersById = new Map(data.orders.map(order => [order.id, order]));
  const allPayments = effectivePayments(data);
  const matchingMethodOrderIds =
    filters.paymentMethod === 'all'
      ? null
      : new Set(
          allPayments
            .filter(payment => payment.method === filters.paymentMethod)
            .map(payment => payment.orderId),
        );

  const scopedOrders = data.orders.filter(order =>
    timestampIsInRange(order.createdAt, range) &&
    (filters.orderType === 'all' || order.type === filters.orderType) &&
    (!matchingMethodOrderIds || matchingMethodOrderIds.has(order.id)),
  );
  const completedOrders = scopedOrders.filter(order => order.status === 'paid');
  const cancelledOrders = scopedOrders.filter(order => order.status === 'cancelled');
  const completedOrderIds = new Set(completedOrders.map(order => order.id));

  const paymentRecords: ReportPaymentRow[] = allPayments.flatMap(payment => {
    const order = ordersById.get(payment.orderId);
    if (
      !order ||
      !timestampIsInRange(payment.dateTime, range) ||
      (filters.paymentMethod !== 'all' && payment.method !== filters.paymentMethod) ||
      (filters.orderType !== 'all' && order.type !== filters.orderType)
    ) {
      return [];
    }
    return [{
      payment,
      orderNumber: order.orderNumber,
      orderType: order.type,
      orderStatus: order.status,
    }];
  });

  const salesPaymentRecords = allPayments.flatMap(payment => {
    const order = ordersById.get(payment.orderId);
    if (
      !order ||
      !completedOrderIds.has(order.id) ||
      payment.status !== 'paid' ||
      (filters.paymentMethod !== 'all' && payment.method !== filters.paymentMethod)
    ) {
      return [];
    }
    return [{
      payment,
      orderNumber: order.orderNumber,
      orderType: order.type,
      orderStatus: order.status,
    }];
  });

  const expenses = data.expenses.filter(expense => timestampIsInRange(expense.dateTime, range));
  const sales = completedOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + (Number(expense.total) || 0), 0);

  const salesByPaymentMethod = REPORT_PAYMENT_METHODS.map(method => ({
    method,
    amount: salesPaymentRecords
      .filter(row => row.payment.method === method)
      .reduce((sum, row) => sum + (Number(row.payment.amount) || 0), 0),
  }));

  const salesByOrderType = REPORT_ORDER_TYPES.map(type => {
    const orders = completedOrders.filter(order => order.type === type);
    return {
      type,
      orderCount: orders.length,
      amount: orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
    };
  });

  const categoryTotals = new Map<string, number>();
  for (const expense of expenses) {
    const category = expense.category.trim() || 'Uncategorized';
    categoryTotals.set(category, (categoryTotals.get(category) || 0) + (Number(expense.total) || 0));
  }
  const expensesByCategory = [...categoryTotals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category));

  const dailyBreakdown: DailyReportRow[] = [];
  for (let key = range.startDate; key <= range.endDate; key = addLocalDays(key, 1)) {
    const dailyOrders = completedOrders.filter(order => timestampLocalDateKey(order.createdAt) === key);
    const dailyExpenses = expenses.filter(expense => timestampLocalDateKey(expense.dateTime) === key);
    const dailySales = dailyOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const expenseTotal = dailyExpenses.reduce((sum, expense) => sum + (Number(expense.total) || 0), 0);
    dailyBreakdown.push({
      date: key,
      completedOrders: dailyOrders.length,
      sales: dailySales,
      expenses: expenseTotal,
      netAmount: dailySales - expenseTotal,
    });
  }

  const itemTotals = new Map<string, ItemSalesRow>();
  for (const order of completedOrders) {
    for (const item of order.items) {
      const key = `${item.menuItemId}\u0000${item.name}`;
      const current = itemTotals.get(key) || {
        menuItemId: item.menuItemId,
        name: item.name,
        quantity: 0,
        sales: 0,
      };
      current.quantity += Number(item.quantity) || 0;
      current.sales += Number(item.lineTotal) || 0;
      itemTotals.set(key, current);
    }
  }
  const itemsSold = [...itemTotals.values()]
    .sort((left, right) => right.quantity - left.quantity || right.sales - left.sales);

  return {
    range,
    filters,
    completedOrders,
    cancelledOrders,
    paymentRecords,
    salesPaymentRecords,
    expenses,
    dailyBreakdown,
    itemsSold,
    salesByPaymentMethod,
    salesByOrderType,
    expensesByCategory,
    totals: {
      sales,
      completedOrders: completedOrders.length,
      cancelledOrders: cancelledOrders.length,
      expenses: totalExpenses,
      netAmount: sales - totalExpenses,
      discounts: completedOrders.reduce((sum, order) => sum + (Number(order.discount) || 0), 0),
      deliveryCharges: completedOrders.reduce((sum, order) => sum + (Number(order.deliveryCharge) || 0), 0),
      averageOrderValue: completedOrders.length ? sales / completedOrders.length : 0,
    },
  };
}
