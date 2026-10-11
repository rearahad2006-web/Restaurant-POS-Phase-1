import type { Order, RestaurantSettings } from '../domain';

/** Isolated printing boundary. This is only the browser dialog fallback, not thermal-printer integration. */
export function printReceipt(): void {
  window.print();
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const safeLogo = (value?: string) =>
  value && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(value) ? value : '';

export function buildKitchenTokenHtml(order: Order, settings: RestaurantSettings): string {
  const logo = safeLogo(settings.logoDataUrl);
  const itemRows = order.items.map(item => `
    <li><span>${item.quantity} × ${escapeHtml(item.name)}</span>
      ${item.note ? `<small>Preparation: ${escapeHtml(item.note)}</small>` : ''}
    </li>`).join('');
  const dealRows = (order.deals || []).map(deal => `
    <li class="deal"><span>${deal.quantity} × ${escapeHtml(deal.name)}</span>
      <ul>${deal.items.map(item => `<li>${item.quantity * deal.quantity} × ${escapeHtml(item.name)}</li>`).join('')}</ul>
      ${deal.description ? `<small>${escapeHtml(deal.description)}</small>` : ''}
    </li>`).join('');
  const customer = [order.customerName, order.customerPhone].filter(Boolean).map(value => escapeHtml(value as string)).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kitchen token ${escapeHtml(order.orderNumber)}</title>
    <style>
      @page{size:80mm auto;margin:5mm}
      *{box-sizing:border-box}body{font:14px/1.45 Arial,sans-serif;color:#111;margin:0;max-width:80mm}
      header{text-align:center;border-bottom:2px dashed #333;padding-bottom:10px;margin-bottom:10px}
      header img{display:block;max-width:38mm;max-height:18mm;object-fit:contain;margin:0 auto 7px}
      h1{font-size:19px;margin:0 0 4px}h2{font-size:15px;margin:12px 0 4px}
      .meta{font-size:12px}.order-no{font-size:22px;font-weight:bold;margin-top:5px}
      .notes{border:1px solid #333;padding:7px;margin:10px 0;font-weight:bold}
      ul{padding:0;list-style:none;margin:7px 0}li{padding:7px 0;border-bottom:1px solid #bbb;font-weight:bold}
      li ul{margin:4px 0 0 12px}li ul li{padding:3px 0;border:0;font-weight:normal}
      small{display:block;font-weight:normal;font-size:12px;margin-top:3px}.footer{margin-top:10px;padding-top:8px;border-top:2px dashed #333;font-size:11px}
    </style></head><body>
    <header>${logo ? `<img src="${escapeHtml(logo)}" alt="">` : ''}
      <h1>${escapeHtml(settings.name)}</h1><div class="meta">${escapeHtml(settings.address)}</div><div class="meta">${escapeHtml(settings.phone)}</div>
      <div class="order-no">${escapeHtml(order.orderNumber)}</div><div class="meta">${escapeHtml(new Date(order.createdAt).toLocaleString())}</div>
    </header>
    <div><b>${escapeHtml(order.type)}</b>${order.tableNameSnapshot ? ` · ${escapeHtml(order.tableNameSnapshot)}` : ''}</div>
    ${customer ? `<div>${customer}</div>` : ''}
    ${order.deliveryAddress ? `<div>${escapeHtml(order.deliveryAddress)}</div>` : ''}
    ${order.notes ? `<div class="notes">Order note: ${escapeHtml(order.notes)}</div>` : ''}
    <h2>Items to prepare</h2><ul>${itemRows}${dealRows}</ul>
    <div class="footer">Kitchen token · ${escapeHtml(order.cashierName)}</div>
    </body></html>`;
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
