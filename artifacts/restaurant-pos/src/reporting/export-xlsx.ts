import writeXlsxFile, {
  type Cell,
  type Row,
  type Sheet,
  type SheetData,
} from 'write-excel-file/universal';
import type { RestaurantSettings } from '../domain';
import {
  formatLocalDateKey,
  formatLocalDateTime,
  ITEM_SALES_NOTE,
  NET_AMOUNT_NOTE,
  type ReportResult,
} from './report-calculations';

const PKR_FORMAT = '"PKR" #,##0.00';
const HEADER_STYLE = { fontWeight: 'bold' as const, backgroundColor: '#234a39', textColor: '#ffffff' };

function textCell(value: unknown): Cell {
  return { value: value === null || value === undefined ? '' : String(value), type: String };
}

function countCell(value: number): Cell {
  return { value: Number(value) || 0, type: Number, format: '#,##0' };
}

function amountCell(value: number): Cell {
  return { value: Number(value) || 0, type: Number, format: PKR_FORMAT };
}

function headerRow(...labels: string[]): Row {
  return labels.map(value => ({ value, type: String, ...HEADER_STYLE }));
}

function sheet(name: string, data: SheetData, widths: number[]): Sheet<Blob> {
  return {
    sheet: name,
    data,
    columns: widths.map(width => ({ width })),
    showGridLines: false,
    stickyRowsCount: 1,
  };
}

function safeFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'restaurant';
}

