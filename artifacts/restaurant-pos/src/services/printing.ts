/** Isolated printing boundary. This is only the browser dialog fallback, not thermal-printer integration. */
export function printReceipt(): void {
  window.print();
}
