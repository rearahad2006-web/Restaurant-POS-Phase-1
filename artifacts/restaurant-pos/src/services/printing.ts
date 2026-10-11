import type { Order, RestaurantSettings } from '../domain';

/** Isolated printing boundary. This is only the browser dialog fallback, not thermal-printer integration. */
export function printReceipt(): void {
  document.body.removeAttribute('data-print-layout');
  window.print();
}

/** Opens one browser print dialog with the customer receipt and kitchen token in separate sections. */
export function printCompletedOrder(): void {
  document.body.dataset.printLayout = 'order-bundle';
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    document.body.removeAttribute('data-print-layout');
    window.removeEventListener('afterprint', cleanup);
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  cleanupTimer = window.setTimeout(cleanup, 60_000);
  try {
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeLogo = (value?: string) =>
  value && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value) ? value : '';

export function buildKitchenTokenMarkup(order: Order, settings: RestaurantSettings): string {
  const logo = safeLogo(settings.logoDataUrl);
  const widthClass = settings.printWidth === 'wide' ? 'wide' : 'narrow';
  const itemRows = order.items.map(item => `
    <li class="kitchen-token-item"><div class="kitchen-token-item-name"><b>${item.quantity} ×</b><span>${escapeHtml(item.name)}</span></div>
      ${item.note ? `<small>Prep: ${escapeHtml(item.note)}</small>` : ''}
    </li>`).join('');
  const dealRows = (order.deals || []).map(deal => `
    <li class="kitchen-token-deal"><div class="kitchen-token-item-name"><b>${deal.quantity} ×</b><strong>${escapeHtml(deal.name)}</strong></div>
      <ul>${deal.items.map(item => `<li>${item.quantity * deal.quantity} × ${escapeHtml(item.name)}</li>`).join('')}</ul>
    </li>`).join('');
  const customer = [order.customerName, order.customerPhone].filter(Boolean).map(value => escapeHtml(value as string)).join(' · ');
  const table = order.type === 'Dine-in' && order.tableNameSnapshot
    ? `<span>${escapeHtml(order.tableNameSnapshot)}</span>`
    : '';
  return `<section class="kitchen-token ${widthClass}" data-testid="kitchen-token-${escapeHtml(order.id)}" aria-label="Kitchen token">
    <header class="kitchen-token-header">${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}
      ${settings.name.trim() ? `<span>${escapeHtml(settings.name)}</span>` : ''}
    </header>
    <div class="kitchen-token-order-number">${escapeHtml(order.orderNumber)}</div>
    <div class="kitchen-token-meta">${escapeHtml(new Date(order.createdAt).toLocaleString())}</div>
    <div class="kitchen-token-context"><b>${escapeHtml(order.type)}</b>${table}</div>
    ${customer ? `<div class="kitchen-token-customer">${customer}</div>` : ''}
    ${order.deliveryAddress ? `<div class="kitchen-token-address">Deliver to: ${escapeHtml(order.deliveryAddress)}</div>` : ''}
    ${order.notes ? `<div class="kitchen-token-order-note"><b>Order note:</b> ${escapeHtml(order.notes)}</div>` : ''}
    <ul class="kitchen-token-items">${itemRows}${dealRows}</ul>
  </section>`;
}

export function buildKitchenTokenHtml(order: Order, settings: RestaurantSettings): string {
  const paperWidth = settings.printWidth === 'wide' ? '80mm' : '58mm';
  const bodyWidth = settings.printWidth === 'wide' ? '76mm' : '54mm';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Kitchen token ${escapeHtml(order.orderNumber)}</title>
    <style>
      @page{size:${paperWidth} auto;margin:2mm}
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111}
      body{width:${bodyWidth};font:14px/1.3 Arial,sans-serif}
      .kitchen-token{width:100%;padding:0;font:14px/1.3 Arial,sans-serif;color:#111;background:#fff}
      .kitchen-token-header{text-align:center;border-bottom:1px dashed #333;padding:0 0 5px;margin:0 0 5px;font-size:11px;font-weight:600}
      .kitchen-token-header img{display:block;max-width:30mm;max-height:12mm;object-fit:contain;margin:0 auto 4px}
      .kitchen-token-order-number{text-align:center;font-size:24px;line-height:1.1;font-weight:800;margin:4px 0}
      .kitchen-token-meta{text-align:center;font-size:11px;margin:0 0 5px}
      .kitchen-token-context{display:flex;justify-content:space-between;gap:5px;padding:5px 0;border-top:1px dashed #555;border-bottom:1px dashed #555;font-size:12px}
      .kitchen-token-customer,.kitchen-token-address,.kitchen-token-order-note{font-size:12px;margin:5px 0}
      .kitchen-token-order-note{border:1px solid #555;padding:4px}
      .kitchen-token-items{list-style:none;padding:0;margin:4px 0 0}
      .kitchen-token-item,.kitchen-token-deal{padding:5px 0;border-bottom:1px solid #bbb}
      .kitchen-token-item-name{display:flex;gap:5px;align-items:baseline;font-size:15px;font-weight:700;line-height:1.2}
      .kitchen-token-item small{display:block;font-size:12px;margin:3px 0 0 20px}
      .kitchen-token-deal ul{list-style:none;padding:0 0 0 20px;margin:3px 0 0;font-size:13px}
      .kitchen-token-deal li{padding:1px 0}
    </style></head><body>${buildKitchenTokenMarkup(order, settings)}</body></html>`;
}

/** Prints one selected kitchen token in an isolated frame; it never prints the customer receipt or prices. */
export function printKitchenToken(order: Order, settings: RestaurantSettings): void {
  const frame = document.createElement('iframe');
  frame.title = `Kitchen token ${order.orderNumber}`;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.width = '1px';
  frame.style.height = '1px';
  frame.style.border = '0';
  let printed = false;
  frame.onload = () => {
    if (printed) return;
    printed = true;
    const printWindow = frame.contentWindow;
    if (!printWindow) {
      frame.remove();
      return;
    }
    const cleanup = () => frame.remove();
    printWindow.addEventListener('afterprint', () => window.setTimeout(cleanup, 300));
    printWindow.focus();
    printWindow.print();
    window.setTimeout(cleanup, 60_000);
  };
  document.body.appendChild(frame);
  frame.srcdoc = buildKitchenTokenHtml(order, settings);
}
