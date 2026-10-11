import type { AppData, BusinessDay, Order } from '../domain';

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function previousLocalDateKey(date: Date): string {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return localDateKey(previous);
}

/** The restaurant day rolls back after midnight through 2:59 AM. */
export function businessDateForTimestamp(value: string | Date): string {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid local timestamp.');
  return date.getHours() < 3 ? previousLocalDateKey(date) : localDateKey(date);
}

export function activeBusinessDay(days: readonly BusinessDay[]): BusinessDay | undefined {
  return days.find(day => day.status === 'open');
}

export function businessDateForRecord(
  value: string,
  businessDayId: string | undefined,
  data: Pick<AppData, 'businessDays'>,
): string {
  const assigned = businessDayId
    ? data.businessDays.find(day => day.id === businessDayId)
    : undefined;
  return assigned?.businessDate || businessDateForTimestamp(value);
}

export function isOrderOccupyingTable(order: Order, day?: BusinessDay): boolean {
  const belongsToCurrentDay = !!day && day.status === 'open' &&
    (order.businessDayId ? order.businessDayId === day.id : businessDateForTimestamp(order.createdAt) === day.businessDate);
  return belongsToCurrentDay &&
    order.type === 'Dine-in' &&
    order.status === 'paid' &&
    !!order.tableId &&
    !order.tableReleasedAt;
}

export function occupiedTableIds(orders: readonly Order[], day?: BusinessDay): Set<string> {
  return new Set(orders.filter(order => isOrderOccupyingTable(order, day)).map(order => order.tableId as string));
}

export function nextAvailableTableId(
  tables: readonly { id: string }[],
  occupied: ReadonlySet<string>,
): string | null {
  return tables.find(table => !occupied.has(table.id))?.id || null;
}

export function closeBusinessDay(
  day: BusinessDay,
  endedBy: string,
  endAt: string,
  closingCash?: number,
): BusinessDay {
  if (day.status !== 'open') throw new Error('This business day is already closed.');
  return {
    ...day,
    status: 'closed',
    endAt,
    endedBy,
    closingCash: Number.isFinite(closingCash) && closingCash! >= 0 ? closingCash : undefined,
  };
}