export async function buildReportWorkbookBlob(
  report: ReportResult,
  settings: RestaurantSettings,
): Promise<{ blob: Blob; filename: string }> {
  const summary: SheetData = [
    headerRow('Restaurant Report', 'Value'),
    [textCell('Restaurant'), textCell(settings.name)],
    [textCell('Reporting period'), textCell(report.range.label)],
    [textCell('Register timezone'), textCell(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local time')],
    [textCell('Generated at'), textCell(formatLocalDateTime(new Date()))],
    [textCell('Payment method filter'), textCell(report.filters.paymentMethod)],
    [textCell('Order type filter'), textCell(report.filters.orderType)],
    [textCell('Total sales from completed orders'), amountCell(report.totals.sales)],
    [textCell('Completed orders'), countCell(report.totals.completedOrders)],
    [textCell('Cancelled orders (separate)'), countCell(report.totals.cancelledOrders)],
    [textCell('Total recorded expenses'), amountCell(report.totals.expenses)],
    [textCell('Net Amount After Recorded Expenses'), amountCell(report.totals.netAmount)],
    [textCell('Total discounts'), amountCell(report.totals.discounts)],
    [textCell('Delivery charges collected'), amountCell(report.totals.deliveryCharges)],
    [textCell('Average completed-order value'), amountCell(report.totals.averageOrderValue)],
    [textCell('Net amount definition'), textCell(NET_AMOUNT_NOTE)],
    [textCell('Item sales limitation'), textCell(ITEM_SALES_NOTE)],
    headerRow('Sales by Payment Method', 'Amount'),
    ...report.salesByPaymentMethod.map(row => [textCell(row.method), amountCell(row.amount)]),
    headerRow('Sales by Order Type', 'Completed Orders', 'Sales Amount'),
    ...report.salesByOrderType.map(row => [
      textCell(row.type),
      countCell(row.orderCount),
      amountCell(row.amount),
    ]),
    headerRow('Expenses by Category', 'Amount'),
    ...(report.expensesByCategory.length
      ? report.expensesByCategory.map(row => [textCell(row.category), amountCell(row.amount)])
      : [[textCell('No recorded expenses'), amountCell(0)]]),
  ];

  const sales: SheetData = [
    headerRow(
      'Order ID',
      'Order Number',
      'Date & Time',
      'Status',
      'Order Type',
      'Table / Customer',
      'Cashier',
      'Subtotal',
      'Discount',
      'Delivery Charge',
      'Order Total',
    ),
    ...report.completedOrders.map(order => [
      textCell(order.id),
      textCell(order.orderNumber),
      textCell(formatLocalDateTime(order.createdAt)),
      textCell('Completed'),
      textCell(order.type),
      textCell(order.tableNameSnapshot || order.customerName || 'Walk-in'),
      textCell(order.cashierName),
      amountCell(order.subtotal),
      amountCell(order.discount),
      amountCell(order.deliveryCharge),
      amountCell(order.total),
    ]),
  ];

  const payments: SheetData = [
    headerRow(
      'Payment ID',
      'Order Number',
      'Date & Time',
      'Payment Method',
      'Amount',
      'Status',
      'Cash Received',
      'Change',
      'Reference',
    ),
    ...report.paymentRecords.map(({ payment, orderNumber }) => [
      textCell(payment.id),
      textCell(orderNumber),
      textCell(formatLocalDateTime(payment.dateTime)),
      textCell(payment.method),
      amountCell(payment.amount),
      textCell(payment.status),
      payment.amountReceived === undefined ? textCell('') : amountCell(payment.amountReceived),
      payment.change === undefined ? textCell('') : amountCell(payment.change),
      textCell(payment.reference),
    ]),
  ];

  const expenses: SheetData = [
    headerRow(
      'Expense ID',
      'Date & Time',
      'Purpose',
      'Category',
      'Quantity',
      'Unit Price',
      'Total',
      'Payment Method',
      'Supplier',
      'Notes',
      'Added By',
    ),
    ...report.expenses.map(expense => [
      textCell(expense.id),
      textCell(formatLocalDateTime(expense.dateTime)),
      textCell(expense.purpose),
      textCell(expense.category),
      countCell(expense.quantity),
      amountCell(expense.unitPrice),
      amountCell(expense.total),
      textCell(expense.paymentMethod),
      textCell(expense.supplier),
      textCell(expense.notes),
      textCell(expense.addedBy),
    ]),
  ];

  const dailyBreakdown: SheetData = [
    headerRow('Date', 'Completed Orders', 'Sales Total', 'Expenses Total', 'Net Amount After Recorded Expenses'),
    ...report.dailyBreakdown.map(row => [
      textCell(formatLocalDateKey(row.date)),
      countCell(row.completedOrders),
      amountCell(row.sales),
      amountCell(row.expenses),
      amountCell(row.netAmount),
    ]),
  ];

  const itemsSold: SheetData = [
    headerRow('Item Name', 'Menu Item ID', 'Quantity Sold', 'Sales Amount (Saved Line Total)'),
    ...report.itemsSold.map(row => [
      textCell(row.name),
      textCell(row.menuItemId),
      countCell(row.quantity),
      amountCell(row.sales),
    ]),
    [],
    [textCell('Note'), textCell(ITEM_SALES_NOTE)],
  ];

  const sheets: Sheet<Blob>[] = [
    sheet('Summary', summary, [40, 58, 25]),
    sheet('Sales', sales, [22, 18, 22, 14, 16, 28, 22, 17, 17, 20, 17]),
    sheet('Payments', payments, [22, 18, 22, 20, 17, 14, 17, 14, 26]),
    sheet('Expenses', expenses, [22, 22, 28, 20, 13, 16, 16, 20, 24, 36, 22]),
    sheet('Daily Breakdown', dailyBreakdown, [20, 20, 20, 20, 34]),
    sheet('Items Sold', itemsSold, [34, 24, 18, 32]),
  ];

  const reportFile = await writeXlsxFile(sheets, { fontFamily: 'Arial', fontSize: 10 });
  const filename = `${safeFilename(settings.name)}_report_${report.range.startDate}_to_${report.range.endDate}.xlsx`;
  return { blob: await reportFile.toBlob(), filename };
}

export async function downloadReportWorkbook(
  report: ReportResult,
  settings: RestaurantSettings,
): Promise<void> {
  const { blob, filename } = await buildReportWorkbookBlob(report, settings);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
