export type OrderType = 'Dine-in' | 'Takeaway' | 'Delivery';
export type OrderStatus = 'paid' | 'cancelled';
export type PaymentMethod = 'Cash' | 'Card' | 'Easypaisa' | 'JazzCash' | 'Other';
export interface User { id: string; name: string; username: string; password: string; role: string; createdAt: string }
export interface RestaurantSettings { id: string; name: string; address: string; phone: string; currency: string }
export interface Table { id: string; name: string; capacity: number; createdAt: string; updatedAt: string }
export interface Category { id: string; name: string; sortOrder: number; createdAt: string; updatedAt: string }
export interface MenuItem { id: string; name: string; description: string; price: number; categoryId: string; available: boolean; imageDataUrl?: string; createdAt: string; updatedAt: string }
export interface OrderItem { menuItemId: string; name: string; unitPrice: number; quantity: number; lineTotal: number; note?: string }
export interface Payment { id: string; orderId: string; method: PaymentMethod; amount: number; amountReceived?: number; change?: number; reference?: string; createdAt: string }
export interface Order { id: string; orderNumber: string; createdAt: string; updatedAt: string; type: OrderType; status: OrderStatus; tableId?: string; tableNameSnapshot?: string; customerName?: string; customerPhone?: string; deliveryAddress?: string; notes?: string; subtotal: number; discount: number; deliveryCharge: number; total: number; cashierName: string; items: OrderItem[]; payment?: Payment }
export interface AppData { users: User[]; settings: RestaurantSettings; tables: Table[]; categories: Category[]; menuItems: MenuItem[]; orders: Order[] }
export const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
export const now = () => new Date().toISOString();
export const money = (value: number, currency = 'PKR') => `${currency} ${Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
const stamp = now();
export const seededData: AppData = {
  users: [{ id: 'user-cashier-1', name: 'Ayesha Khan', username: 'cashier', password: '1234', role: 'Cashier', createdAt: stamp }],
  settings: { id: 'restaurant-1', name: 'Juniper & Hearth', address: '18 Garden Lane, Lahore', phone: '+92 300 555 0184', currency: 'PKR' },
  tables: [{ id: 'table-1', name: 'Table 1', capacity: 4, createdAt: stamp, updatedAt: stamp }],
  categories: [
    { id: 'cat-mains', name: 'From the tandoor', sortOrder: 0, createdAt: stamp, updatedAt: stamp },
    { id: 'cat-rice', name: 'Rice & bowls', sortOrder: 1, createdAt: stamp, updatedAt: stamp },
    { id: 'cat-sides', name: 'On the side', sortOrder: 2, createdAt: stamp, updatedAt: stamp },
    { id: 'cat-drinks', name: 'Cool things', sortOrder: 3, createdAt: stamp, updatedAt: stamp },
    { id: 'cat-sweets', name: 'Something sweet', sortOrder: 4, createdAt: stamp, updatedAt: stamp },
  ],
  menuItems: [
    ['item-chicken-karahi', 'Chicken karahi', 'Slow-cooked tomato, ginger & green chilli', 1450, 'cat-mains'],
    ['item-seekh', 'Beef seekh kebab', 'Charcoal-grilled, house spice, two pieces', 780, 'cat-mains'],
    ['item-paneer', 'Paneer tikka', 'Smoky paneer, mint yoghurt', 920, 'cat-mains'],
    ['item-daal', 'Daal makhani', 'Black lentils, finished with cultured cream', 740, 'cat-mains'],
    ['item-biryani', 'Chicken biryani', 'Aromatic basmati, saffron & crisp onions', 890, 'cat-rice'],
    ['item-pulao', 'Yakhni pulao', 'Fragrant stock, tender beef, raita', 980, 'cat-rice'],
    ['item-naan', 'Butter naan', 'Fresh from the clay oven', 120, 'cat-sides'],
    ['item-raita', 'Cucumber raita', 'Mint, cucumber & cool yoghurt', 180, 'cat-sides'],
    ['item-lassi', 'Mango lassi', 'Seasonal mango, thick yoghurt', 320, 'cat-drinks'],
    ['item-kheer', 'Cardamom kheer', 'Slow-cooked rice pudding, pistachio', 360, 'cat-sweets'],
  ].map(([id, name, description, price, categoryId]) => ({ id: String(id), name: String(name), description: String(description), price: Number(price), categoryId: String(categoryId), available: true, createdAt: stamp, updatedAt: stamp })),
  orders: [],
};
