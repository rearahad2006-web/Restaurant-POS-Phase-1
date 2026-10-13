import { useEffect, useMemo, useRef, useState, createContext, useContext, type ReactNode, type FormEvent } from 'react';
import { Route, Switch, Link, useLocation } from 'wouter';
import { LayoutDashboard, ShoppingCart, UtensilsCrossed, Armchair, ClipboardList, Search, Plus, Minus, Trash2, Pencil, Printer, LogOut, Banknote, CircleDollarSign, Clock3, Check, X, ChevronRight, CircleHelp, ReceiptText, WifiOff, PackagePlus, Users, Salad, CreditCard, MapPin, Phone, FileText, AlertCircle, ArrowUpRight, BarChart3, Settings, UserRound, CalendarDays, Eye } from 'lucide-react';
import { AppData, BusinessDay, Category, Deal, DealItem, Expense, MenuItem, Order, OrderDeal, OrderItem, OrderType, PaymentMethod, Payment, Table, UserRole, money, makeId, now } from './domain';
import { repository } from './storage/repository';
import {
  downloadMigrationFile,
  LocalServiceRepository,
  localService,
  usesLocalSqlite,
  type LocalServiceBootstrap,
  type VerifiedLocalDatabaseBackup,
} from './storage/local-service';
import {
  LocalImportGate,
  LocalLoginGate,
  LocalManagerSetupGate,
  LocalServiceStatus,
} from './components/LocalServiceGate';
import { buildKitchenTokenMarkup, printCompletedOrder, printKitchenToken, printReceipt } from './services/printing';
import './pos-workflow.css';
import { downloadReportWorkbook } from './reporting/export-xlsx';
import { activeBusinessDay, businessDateForRecord, businessDateForTimestamp, closeBusinessDay, isOrderOccupyingTable, nextAvailableTableId, occupiedTableIds } from './domain/business-days';
import {
  calculateReport,
  formatLocalDateKey,
  localDateKey,
  REPORT_ORDER_TYPES,
  REPORT_PAYMENT_METHODS,
  REPORT_PERIOD_OPTIONS,
  resolveReportDateRange,
  type ReportPeriod,
} from './reporting/report-calculations';

interface Store {
  data: AppData;
  setData: (updater: (data: AppData) => AppData) => void;
  flushSave: () => Promise<void>;
  retrySave: () => void;
  persistenceError: string;
  user: AppData['users'][number] | null;
  setUser: (user: AppData['users'][number] | null) => void;
  draftTableId: string | null;
  setDraftTableId: (id: string | null) => void;
  recoveryDetected: boolean;
  setRecoveryDetected: (value: boolean) => void;
  toast: (message: string) => void;
}
const StoreContext = createContext<Store | null>(null);
const useStore = () => { const value = useContext(StoreContext); if (!value) throw new Error('Store unavailable'); return value; };
const currency = (data: AppData) => data.settings.currency;
const RUNTIME_SESSION_KEY = 'juniper-pos.runtime-session';
const appRepository = usesLocalSqlite ? new LocalServiceRepository() : repository;
function App() {
  const [data, setDataState] = useState<AppData | null>(null);
  const dataRef = useRef<AppData | null>(null);
  const [user, setUser] = useState<AppData['users'][number] | null>(() => {
    if (usesLocalSqlite) return null;
    try { return JSON.parse(localStorage.getItem('juniper-pos.user') || 'null'); } catch { return null; }
  });
  const [draftTableId, setDraftTableId] = useState<string | null>(null);
  const [recoveryDetected, setRecoveryDetected] = useState(false);
  const [toastText, setToastText] = useState('');
  const [bootstrap, setBootstrap] = useState<LocalServiceBootstrap | null>(null);
  const [serviceLoading, setServiceLoading] = useState(usesLocalSqlite);
  const [serviceError, setServiceError] = useState('');
  const [persistenceError, setPersistenceError] = useState('');
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const lastSaveError = useRef<Error | null>(null);
  const [, setLocation] = useLocation();

  const loadSignedInData = async (signedInUser: AppData['users'][number]) => {
    const loaded = await appRepository.load();
    dataRef.current = loaded;
    setDataState(loaded);
    setUser(signedInUser);
    setServiceError('');
    setLocation(signedInUser.role === 'Manager' ? '/dashboard' : '/pos');
  };

  const connectLocalService = async () => {
    setServiceLoading(true);
    setServiceError('');
    try {
      const info = await localService.bootstrap();
      setBootstrap(info);
      if (!info.needsImport && !info.needsManagerSetup) {
        const existingUser = await localService.session();
        if (existingUser) {
          const loaded = await appRepository.load();
          dataRef.current = loaded;
          setDataState(loaded);
          setUser(existingUser);
        } else {
          dataRef.current = null;
          setDataState(null);
          setUser(null);
        }
      } else {
        dataRef.current = null;
        setDataState(null);
        setUser(null);
      }
    } catch (error) {
      setServiceError(error instanceof Error ? error.message : 'Could not open the local POS service.');
    } finally {
      setServiceLoading(false);
    }
  };

  useEffect(() => {
    try {
      setRecoveryDetected(Boolean(localStorage.getItem(RUNTIME_SESSION_KEY)));
      localStorage.setItem(RUNTIME_SESSION_KEY, JSON.stringify({ openedAt: now() }));
    } catch { /* Local persistence errors are reported by repository operations. */ }
    if (usesLocalSqlite) {
      void connectLocalService();
    } else {
      appRepository.load().then(loaded => {
        dataRef.current = loaded;
        setDataState(loaded);
      }).catch(error => {
        setServiceError(error instanceof Error ? error.message : 'Could not load register data.');
      });
    }
  }, []);

  const enqueueSave = (snapshot: AppData) => {
    saveQueue.current = saveQueue.current.then(async () => {
      await appRepository.save(snapshot);
      lastSaveError.current = null;
      setPersistenceError('');
    }).catch(error => {
      const cause = error instanceof Error ? error : new Error('Unknown storage error.');
      lastSaveError.current = cause;
      setPersistenceError(cause.message);
    });
  };
  const setData = (updater: (current: AppData) => AppData) => {
    const current = dataRef.current;
    if (!current) return;
    const next = updater(current);
    dataRef.current = next;
    setDataState(next);
    enqueueSave(next);
  };
  const flushSave = async () => {
    await saveQueue.current;
    if (lastSaveError.current) throw lastSaveError.current;
  };
  const retrySave = () => {
    const current = dataRef.current;
    if (!current) return;
    lastSaveError.current = null;
    enqueueSave(current);
  };
  const toast = (message: string) => { setToastText(message); window.setTimeout(() => setToastText(''), 2600); };
  if (usesLocalSqlite) {
    if (serviceLoading) {
      return <div className="login-screen"><div className="login-art"><div className="login-brand"><div className="brand-mark">J</div><div><div className="brand-name">Juniper &amp; Hearth</div><div className="brand-sub">Local service desk</div></div></div><div className="login-hero"><h1>Opening the local register.</h1><p>Checking the SQLite service on this computer.</p></div><span className="login-food-note">Your register data stays on this computer.</span></div><div className="login-form-side"><div className="panel" style={{ padding: 24, width: 320 }}><div className="stat-label">LOCAL DATABASE</div><div className="stat-value">Connecting…</div></div></div></div>;
    }
    if (serviceError) return <LocalServiceStatus message={serviceError} onRetry={() => { void connectLocalService(); }} />;
    if (!bootstrap) return <LocalServiceStatus message="The local POS service did not return its setup status." onRetry={() => { void connectLocalService(); }} />;
    if (bootstrap.needsImport) return <LocalImportGate onImported={setBootstrap} />;
    if (bootstrap.needsManagerSetup) {
      return <LocalManagerSetupGate
        restaurantName={bootstrap.restaurantName}
        onSetup={async () => {
          const signedInUser = await localService.session();
          if (!signedInUser) throw new Error('Manager setup completed, but sign-in could not be confirmed.');
          await loadSignedInData(signedInUser);
        }}
      />;
    }
    if (!user) {
      return <LocalLoginGate
        restaurantName={bootstrap.restaurantName}
        onLogin={async (username, password) => {
          const signedInUser = await localService.login(username, password);
          await loadSignedInData(signedInUser);
        }}
      />;
    }
    if (!data) return <LocalServiceStatus message="The local account is signed in, but POS data could not be loaded." onRetry={() => { void connectLocalService(); }} />;
  }
  if (!data) return <div className="login-screen"><div className="login-art"><div className="login-brand"><div className="brand-mark">J</div><div><div className="brand-name">Juniper & Hearth</div><div className="brand-sub">Local service desk</div></div></div><div className="login-hero"><h1>Service, in good hands.</h1><p>Starting your local register and preparing today's menu.</p></div><span className="login-food-note">A neighborhood table since 2019</span></div><div className="login-form-side"><div className="panel" style={{ padding: 24, width: 320 }}><div className="stat-label">OPENING REGISTER</div><div className="stat-value">Ready shortly</div><div style={{ height: 8, borderRadius: 20, background: 'hsl(var(--secondary))' }} /></div></div></div>;
  return <StoreContext.Provider value={{ data, setData, flushSave, retrySave, persistenceError, user, setUser, draftTableId, setDraftTableId, recoveryDetected, setRecoveryDetected, toast }}>
      <Switch><Route path="/login" component={LoginPage} /><Route><ProtectedShell><Switch><Route path="/" component={DashboardPage} /><Route path="/dashboard" component={DashboardPage} /><Route path="/pos" component={PosPage} /><Route path="/tables" component={TablesPage} /><Route path="/menu" component={MenuPage} /><Route path="/deals" component={DealsPage} /><Route path="/business-day" component={BusinessDayPage} /><Route path="/orders" component={OrdersPage} /><Route path="/payments" component={PaymentsPage} /><Route path="/expenses" component={ExpensesPage} /><Route path="/reports" component={ReportsPage} /><Route path="/staff" component={StaffPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFoundPage} /></Switch></ProtectedShell></Route></Switch>
    {toastText && <div className="notice" role="status" data-testid="status-notice">{toastText}</div>}
    {persistenceError && <div className="persistence-failure" role="alert"><span><b>POS data was not saved.</b> {persistenceError}</span><button className="btn btn-sm" onClick={retrySave}>Retry save</button></div>}
  </StoreContext.Provider>;
}

function ProtectedShell({ children }: { children: ReactNode }) {
  const { user, setUser, data, setData, flushSave, recoveryDetected, setRecoveryDetected, toast } = useStore();
  const [location, setLocation] = useLocation();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [logoutCash, setLogoutCash] = useState('');
  const openDay = activeBusinessDay(data.businessDays);
  useEffect(() => { if (!user && location !== '/login') setLocation('/login'); }, [user, location, setLocation]);
  useEffect(() => { if (user?.role !== 'Manager' && !['/pos', '/orders', '/payments'].includes(location)) setLocation('/pos'); }, [user, location, setLocation]);
  if (!user) return <LoginPage />;
  if (user.role !== 'Manager' && !['/pos', '/orders', '/payments'].includes(location)) return <div className="page"><PageHeader eyebrow="ACCESS RESTRICTED" title="Manager access required." subtitle="Cashier accounts can use the point of sale, order history and payment ledger." /><Link className="btn btn-primary" href="/pos">Return to the register</Link></div>;
  const links = (user.role === 'Manager' ? [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/pos', label: 'POS', icon: ShoppingCart },
    { href: '/orders', label: 'Orders', icon: ClipboardList },
    { href: '/payments', label: 'Payments', icon: Banknote },
    { href: '/expenses', label: 'Expenses', icon: ReceiptText },
    { href: '/menu', label: 'Menu', icon: UtensilsCrossed },
    { href: '/tables', label: 'Tables', icon: Armchair },
    { href: '/reports', label: 'Reports', icon: BarChart3 },
    { href: '/deals', label: 'Deals', icon: PackagePlus },
    { href: '/business-day', label: 'Business day', icon: CalendarDays },
    { href: '/staff', label: 'Staff', icon: Users },
    { href: '/settings', label: 'Settings', icon: Settings },
  ] : [
    { href: '/pos', label: 'POS', icon: ShoppingCart },
    { href: '/orders', label: 'Orders', icon: ClipboardList },
    { href: '/payments', label: 'Payments', icon: Banknote },
  ]);
  const signOut = async (endDay: boolean) => {
    if (endDay && openDay && user.role === 'Manager') {
      const amount = logoutCash.trim() ? Number(logoutCash) : undefined;
      setData(current => ({ ...current, businessDays: current.businessDays.map(day => day.id === openDay.id ? closeBusinessDay(day, user.name, now(), amount) : day) }));
    }
    if (usesLocalSqlite) {
      try {
        await flushSave();
        await localService.logout();
      } catch (error) {
        toast(error instanceof Error ? `Sign-out stopped because saving failed: ${error.message}` : 'Sign-out stopped because the local register could not save.');
        return;
      }
    }
    setUser(null);
    if (!usesLocalSqlite) localStorage.removeItem('juniper-pos.user');
    localStorage.removeItem(RUNTIME_SESSION_KEY);
    setRecoveryDetected(false);
    setLogoutOpen(false);
    setLocation('/login');
  };
  return <div className={`app-shell ${data.settings.compactDisplay ? 'compact-display' : ''}`}><aside className="sidebar"><div className="brand"><div className="brand-mark">J</div><div><div className="brand-name">{data.settings.name}</div><div className="brand-sub">Local service desk</div></div></div><div className="nav-label">Restaurant</div><nav>{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${location === href || (href === '/dashboard' && location === '/') ? 'active' : ''}`} data-testid={`link-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon className="nav-icon" /><span>{label}</span></Link>)}</nav><div className="sidebar-spacer" /><div className="local-note"><b><i className="local-dot" />Stored on this device</b>{usesLocalSqlite ? 'Core register data is kept in this computer’s SQLite file. No cloud connection is used.' : 'Core register data is kept in this browser. No cloud connection is needed.'}</div><div className="sidebar-user"><div className="avatar">{user.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</div><div className="user-copy"><div className="user-name">{user.name}</div><div className="user-role">{user.role} · local</div></div><button className="btn btn-quiet btn-sm" aria-label="Sign out" title="Sign out" onClick={() => { setLogoutCash(''); setLogoutOpen(true); }} data-testid="button-sign-out"><LogOut size={15} /></button></div></aside><main className="main-area"><header className="topbar"><div className="topbar-date">{new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</div><div className="topbar-right"><span className="badge" data-testid="status-business-day">{openDay ? `Business day · ${openDay.businessDate}` : 'No business day open'}</span><span className="offline-pill"><i />LOCAL · READY</span></div></header>{children}
    {logoutOpen && <Dialog title="Sign out" onClose={() => setLogoutOpen(false)}>
      {openDay ? <><div className="callout">Business day <b>{openDay.businessDate}</b> is still open. Ending it closes the day for new orders. Leaving it open preserves the day for another authorized staff member.</div>{user.role === 'Manager' && <div className="field" style={{ marginTop: 14 }}><label htmlFor="logout-closing-cash">Closing cash (optional)</label><input id="logout-closing-cash" type="number" min="0" step="0.01" className="input" value={logoutCash} onChange={event => setLogoutCash(event.target.value)} /></div>}</> : <p className="page-subtitle">No business day is currently open. Your saved orders and records will remain on this device.</p>}
      <div className="dialog-actions"><button className="btn" onClick={() => setLogoutOpen(false)}>Stay signed in</button><button className="btn" onClick={() => signOut(false)}>Leave day open & sign out</button>{openDay && user.role === 'Manager' && <button className="btn btn-danger" onClick={() => signOut(true)}>End day & sign out</button>}</div>
    </Dialog>}
    {recoveryDetected && openDay && user.role === 'Manager' && location !== '/business-day' && <div className="recovery-banner" role="status"><AlertCircle size={15} /><span>Previous register session ended unexpectedly. Business day {openDay.businessDate} remains open. No shutdown time was recorded.</span><Link href="/business-day" className="btn btn-sm">Review</Link></div>}
  </main></div>;
}

function PageHeader({ eyebrow, title, subtitle, action }: { eyebrow: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1>{subtitle && <p className="page-subtitle">{subtitle}</p>}</div>{action}</div>;
}
function orderContextLabel(order: Order): string {
  if (order.tableNameSnapshot) return order.tableNameSnapshot;
  if (order.type === 'Dine-in') return order.customerName ? `No table · ${order.customerName}` : 'No table';
  return order.customerName || 'Walk-in';
}
function LoginPage() {
  const { data, setUser, toast } = useStore();
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState('cashier');
  const [password, setPassword] = useState('1234');
  const [error, setError] = useState('');
  const submit = (event: FormEvent) => { event.preventDefault(); const found = data.users.find(candidate => candidate.username.toLowerCase() === username.trim().toLowerCase() && candidate.password === password); if (!found) { setError('That username or PIN does not match a local account.'); return; } setUser(found); localStorage.setItem('juniper-pos.user', JSON.stringify(found)); toast(`Welcome, ${found.name.split(' ')[0]}`); setLocation(found.role === 'Manager' ? '/dashboard' : '/pos'); };
  return <div className="login-screen"><section className="login-art"><div className="login-brand"><div className="brand-mark">J</div><div><div className="brand-name">{data.settings.name}</div><div className="brand-sub">Neighborhood kitchen · Lahore</div></div></div><div className="login-hero"><div className="eyebrow" style={{ color: '#e8a17f' }}>A SMALL PLACE, A GOOD TABLE</div><h1>Service, in good hands.</h1><p>A dependable local register for the rhythm of a family-run kitchen. Take orders, settle the bill, keep the line moving.</p></div><span className="login-food-note">Good food. Familiar faces. Every day.</span></section><section className="login-form-side"><form className="login-form" onSubmit={submit}><div className="eyebrow">STAFF SIGN-IN</div><h2>Welcome back.</h2><p>Sign in to open the register on this device.</p><div className="field"><label htmlFor="username">Username</label><input id="username" className="input" autoComplete="username" value={username} onChange={event => { setUsername(event.target.value); setError(''); }} data-testid="input-username" required /></div><div className="field"><label htmlFor="pin">PIN</label><input id="pin" className="input" type="password" inputMode="numeric" autoComplete="current-password" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} data-testid="input-pin" required /></div>{error && <div className="validation" role="alert">{error}</div>}<button className="btn btn-primary login-submit" type="submit" data-testid="button-sign-in">Open register <ChevronRight size={15} /></button><div className="dev-creds"><b>Development-only accounts</b><br />Manager <b>manager</b> · PIN <b>2468</b><br />Cashier <b>cashier</b> · PIN <b>1234</b></div><p style={{ marginTop: 20, fontSize: 10, lineHeight: 1.6 }}>Register data is saved in this browser. Receipt printing uses the browser print dialog.</p></form></section></div>;
}

function DashboardPage() {
  const { data } = useStore();
  const today = activeBusinessDay(data.businessDays)?.businessDate || businessDateForTimestamp(new Date());
  const orderBusinessDate = (order: Order) => businessDateForRecord(order.createdAt, order.businessDayId, data);
  const paymentBusinessDate = (payment: Payment) => {
    const order = data.orders.find(candidate => candidate.id === payment.orderId);
    return order ? orderBusinessDate(order) : businessDateForTimestamp(payment.dateTime);
  };
  const todayOrders = data.orders.filter(order => orderBusinessDate(order) === today);
  const paid = todayOrders.filter(order => order.status === 'paid');
  const paymentsToday = data.payments.filter(payment => paymentBusinessDate(payment) === today && payment.status === 'paid' && data.orders.find(order => order.id === payment.orderId)?.status === 'paid');
  const sales = paymentsToday.reduce((sum, payment) => sum + payment.amount, 0);
  const max = Math.max(1, ...Array.from({ length: 7 }, (_, i) => {
    const day = new Date(`${today}T12:00:00`); day.setDate(day.getDate() - (6 - i));
    const key = localDateKey(day);
    return data.payments.filter(payment => payment.status === 'paid' && paymentBusinessDate(payment) === key && data.orders.find(order => order.id === payment.orderId)?.status === 'paid').reduce((sum, payment) => sum + payment.amount, 0);
  }));
  const values = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(`${today}T12:00:00`); day.setDate(day.getDate() - (6 - i));
    const key = localDateKey(day);
    const amount = data.payments.filter(payment => payment.status === 'paid' && paymentBusinessDate(payment) === key && data.orders.find(order => order.id === payment.orderId)?.status === 'paid').reduce((sum, payment) => sum + payment.amount, 0);
    return { label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(day), amount, height: Math.max(5, amount / max * 100), today: key === today };
  });
  const { settings } = data;
  return <div className="page"><PageHeader eyebrow="SERVICE OVERVIEW" title="Good afternoon." subtitle={`${settings.name} · ${settings.address}`} action={<Link href="/pos" className="btn btn-primary" data-testid="button-new-order"><Plus size={15} /> Start an order</Link>} />
    <div className="stat-grid dashboard-stat-grid">
      <Stat label="Sales today" value={money(sales, currency(data))} foot={`${paid.length} completed ${paid.length === 1 ? 'order' : 'orders'}`} icon={<CircleDollarSign />} />
      <Stat label="Orders today" value={String(todayOrders.length)} foot={`${todayOrders.filter(order => order.status === 'cancelled').length} cancelled`} icon={<ReceiptText />} />
      <Stat label="Open tables" value={String(data.tables.length)} foot="Available for dine-in" icon={<Armchair />} />
      <Stat label="Completed orders" value={String(data.orders.filter(order => order.status === 'paid').length)} foot="All-time paid orders" icon={<Check />} />
      <Stat label="Cancelled orders" value={String(data.orders.filter(order => order.status === 'cancelled').length)} foot="All-time cancelled orders" icon={<X />} />
    </div>
    <div className="dash-grid"><section className="panel"><div className="panel-head"><div><div className="eyebrow">LAST SEVEN DAYS</div><h2 className="panel-title">Sales at a glance</h2></div><span className="badge badge-green">Local records</span></div><div className="chart-area">{values.map((item, index) => <div className="bar-wrap" key={item.label + index} title={`${item.label}: ${money(item.amount, currency(data))}`}><div className={`bar ${item.today ? 'today' : ''}`} style={{ height: `${item.height}%` }} /><span className="bar-label">{item.label}</span></div>)}</div></section>
      <section className="panel"><div className="panel-head"><div><div className="eyebrow">GET MOVING</div><h2 className="panel-title">Quick actions</h2></div><ArrowUpRight size={16} color="hsl(var(--muted-foreground))" /></div><div className="quick-grid"><Link href="/pos" className="btn quick-action" data-testid="quick-action-order"><ShoppingCart /><span>New order</span></Link><Link href="/tables" className="btn quick-action" data-testid="quick-action-tables"><Armchair /><span>Manage tables</span></Link><Link href="/menu" className="btn quick-action" data-testid="quick-action-menu"><Salad /><span>Update menu</span></Link><Link href="/orders" className="btn quick-action" data-testid="quick-action-orders"><ClipboardList /><span>Find an order</span></Link></div></section></div>
     <section className="panel" style={{ marginTop: 16 }}><div className="panel-head"><div><div className="eyebrow">PAYMENT MIX · TODAY</div><h2 className="panel-title">Sales by method</h2></div><Link href="/payments" className="btn btn-sm">Payment ledger <ChevronRight size={13} /></Link></div><div className="method-strip">{(['Cash','Card','Easypaisa','JazzCash','Other'] as PaymentMethod[]).map(method => { const amount = paymentsToday.filter(payment => payment.method === method).reduce((sum, payment) => sum + payment.amount, 0); return <div className="method-stat" key={method}><span>{method}</span><b>{money(amount, currency(data))}</b></div>; })}</div></section>
     <section className="panel" style={{ marginTop: 16 }}><div className="panel-head"><div><div className="eyebrow">THE LAST FEW BILLS</div><h2 className="panel-title">Recent orders</h2></div><Link href="/orders" className="btn btn-sm">View all <ChevronRight size={13} /></Link></div><OrdersTable rows={[...data.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5)} data={data} /></section>
  </div>;
}

function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="dialog" style={wide ? { width: 'min(720px, 100%)' } : undefined} role="dialog" aria-modal="true" aria-label={title}><div className="dialog-head"><h2 className="dialog-title">{title}</h2><button className="close-btn" onClick={onClose} aria-label="Close dialog"><X size={19} /></button></div><div className="dialog-content">{children}</div></section></div>;
}
function Receipt({ order, data }: { order: Order; data: AppData }) {
  const payment = data.payments.find(entry => entry.orderId === order.id) || order.payment;
  const cashPayment = payment?.method === 'Cash' ? payment : undefined;

  return (
    <div className={`receipt ${data.settings.printWidth || 'narrow'}`} data-testid={`receipt-${order.id}`}>
      <div className="receipt-center">
        {data.settings.logoDataUrl && <img className="receipt-logo" src={data.settings.logoDataUrl} alt={`${data.settings.name} logo`} data-testid={`receipt-logo-${order.id}`} />}
        <h2>{data.settings.name}</h2>
        <div className="receipt-sub">
          {data.settings.address}
          <br />
          {data.settings.phone}
        </div>
        <div>{order.status === 'cancelled' ? 'CANCELLED · ' : ''}Order {order.orderNumber}</div>
        <div className="receipt-sub">ID {order.id}</div>
        <div>{new Date(order.createdAt).toLocaleString()}</div>
      </div>
      <div className="receipt-rule" />
      <div>
        {order.type}
        {order.type === 'Dine-in' ? ` · ${order.tableNameSnapshot || 'No table'}` : order.tableNameSnapshot ? ` · ${order.tableNameSnapshot}` : ''}
      </div>
      {order.customerName && (
        <div>{order.customerName}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</div>
      )}
      {order.deliveryAddress && <div>{order.deliveryAddress}</div>}
      <div className="receipt-rule" />
      {order.items.map((item, index) => (
        <div key={`${item.menuItemId}-${index}`}>
          <div className="receipt-line">
            <span>{item.quantity} × {item.name}</span>
            <span>{money(item.lineTotal, currency(data))}</span>
          </div>
          <div className="receipt-sub">Unit price: {money(item.unitPrice, currency(data))}</div>
          {item.note && <div className="receipt-sub">Note: {item.note}</div>}
        </div>
      ))}
      {(order.deals || []).map((deal, index) => (
        <div key={`${deal.dealId}-${index}`}>
          <div className="receipt-line">
            <span>{deal.quantity} × {deal.name}</span>
            <span>{money(deal.lineTotal, currency(data))}</span>
          </div>
          <div className="receipt-sub">Includes: {deal.items.map(item => `${item.quantity * deal.quantity} × ${item.name}`).join(', ')}</div>
        </div>
      ))}
      <div className="receipt-rule" />
      <div className="receipt-line">
        <span>Subtotal</span>
        <span>{money(order.subtotal, currency(data))}</span>
      </div>
      {order.discount > 0 && (
        <div className="receipt-line">
          <span>Discount</span>
          <span>− {money(order.discount, currency(data))}</span>
        </div>
      )}
      {order.deliveryCharge > 0 && (
        <div className="receipt-line">
          <span>Delivery</span>
          <span>{money(order.deliveryCharge, currency(data))}</span>
        </div>
      )}
      <div className="receipt-line receipt-total">
        <span>TOTAL</span>
        <span>{money(order.total, currency(data))}</span>
      </div>
      {payment && (
        <>
          <div className="receipt-line">
            <span>Paid · {payment.method}</span>
            <span>{money(payment.amount, currency(data))}</span>
          </div>
          {cashPayment?.amountReceived !== undefined && (
            <div className="receipt-line">
              <span>Cash received</span>
              <span>{money(cashPayment.amountReceived, currency(data))}</span>
            </div>
          )}
          {cashPayment?.change !== undefined && (
            <div className="receipt-line">
              <span>Change</span>
              <span>{money(cashPayment.change, currency(data))}</span>
            </div>
          )}
          {payment.reference && (
            <div className="receipt-line">
              <span>Reference</span>
              <span className="receipt-reference">{payment.reference}</span>
            </div>
          )}
        </>
      )}
      <div className="receipt-footer">
        Served with care · {order.cashierName}
        {data.settings.receiptFooter && <><br />{data.settings.receiptFooter}</>}
      </div>
    </div>
  );
}

function TablesPage() {
  const { data, setData, draftTableId, toast } = useStore();
  const openDay = activeBusinessDay(data.businessDays);
  const [editing, setEditing] = useState<Table | null | 'new'>(null);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [error, setError] = useState('');
  const open = (entry: Table | null) => { setEditing(entry || 'new'); setName(entry?.name || `Table ${data.tables.length + 1}`); setCapacity(String(entry?.capacity || 4)); setError(''); };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || Number(capacity) < 1) { setError('Enter a table name and capacity of at least one.'); return; }
    if (data.tables.some(table => table.name.trim().toLowerCase() === name.trim().toLowerCase() && table.id !== (typeof editing === 'object' ? editing?.id : undefined))) { setError('That table name is already in use.'); return; }
    const stamp = now();
    setData(current => ({ ...current, tables: typeof editing === 'object' && editing ? current.tables.map(table => table.id === editing.id ? { ...table, name: name.trim(), capacity: Number(capacity), updatedAt: stamp } : table) : [...current.tables, { id: makeId(), name: name.trim(), capacity: Number(capacity), createdAt: stamp, updatedAt: stamp }] }));
    toast(typeof editing === 'object' && editing ? 'Table details saved.' : 'Table added to the floor.');
    setEditing(null);
  };
  const remove = (table: Table) => { if (data.orders.some(order => isOrderOccupyingTable(order, openDay) && order.tableId === table.id)) { toast('This table is assigned to an active ticket. Free the table before removing it.'); return; } if (window.confirm(`Remove ${table.name}?`)) { setData(current => ({ ...current, tables: current.tables.filter(entry => entry.id !== table.id) })); toast('Table removed.'); } };
  return <div className="page"><PageHeader eyebrow="ROOM SETUP" title="Tables." subtitle="Keep the floor plan simple and current." action={<button className="btn btn-primary" onClick={() => open(null)} data-testid="button-add-table"><Plus size={15} /> Add a table</button>} />
    <div className="status-banner" style={{ marginBottom: 16 }}><WifiOff size={15} /> Tables are saved on this browser. Active ticket table is protected from edits and removal.</div>
     {data.tables.length ? <div className="tables-grid">{[...data.tables].map(table => { const activeOrder = data.orders.find(order => isOrderOccupyingTable(order, openDay) && order.tableId === table.id); const draft = table.id === draftTableId; const busy = !!activeOrder; return <div className="panel table-card" key={table.id} data-testid={`card-table-${table.id}`}><div className="table-card-top"><div><div className="eyebrow">FLOOR · {String(data.tables.indexOf(table) + 1).padStart(2, '0')}</div><div className="table-name">{table.name}</div><div className="table-capacity">{table.capacity} seats</div></div><span className={`badge ${busy ? 'badge-orange' : 'badge-green'}`}>{activeOrder ? `Order ${activeOrder.orderNumber}` : draft ? 'Selected · available' : 'Available'}</span></div><div className="table-actions"><button className="btn btn-sm" onClick={() => open(table)} disabled={busy} data-testid={`button-edit-table-${table.id}`}><Pencil size={12} /> Edit</button><button className="btn btn-sm btn-danger" onClick={() => remove(table)} disabled={busy} data-testid={`button-delete-table-${table.id}`}><Trash2 size={12} /> Remove</button></div></div>; })}</div> : <div className="panel"><Empty title="A room waiting to be set" description="Add the first table to begin dine-in service." icon={<Armchair size={20} />} action={<button className="btn btn-primary" onClick={() => open(null)}>Add first table</button>} /></div>}
    {editing && <Dialog title={editing === 'new' ? 'Add a table' : 'Edit table'} onClose={() => setEditing(null)}><form onSubmit={save}><div className="form-grid"><div className="field"><label htmlFor="table-name">Table name</label><input autoFocus id="table-name" className="input" value={name} onChange={event => setName(event.target.value)} data-testid="input-table-name" /></div><div className="field"><label htmlFor="table-capacity">Seats</label><input id="table-capacity" className="input" type="number" min="1" max="30" value={capacity} onChange={event => setCapacity(event.target.value)} data-testid="input-table-capacity" /></div></div>{error && <p className="validation">{error}</p>}<div className="dialog-actions" style={{ paddingRight: 0, paddingBottom: 0 }}><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" type="submit" data-testid="button-save-table">Save table</button></div></form></Dialog>}
  </div>;
}

interface DealDraftItem { menuItemId: string; quantity: string }
interface DealDraft { name: string; description: string; fixedPrice: string; items: DealDraftItem[]; active: boolean }
function DealsPage() {
  const { data, setData, toast } = useStore();
  const [editing, setEditing] = useState<Deal | 'new' | null>(null);
  const [draft, setDraft] = useState<DealDraft>({ name: '', description: '', fixedPrice: '', items: [{ menuItemId: data.menuItems[0]?.id || '', quantity: '1' }], active: true });
  const [error, setError] = useState('');
  const open = (deal?: Deal) => {
    setEditing(deal || 'new');
    setDraft(deal ? {
      name: deal.name,
      description: deal.description || '',
      fixedPrice: String(deal.fixedPrice),
      items: deal.items.map(item => ({ menuItemId: item.menuItemId, quantity: String(item.quantity) })),
      active: deal.active,
    } : { name: '', description: '', fixedPrice: '', items: [{ menuItemId: data.menuItems[0]?.id || '', quantity: '1' }], active: true });
    setError('');
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const fixedPrice = Number(draft.fixedPrice);
    const items = draft.items.map(item => {
      const menuItem = data.menuItems.find(candidate => candidate.id === item.menuItemId);
      return { menuItemId: item.menuItemId, quantity: Number(item.quantity), nameSnapshot: menuItem?.name || 'Removed menu item' };
    });
    if (!draft.name.trim() || !Number.isFinite(fixedPrice) || fixedPrice <= 0 ||
      !items.length || items.some(item => !item.menuItemId || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
      setError('Enter a deal name, positive fixed price, and a valid whole-number quantity for every menu item.');
      return;
    }
    const previous = typeof editing === 'object' ? editing : null;
    const stamp = now();
    const deal: Deal = {
      id: previous?.id || makeId(),
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      fixedPrice,
      items,
      active: draft.active,
      createdAt: previous?.createdAt || stamp,
      updatedAt: stamp,
    };
    setData(current => ({ ...current, deals: previous
      ? current.deals.map(entry => entry.id === previous.id ? deal : entry)
      : [...current.deals, deal] }));
    setEditing(null);
    toast(previous ? 'Deal updated. Existing orders keep their saved deal details.' : 'Deal saved.');
  };
  const remove = (deal: Deal) => {
    if (!window.confirm(`Delete ${deal.name}? Saved orders containing this deal will remain unchanged.`)) return;
    setData(current => ({ ...current, deals: current.deals.filter(entry => entry.id !== deal.id) }));
    toast('Deal deleted. Existing orders are unchanged.');
  };
  const setActive = (deal: Deal, active: boolean) => {
    setData(current => ({ ...current, deals: current.deals.map(entry => entry.id === deal.id ? { ...entry, active, updatedAt: now() } : entry) }));
    toast(active ? `${deal.name} is available in the POS.` : `${deal.name} is hidden from the POS.`);
  };
  const includedSummary = (deal: Deal) => deal.items.map(item => {
    const name = data.menuItems.find(candidate => candidate.id === item.menuItemId)?.name || item.nameSnapshot || 'Removed menu item';
    return `${item.quantity} × ${name}`;
  }).join(' · ');

  return <div className="page">
    <PageHeader eyebrow="MANAGER · MENU OFFERS" title="Deals & combos." subtitle="Set a fixed price for a saved collection of menu items. Orders keep a snapshot if a deal changes later." action={<button className="btn btn-primary" onClick={() => open()} data-testid="button-add-deal"><Plus size={15} /> Create deal</button>} />
    <div className="status-banner" style={{ marginBottom: 16 }}><PackagePlus size={15} /> A deal is charged once at its fixed price. Its included items are listed for the kitchen and are not added as separate paid lines.</div>
    {data.deals.length ? <section className="panel"><div className="table-wrap"><table className="data-table"><thead><tr><th>Deal</th><th>Included items</th><th>Fixed price</th><th>Status</th><th>Actions</th></tr></thead><tbody>{data.deals.map(deal => <tr key={deal.id} data-testid={`row-deal-${deal.id}`}><td><b>{deal.name}</b>{deal.description && <div className="page-subtitle">{deal.description}</div>}</td><td>{includedSummary(deal)}</td><td className="mono">{money(deal.fixedPrice, currency(data))}</td><td><button className={`badge ${deal.active ? 'badge-green' : 'badge-muted'}`} onClick={() => setActive(deal, !deal.active)} data-testid={`toggle-deal-${deal.id}`}>{deal.active ? 'Active' : 'Inactive'}</button></td><td><div className="expense-actions"><button className="btn btn-sm" onClick={() => open(deal)} data-testid={`edit-deal-${deal.id}`}><Pencil size={12} /> Edit</button><button className="btn btn-sm btn-danger" onClick={() => remove(deal)} data-testid={`delete-deal-${deal.id}`}><Trash2 size={12} /> Delete</button></div></td></tr>)}</tbody></table></div></section>
      : <section className="panel"><Empty title="No deals yet" description="Create a fixed-price offer to make it available to cashiers in the POS." icon={<PackagePlus size={20} />} action={<button className="btn btn-primary" onClick={() => open()}>Create first deal</button>} /></section>}
    {editing && <Dialog title={editing === 'new' ? 'Create deal' : `Edit deal · ${editing.name}`} onClose={() => setEditing(null)} wide><form onSubmit={save} data-testid="form-deal">
      <div className="form-grid">
        <div className="field"><label htmlFor="deal-name">Deal name *</label><input id="deal-name" className="input" value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} required data-testid="input-deal-name" /></div>
        <div className="field"><label htmlFor="deal-price">Fixed price (PKR) *</label><input id="deal-price" type="number" min="0.01" step="0.01" className="input" value={draft.fixedPrice} onChange={event => setDraft(current => ({ ...current, fixedPrice: event.target.value }))} required data-testid="input-deal-price" /></div>
        <div className="field span-2"><label htmlFor="deal-description">Description (optional)</label><input id="deal-description" className="input" value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} data-testid="input-deal-description" /></div>
        <div className="field span-2"><label className="check-setting"><input type="checkbox" checked={draft.active} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))} data-testid="input-deal-active" /> Available to cashiers</label></div>
      </div>
      <div className="deal-editor-items"><div className="panel-head"><h3 className="panel-title">Included menu items</h3><button type="button" className="btn btn-sm" onClick={() => setDraft(current => ({ ...current, items: [...current.items, { menuItemId: data.menuItems[0]?.id || '', quantity: '1' }] }))} disabled={!data.menuItems.length} data-testid="button-add-deal-item"><Plus size={13} /> Add item</button></div>
        {draft.items.map((item, index) => <div className="deal-editor-row" key={`${index}-${item.menuItemId}`}><div className="field"><label htmlFor={`deal-item-${index}`}>Menu item</label><select id={`deal-item-${index}`} className="select" value={item.menuItemId} onChange={event => setDraft(current => ({ ...current, items: current.items.map((entry, entryIndex) => entryIndex === index ? { ...entry, menuItemId: event.target.value } : entry) }))} data-testid={`select-deal-item-${index}`}><option value="">Choose item</option>{data.menuItems.map(menuItem => <option value={menuItem.id} key={menuItem.id}>{menuItem.name}</option>)}</select></div><div className="field"><label htmlFor={`deal-qty-${index}`}>Quantity</label><input id={`deal-qty-${index}`} className="input" type="number" min="1" step="1" value={item.quantity} onChange={event => setDraft(current => ({ ...current, items: current.items.map((entry, entryIndex) => entryIndex === index ? { ...entry, quantity: event.target.value } : entry) }))} data-testid={`input-deal-qty-${index}`} /></div><button type="button" className="btn btn-quiet btn-sm" aria-label={`Remove deal item ${index + 1}`} disabled={draft.items.length === 1} onClick={() => setDraft(current => ({ ...current, items: current.items.filter((_, entryIndex) => entryIndex !== index) }))}><Trash2 size={14} /></button></div>)}
      </div>
      {error && <p className="validation" role="alert">{error}</p>}
      <div className="dialog-actions" style={{ paddingRight: 0, paddingBottom: 0 }}><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" type="submit" data-testid="button-save-deal">Save deal</button></div>
    </form></Dialog>}
  </div>;
}

function dayOrders(day: BusinessDay, data: AppData): Order[] {
  return data.orders.filter(order => order.businessDayId === day.id ||
    (!order.businessDayId && businessDateForTimestamp(order.createdAt) === day.businessDate));
}
function dayExpenses(day: BusinessDay, data: AppData): Expense[] {
  return data.expenses.filter(expense => expense.businessDayId === day.id ||
    (!expense.businessDayId && businessDateForTimestamp(expense.dateTime) === day.businessDate));
}
function BusinessDaySummary({ day, data }: { day: BusinessDay; data: AppData }) {
  const orders = dayOrders(day, data);
  const paidOrders = orders.filter(order => order.status === 'paid');
  const payments = data.payments.filter(payment => paidOrders.some(order => order.id === payment.orderId) && payment.status === 'paid');
  const expenses = dayExpenses(day, data);
  const sales = paidOrders.reduce((sum, order) => sum + order.total, 0);
  const cash = payments.filter(payment => payment.method === 'Cash').reduce((sum, payment) => sum + payment.amount, 0);
  return <div className="day-summary-grid">
    <div><span>Orders</span><b>{orders.length}</b><small>{paidOrders.length} completed · {orders.filter(order => order.status === 'cancelled').length} cancelled</small></div>
    <div><span>Sales</span><b>{money(sales, currency(data))}</b><small>{payments.length} saved payments</small></div>
    <div><span>Payment methods</span><b>{money(cash, currency(data))} cash</b><small>{(['Card', 'Easypaisa', 'JazzCash', 'Other'] as PaymentMethod[]).map(method => `${method} ${money(payments.filter(payment => payment.method === method).reduce((sum, payment) => sum + payment.amount, 0), currency(data))}`).join(' · ')}</small></div>
    <div><span>Expenses</span><b>{money(expenses.reduce((sum, expense) => sum + expense.total, 0), currency(data))}</b><small>{expenses.length} saved records</small></div>
  </div>;
}
function BusinessDayPage() {
  const { data, setData, user, recoveryDetected, setRecoveryDetected, toast } = useStore();
  const openDay = activeBusinessDay(data.businessDays);
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState('');
  const begin = () => {
    if (user?.role !== 'Manager') return;
    if (activeBusinessDay(data.businessDays)) { toast('A business day is already open.'); return; }
    if (openingCash.trim() && (!Number.isFinite(Number(openingCash)) || Number(openingCash) < 0)) { setError('Opening cash must be zero or more.'); return; }
    const startedAt = now();
    const day: BusinessDay = { id: makeId(), businessDate: businessDateForTimestamp(startedAt), startAt: startedAt, startedBy: user.name, openingCash: openingCash.trim() ? Number(openingCash) : undefined, status: 'open' };
    setData(current => activeBusinessDay(current.businessDays) ? current : ({ ...current, businessDays: [...current.businessDays, day] }));
    setOpeningCash('');
    setError('');
    setRecoveryDetected(false);
    toast(`Business day ${day.businessDate} started.`);
  };
  const finish = () => {
    if (user?.role !== 'Manager' || !openDay) return;
    if (closingCash.trim() && (!Number.isFinite(Number(closingCash)) || Number(closingCash) < 0)) { setError('Closing cash must be zero or more.'); return; }
    const endedAt = now();
    setData(current => ({ ...current, businessDays: current.businessDays.map(day => day.id === openDay.id ? closeBusinessDay(day, user.name, endedAt, closingCash.trim() ? Number(closingCash) : undefined) : day) }));
    setEnding(false);
    setClosingCash('');
    setError('');
    setRecoveryDetected(false);
    toast(`Business day ${openDay.businessDate} ended. Orders and records were preserved.`);
  };
  return <div className="page">
    <PageHeader eyebrow="MANAGER · SERVICE SESSION" title="Business day." subtitle="A restaurant day runs from the explicit morning start through the overnight close. Orders are assigned to the open local business day." />
    {recoveryDetected && <div className="recovery-card" role="status"><AlertCircle size={18} /><div><b>Previous register session ended unexpectedly.</b><p>{openDay ? `Business day ${openDay.businessDate} is still open. Saved orders and records remain available; an unfinished cart cannot be recovered, and the exact shutdown time is unknown.` : 'No business day is open. Saved orders and records remain available; an unfinished cart cannot be recovered.'}</p></div><button className="btn btn-sm" onClick={() => { setRecoveryDetected(false); toast(openDay ? 'Continuing the saved open business day.' : 'Recovery notice dismissed.'); }} data-testid="button-resume-business-day">{openDay ? 'Resume open day' : 'Acknowledge'}</button></div>}
    {openDay ? <section className="panel business-day-panel">
      <div className="panel-head"><div><div className="eyebrow">CURRENTLY OPEN</div><h2 className="panel-title">Business day · {openDay.businessDate}</h2></div><span className="badge badge-green">Open</span></div>
      <div className="business-day-meta"><span>Started {new Date(openDay.startAt).toLocaleString()} by {openDay.startedBy}</span><span>Opening cash: {openDay.openingCash === undefined ? 'Not recorded' : money(openDay.openingCash, currency(data))}</span><span>Register timezone · {Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'}</span></div>
      <BusinessDaySummary day={openDay} data={data} />
      <div className="business-day-actions"><p className="page-subtitle">Ending the day prevents new orders from using it. Saved records are never deleted.</p><button className="btn btn-danger" onClick={() => { setClosingCash(''); setError(''); setEnding(true); }} data-testid="button-end-day"><Check size={14} /> End Day</button></div>
    </section> : <section className="panel business-day-panel">
      <div className="panel-head"><div><div className="eyebrow">NO OPEN SERVICE DAY</div><h2 className="panel-title">Start the next business day</h2></div><span className="badge badge-muted">Closed</span></div>
      <div className="business-day-meta"><span>Default business date is the local date. Orders from 12:00–2:59 AM are assigned to the prior date.</span><span>Start time is recorded as entered; a late start does not alter saved timestamps.</span></div>
      <div className="business-day-actions"><div className="field opening-cash-field"><label htmlFor="opening-cash">Opening cash (optional)</label><input id="opening-cash" type="number" min="0" step="0.01" className="input" value={openingCash} onChange={event => setOpeningCash(event.target.value)} data-testid="input-opening-cash" /></div><button className="btn btn-primary" onClick={begin} data-testid="button-start-day"><Plus size={14} /> Start Day</button></div>
      {error && <p className="validation" role="alert">{error}</p>}
    </section>}
    <section className="panel business-day-history"><div className="panel-head"><div><div className="eyebrow">SAVED DAY RECORDS</div><h2 className="panel-title">Business-day history</h2></div><span className="badge">{data.businessDays.length} days</span></div>{data.businessDays.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Business date</th><th>Started</th><th>Started by</th><th>Ended</th><th>Ended by</th><th>Closing cash</th><th>Status</th></tr></thead><tbody>{[...data.businessDays].reverse().map(day => <tr key={day.id} data-testid={`row-business-day-${day.id}`}><td>{day.businessDate}</td><td>{new Date(day.startAt).toLocaleString()}</td><td>{day.startedBy}</td><td>{day.endAt ? new Date(day.endAt).toLocaleString() : '—'}</td><td>{day.endedBy || '—'}</td><td>{day.closingCash === undefined ? '—' : money(day.closingCash, currency(data))}</td><td><span className={`badge ${day.status === 'open' ? 'badge-green' : 'badge-muted'}`}>{day.status}</span></td></tr>)}</tbody></table></div> : <Empty title="No business days saved" description="Start Day to open the first service period." icon={<CalendarDays size={20} />} />}</section>
    {ending && openDay && <Dialog title={`End business day · ${openDay.businessDate}`} onClose={() => setEnding(false)} wide><div className="callout">Review this shift summary before closing. Closing is recorded with the current time and your account. New orders require another explicit Start Day.</div><BusinessDaySummary day={openDay} data={data} /><div className="field" style={{ marginTop: 15 }}><label htmlFor="closing-cash">Closing cash (optional)</label><input id="closing-cash" type="number" min="0" step="0.01" className="input" value={closingCash} onChange={event => setClosingCash(event.target.value)} data-testid="input-closing-cash" /></div>{error && <p className="validation" role="alert">{error}</p>}<div className="dialog-actions" style={{ paddingRight: 0, paddingBottom: 0 }}><button className="btn" onClick={() => setEnding(false)}>Keep day open</button><button className="btn btn-danger" onClick={finish} data-testid="button-confirm-end-day">Confirm End Day</button></div></Dialog>}
  </div>;
}

function MenuPage() {
  const { data, setData, toast } = useStore();
  const [selected, setSelected] = useState('all');
  const [editingItem, setEditingItem] = useState<MenuItem | null | 'new'>(null);
  const [editingCategory, setEditingCategory] = useState<Category | null | 'new'>(null);
  const [categoryName, setCategoryName] = useState('');
  const [form, setForm] = useState({ name: '', description: '', price: '', categoryId: '', imageDataUrl: '' });
  const [error, setError] = useState('');
  const openItem = (item: MenuItem | null) => { setEditingItem(item || 'new'); setForm({ name: item?.name || '', description: item?.description || '', price: item ? String(item.price) : '', categoryId: item?.categoryId || data.categories[0]?.id || '', imageDataUrl: item?.imageDataUrl || '' }); setError(''); };
  const saveItem = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.categoryId || Number(form.price) <= 0) { setError('Name, category and a price greater than zero are required.'); return; }
    const stamp = now();
    setData(current => ({ ...current, menuItems: typeof editingItem === 'object' && editingItem ? current.menuItems.map(item => item.id === editingItem.id ? { ...item, name: form.name.trim(), description: form.description.trim(), price: Number(form.price), categoryId: form.categoryId, imageDataUrl: form.imageDataUrl || undefined, updatedAt: stamp } : item) : [...current.menuItems, { id: makeId(), name: form.name.trim(), description: form.description.trim(), price: Number(form.price), categoryId: form.categoryId, available: true, imageDataUrl: form.imageDataUrl || undefined, createdAt: stamp, updatedAt: stamp }] }));
    toast(typeof editingItem === 'object' && editingItem ? 'Menu item updated.' : 'Menu item added.'); setEditingItem(null);
  };
  const toggleAvailability = (item: MenuItem) => { setData(current => ({ ...current, menuItems: current.menuItems.map(entry => entry.id === item.id ? { ...entry, available: !entry.available, updatedAt: now() } : entry) })); toast(item.available ? `${item.name} paused for service.` : `${item.name} is available.`); };
  const removeItem = (item: MenuItem) => { if (window.confirm(`Remove ${item.name} from the menu? Existing paid tickets keep their item snapshots.`)) { setData(current => ({ ...current, menuItems: current.menuItems.filter(entry => entry.id !== item.id) })); toast('Menu item removed.'); } };
  const saveCategory = (event: FormEvent) => { event.preventDefault(); if (!categoryName.trim()) { setError('Category name is required.'); return; } if (data.categories.some(item => item.name.toLowerCase() === categoryName.trim().toLowerCase() && item.id !== (typeof editingCategory === 'object' && editingCategory ? editingCategory.id : ''))) { setError('A category with that name already exists.'); return; } const stamp = now(); setData(current => ({ ...current, categories: typeof editingCategory === 'object' && editingCategory ? current.categories.map(entry => entry.id === editingCategory.id ? { ...entry, name: categoryName.trim(), updatedAt: stamp } : entry) : [...current.categories, { id: makeId(), name: categoryName.trim(), sortOrder: current.categories.length, createdAt: stamp, updatedAt: stamp }] })); setEditingCategory(null); setError(''); toast('Category saved.'); };
  const removeCategory = (category: Category) => { if (data.menuItems.some(item => item.categoryId === category.id)) { toast('Move or remove this category’s menu items first.'); return; } if (window.confirm(`Remove ${category.name}?`)) { setData(current => ({ ...current, categories: current.categories.filter(item => item.id !== category.id) })); if (selected === category.id) setSelected('all'); toast('Category removed.'); } };
  const visible = data.menuItems.filter(item => selected === 'all' || item.categoryId === selected);
  return <div className="page"><PageHeader eyebrow="FOOD & DRINK" title="Menu setup." subtitle="Prices, descriptions and availability for today's service." action={<button className="btn btn-primary" onClick={() => openItem(null)} disabled={!data.categories.length} data-testid="button-add-menu-item"><Plus size={15} /> Add menu item</button>} />
    <div className="category-admin-layout"><section className="panel"><div className="panel-head"><h2 className="panel-title">Categories</h2><button className="btn btn-sm btn-quiet" onClick={() => { setEditingCategory('new'); setCategoryName(''); setError(''); }} aria-label="Add category" data-testid="button-add-category"><Plus size={14} /></button></div><div className="category-list"><button className={`category-row-admin ${selected === 'all' ? 'active' : ''}`} style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', background: selected === 'all' ? 'hsl(var(--secondary))' : 'transparent' }} onClick={() => setSelected('all')} data-testid="category-admin-all"><span>All items</span><span>{data.menuItems.length}</span></button>{[...data.categories].sort((a, b) => a.sortOrder - b.sortOrder).map(category => <div key={category.id} className={`category-row-admin ${selected === category.id ? 'active' : ''}`}><button onClick={() => setSelected(category.id)} style={{ flex: 1, textAlign: 'left', border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }} data-testid={`category-admin-${category.id}`}>{category.name}</button><span className="mono">{data.menuItems.filter(item => item.categoryId === category.id).length}</span><button className="btn btn-quiet btn-sm" title="Edit category" onClick={() => { setEditingCategory(category); setCategoryName(category.name); setError(''); }} data-testid={`button-edit-category-${category.id}`}><Pencil size={12} /></button><button className="btn btn-quiet btn-sm" title="Remove category" onClick={() => removeCategory(category)} data-testid={`button-delete-category-${category.id}`}><Trash2 size={12} /></button></div>)}</div></section>
      <section className="panel"><div className="panel-head"><div><div className="eyebrow">SERVICE MENU</div><h2 className="panel-title">{selected === 'all' ? 'All dishes & drinks' : data.categories.find(item => item.id === selected)?.name}</h2></div><span className="badge">{visible.length} items</span></div>{visible.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Availability</th><th>Actions</th></tr></thead><tbody>{visible.map(item => <tr key={item.id} data-testid={`row-menu-item-${item.id}`}><td><div className="menu-admin-item">{item.imageDataUrl ? <img src={item.imageDataUrl} alt="" className="mini-image" /> : <div className="mini-image">{item.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</div>}<div><b>{item.name}</b><div style={{ color: 'hsl(var(--muted-foreground))', fontSize: 10, marginTop: 3 }}>{item.description || 'No description'}</div></div></div></td><td>{data.categories.find(category => category.id === item.categoryId)?.name || 'Uncategorised'}</td><td className="mono">{money(item.price, currency(data))}</td><td><button className={`badge ${item.available ? 'badge-green' : 'badge-muted'}`} onClick={() => toggleAvailability(item)} data-testid={`button-availability-${item.id}`}>{item.available ? 'Available' : 'Paused'}</button></td><td><div style={{ display: 'flex', gap: 4 }}><button className="btn btn-sm" onClick={() => openItem(item)} aria-label={`Edit ${item.name}`} data-testid={`button-edit-menu-${item.id}`}><Pencil size={12} /></button><button className="btn btn-sm btn-danger" onClick={() => removeItem(item)} aria-label={`Delete ${item.name}`} data-testid={`button-delete-menu-${item.id}`}><Trash2 size={12} /></button></div></td></tr>)}</tbody></table></div> : <Empty title="A category, ready for its first dish" description="Add a menu item here, or choose a different category." icon={<UtensilsCrossed size={20} />} action={<button className="btn btn-primary" onClick={() => openItem(null)} disabled={!data.categories.length}>Add menu item</button>} />}</section></div>
    {editingItem && <Dialog title={editingItem === 'new' ? 'Add menu item' : 'Edit menu item'} onClose={() => setEditingItem(null)}><form onSubmit={saveItem}><div className="form-grid"><div className="field span-2"><label htmlFor="item-name">Item name *</label><input id="item-name" autoFocus className="input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} data-testid="input-item-name" /></div><div className="field span-2"><label htmlFor="item-description">Description</label><textarea id="item-description" className="textarea" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} data-testid="input-item-description" /></div><div className="field"><label htmlFor="item-price">Price ({currency(data)}) *</label><input id="item-price" type="number" min="1" className="input" value={form.price} onChange={event => setForm({ ...form, price: event.target.value })} data-testid="input-item-price" /></div><div className="field"><label htmlFor="item-category">Category *</label><select id="item-category" className="select" value={form.categoryId} onChange={event => setForm({ ...form, categoryId: event.target.value })} data-testid="select-item-category">{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div><div className="field span-2"><label htmlFor="item-image">Optional local image</label><input id="item-image" type="file" accept="image/*" className="input" onChange={event => { const file = event.target.files?.[0]; if (file) { if (file.size > 1_000_000) { setError('Choose an image smaller than 1 MB.'); return; } const reader = new FileReader(); reader.onload = () => setForm(current => ({ ...current, imageDataUrl: String(reader.result) })); reader.readAsDataURL(file); } }} data-testid="input-item-image" />{form.imageDataUrl && <button className="btn btn-sm" type="button" onClick={() => setForm({ ...form, imageDataUrl: '' })}>Remove image</button>}</div></div>{error && <p className="validation">{error}</p>}<div className="dialog-actions" style={{ paddingRight: 0, paddingBottom: 0 }}><button className="btn" type="button" onClick={() => setEditingItem(null)}>Cancel</button><button className="btn btn-primary" type="submit" data-testid="button-save-menu-item">Save item</button></div></form></Dialog>}
    {editingCategory && <Dialog title={editingCategory === 'new' ? 'Add category' : 'Edit category'} onClose={() => setEditingCategory(null)}><form onSubmit={saveCategory}><div className="field"><label htmlFor="category-name">Category name</label><input id="category-name" autoFocus className="input" value={categoryName} onChange={event => setCategoryName(event.target.value)} data-testid="input-category-name" /></div>{error && <p className="validation">{error}</p>}<div className="dialog-actions" style={{ paddingRight: 0, paddingBottom: 0 }}><button className="btn" type="button" onClick={() => setEditingCategory(null)}>Cancel</button><button className="btn btn-primary" type="submit" data-testid="button-save-category">Save category</button></div></form></Dialog>}
  </div>;
}

function OrdersPage() {
  const { data, setData, toast, user } = useStore();
  const openDay = activeBusinessDay(data.businessDays);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [method, setMethod] = useState('all');
  const [date, setDate] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<Order | null>(null);
  const cutoff = (value: string) => { const base = new Date(); base.setHours(0, 0, 0, 0); if (value === 'today') return base.getTime(); if (value === '7days') { base.setDate(base.getDate() - 6); return base.getTime(); } return 0; };
  const rows = [...data.orders].filter(order => {
    const target = `${order.orderNumber} ${order.customerName || ''} ${order.customerPhone || ''} ${orderContextLabel(order)}`.toLowerCase();
    const payment = data.payments.find(entry => entry.orderId === order.id);
    return (!query || target.includes(query.toLowerCase())) && (type === 'all' || order.type === type) && (method === 'all' || payment?.method === method) && (status === 'all' || order.status === status) && new Date(order.createdAt).getTime() >= cutoff(date);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const cancel = (order: Order) => {
    if (order.status === 'cancelled') return;
    if (!window.confirm(`Cancel ${order.orderNumber}? This keeps its receipt and payment history, but marks it cancelled.`)) return;
    setData(current => ({ ...current, orders: current.orders.map(item => item.id === order.id ? { ...item, status: 'cancelled', updatedAt: now() } : item), payments: current.payments.map(payment => payment.orderId === order.id ? { ...payment, status: 'cancelled' } : payment) }));
    setSelected({ ...order, status: 'cancelled', updatedAt: now() });
    toast(`${order.orderNumber} marked cancelled.`);
  };
  const releaseTable = (order: Order) => {
    if (!isOrderOccupyingTable(order, openDay)) return;
    const releasedAt = now();
    setData(current => ({ ...current, orders: current.orders.map(entry => entry.id === order.id ? { ...entry, tableReleasedAt: releasedAt, updatedAt: releasedAt } : entry) }));
    setSelected({ ...order, tableReleasedAt: releasedAt, updatedAt: releasedAt });
    toast(`${order.tableNameSnapshot || 'Table'} is available again.`);
  };
  return <div className="page"><PageHeader eyebrow="LOCAL ORDER BOOK" title="Order history." subtitle="Find a ticket, review what was served, or print another browser receipt." />
    <div className="toolbar"><div className="search-wrap" style={{ flex: 1 }}><Search /><input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Ticket number, customer, phone or table" aria-label="Search orders" data-testid="input-orders-search" /></div><select className="select filter-select" value={type} onChange={event => setType(event.target.value)} aria-label="Filter order type" data-testid="filter-order-type"><option value="all">All types</option><option>Dine-in</option><option>Takeaway</option><option>Delivery</option></select><select className="select filter-select" value={method} onChange={event => setMethod(event.target.value)} aria-label="Filter payment method"><option value="all">All payment methods</option>{(['Cash','Card','Easypaisa','JazzCash','Other'] as PaymentMethod[]).map(value => <option key={value}>{value}</option>)}</select><select className="select filter-select" value={date} onChange={event => setDate(event.target.value)} aria-label="Filter date" data-testid="filter-order-date"><option value="all">Any date</option><option value="today">Today</option><option value="7days">Last 7 days</option></select><select className="select filter-select" value={status} onChange={event => setStatus(event.target.value)} aria-label="Filter order status" data-testid="filter-order-status"><option value="all">Any status</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></select></div>
    <section className="panel"><div className="panel-head"><div><div className="eyebrow">TICKETS SAVED HERE</div><h2 className="panel-title">Order book</h2></div><span className="badge">{rows.length} {rows.length === 1 ? 'ticket' : 'tickets'}</span></div>{rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Ticket</th><th>Date & time</th><th>Type</th><th>Customer / table</th><th>Payment</th><th>Total</th><th>Status</th><th /></tr></thead><tbody>{rows.map(order => <tr key={order.id} data-testid={`row-order-${order.id}`}><td><button className="btn btn-quiet btn-sm mono" onClick={() => setSelected(order)} data-testid={`button-view-order-${order.id}`}>{order.orderNumber}</button></td><td>{new Date(order.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>{order.type}</td><td>{orderContextLabel(order)}</td><td>{order.payment?.method || '—'}</td><td className="mono">{money(order.total, currency(data))}</td><td><span className={`badge ${order.status === 'paid' ? 'badge-green' : 'badge-orange'}`}>{order.status}</span></td><td><button className="btn btn-sm" onClick={() => setSelected(order)} data-testid={`button-details-${order.id}`}>Details</button></td></tr>)}</tbody></table></div> : <Empty title={query || type !== 'all' || date !== 'all' || status !== 'all' ? 'No tickets match these filters' : 'Your order book is empty'} description={query || type !== 'all' || date !== 'all' || status !== 'all' ? 'Clear a filter or try another search.' : 'Paid orders will appear here after checkout.'} icon={<ClipboardList size={20} />} action={query || type !== 'all' || date !== 'all' || status !== 'all' ? <button className="btn btn-sm" onClick={() => { setQuery(''); setType('all'); setDate('all'); setStatus('all'); }}>Clear filters</button> : undefined} />}</section>
    <p className="page-subtitle" style={{ marginTop: 13, display: 'flex', gap: 7, alignItems: 'center' }}><Printer size={13} /> Print uses the browser's print dialog only.</p>
     {selected && <Dialog title={`Ticket ${selected.orderNumber}`} onClose={() => setSelected(null)} wide><div className="order-detail-grid"><section><div className="detail-kicker">ORDER DETAILS</div><p><b>Order status</b><br /><span className={`badge ${selected.status === 'paid' ? 'badge-green' : 'badge-orange'}`}>{selected.status}</span></p><p><b>Order type</b><br />{selected.type}</p><p><b>Customer / table</b><br />{orderContextLabel(selected)}{selected.customerPhone ? ` · ${selected.customerPhone}` : ''}</p>{selected.deliveryAddress && <p><b>Delivery address</b><br />{selected.deliveryAddress}</p>}<p><b>Cashier</b><br />{selected.cashierName}</p><p><b>Payment</b><br />{data.payments.find(payment => payment.orderId === selected.id)?.method || selected.payment?.method || '—'} · {data.payments.find(payment => payment.orderId === selected.id)?.status || selected.status}</p><p><b>Business day</b><br />{selected.businessDayId ? data.businessDays.find(day => day.id === selected.businessDayId)?.businessDate || 'Saved day record unavailable' : businessDateForTimestamp(selected.createdAt)}</p></section><section><div className="detail-kicker">SAVED ITEM SNAPSHOTS</div><div className="table-wrap"><table className="data-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Line total</th></tr></thead><tbody>{selected.items.map((item,index) => <tr key={`${item.menuItemId}-${index}`}><td>{item.name}{item.note && <small className="item-note-detail"> · {item.note}</small>}</td><td>{item.quantity}</td><td>{money(item.unitPrice,currency(data))}</td><td>{money(item.lineTotal,currency(data))}</td></tr>)}{(selected.deals || []).map((deal,index) => <tr key={`${deal.dealId}-${index}`}><td><b>{deal.name}</b><small className="item-note-detail">Includes {deal.items.map(item => `${item.quantity * deal.quantity} × ${item.name}`).join(', ')}</small></td><td>{deal.quantity} deals</td><td>{money(deal.unitPrice,currency(data))}</td><td>{money(deal.lineTotal,currency(data))}</td></tr>)}</tbody></table></div><div className="detail-totals"><span>Subtotal <b>{money(selected.subtotal,currency(data))}</b></span><span>Discount <b>− {money(selected.discount,currency(data))}</b></span><span>Delivery <b>{money(selected.deliveryCharge,currency(data))}</b></span><strong>Total <b>{money(selected.total,currency(data))}</b></strong></div></section></div><div className="receipt-detail"><Receipt order={selected} data={data} /></div><div className="dialog-actions" style={{ paddingBottom: 0 }}><button className="btn" onClick={() => printReceipt()} data-testid="button-reprint-order"><Printer size={14} /> Print / reprint</button><button className="btn" onClick={() => printKitchenToken(selected, data.settings)} data-testid="button-print-kitchen-token"><Printer size={14} /> Print Kitchen Token</button>{isOrderOccupyingTable(selected, openDay) && <button className="btn" onClick={() => releaseTable(selected)} data-testid="button-release-table"><Armchair size={14} /> Free table</button>}{selected.status === 'paid' && <button className="btn btn-danger" onClick={() => cancel(selected)} data-testid="button-cancel-order"><X size={14} /> Cancel order</button>}<button className="btn btn-primary" onClick={() => setSelected(null)}>Done</button></div></Dialog>}
  </div>;
}

function Stat({ label, value, foot, icon }: { label: string; value: string; foot: string; icon: ReactNode }) { return <div className="panel stat-card"><span className="stat-label">{label}</span><div className="stat-value" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}>{value}</div><div className="stat-foot">{foot}</div><div className="stat-icon">{icon}</div></div>; }
function OrdersTable({ rows, data, onSelect }: { rows: Order[]; data: AppData; onSelect?: (order: Order) => void }) {
  if (!rows.length) return <Empty title="No orders yet" description="Completed tickets will settle here, ready to review or reprint." icon={<ReceiptText size={20} />} />;
  return <div className="table-wrap"><table className="data-table"><thead><tr><th>Ticket</th><th>Time</th><th>Type</th><th>Customer / table</th><th>Total</th><th>Status</th></tr></thead><tbody>{rows.map(order => <tr key={order.id} onClick={() => onSelect?.(order)} style={{ cursor: onSelect ? 'pointer' : undefined }} data-testid={`row-order-${order.id}`}><td className="mono">{order.orderNumber}</td><td>{new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>{order.type}</td><td>{orderContextLabel(order)}</td><td className="mono">{money(order.total, currency(data))}</td><td><span className={`badge ${order.status === 'paid' ? 'badge-green' : 'badge-orange'}`}>{order.status}</span></td></tr>)}</tbody></table></div>;
}
function Empty({ title, description, icon, action }: { title: string; description: string; icon: ReactNode; action?: ReactNode }) { return <div className="empty-state"><div className="empty-mark">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>; }
function NotFoundPage() { return <div className="page"><PageHeader eyebrow="NOT FOUND" title="This page isn't on the menu." subtitle="Choose a section from the left to get back to work." /><Link className="btn btn-primary" href="/dashboard">Back to overview</Link></div>; }

function PaymentsPage() {
  const { data } = useStore();
  const [period, setPeriod] = useState('all');
  const [method, setMethod] = useState('all');
  const [type, setType] = useState('all');
  const [query, setQuery] = useState('');
  const methods: PaymentMethod[] = ['Cash', 'Card', 'Easypaisa', 'JazzCash', 'Other'];
  const { startDate, endDate } = businessDatePeriodRange(period, data);
  const rows = data.payments
    .flatMap(payment => {
      const order = data.orders.find(entry => entry.id === payment.orderId);
      return order ? [{ payment, order }] : [];
    })
    .filter(({ payment, order }) =>
      businessDateForRecord(order.createdAt, order.businessDayId, data) >= startDate &&
      businessDateForRecord(order.createdAt, order.businessDayId, data) <= endDate &&
      (method === 'all' || payment.method === method) &&
      (type === 'all' || order.type === type) &&
      (!query || `${payment.id} ${payment.orderId} ${order.orderNumber} ${order.customerName || ''} ${order.tableNameSnapshot || ''} ${payment.reference || ''}`.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) => b.payment.dateTime.localeCompare(a.payment.dateTime));
  const collected = rows.filter(({ payment, order }) => payment.status === 'paid' && order.status === 'paid');
  const total = collected.reduce((sum, row) => sum + row.payment.amount, 0);
  const totalFor = (paymentMethod: PaymentMethod) =>
    collected.filter(row => row.payment.method === paymentMethod).reduce((sum, row) => sum + row.payment.amount, 0);

  return (
    <div className="page">
      <PageHeader eyebrow="LOCAL PAYMENT LEDGER" title="Payments." subtitle="Durable payment records, independent of the receipt preview." />
      <div className="stat-grid payment-stat-grid" data-testid="payment-total-cards">
        <Stat label="Total sales" value={money(total, currency(data))} foot={`${collected.length} completed payments`} icon={<CircleDollarSign />} />
        {methods.map(paymentMethod => (
          <Stat key={paymentMethod} label={`${paymentMethod} total`} value={money(totalFor(paymentMethod), currency(data))} foot="Completed payments in selected filters" icon={<Banknote />} />
        ))}
      </div>
      <div className="toolbar">
        <div className="search-wrap" style={{ flex: 1 }}>
          <Search />
          <input className="input" value={query} onChange={event => setQuery(event.target.value)} placeholder="Payment ID, order, customer or reference" aria-label="Search payments" data-testid="search-payments" />
        </div>
        <select className="select filter-select" value={period} onChange={event => setPeriod(event.target.value)} aria-label="Filter payment date" data-testid="filter-payment-date">
          <option value="all">All dates</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">This month</option>
        </select>
        <select className="select filter-select" value={method} onChange={event => setMethod(event.target.value)} aria-label="Filter payment method" data-testid="filter-payment-method">
          <option value="all">All methods</option>{methods.map(value => <option key={value}>{value}</option>)}
        </select>
        <select className="select filter-select" value={type} onChange={event => setType(event.target.value)} aria-label="Filter order type" data-testid="filter-payment-order-type">
          <option value="all">All order types</option><option>Dine-in</option><option>Takeaway</option><option>Delivery</option>
        </select>
      </div>
      <section className="panel">
        <div className="panel-head">
          <div><div className="eyebrow">SAVED PAYMENT RECORDS</div><h2 className="panel-title">Ledger</h2></div>
          <span className="badge">{rows.length} records</span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Payment ID</th><th>Order ID / number</th><th>Date & time</th><th>Business day</th><th>Type</th><th>Customer / table</th><th>Method</th><th>Amount</th><th>Cash received</th><th>Change</th><th>Reference</th><th>Payment status</th><th>Order status</th></tr></thead>
              <tbody>{rows.map(({ payment, order }) => (
                <tr key={payment.id} data-testid={`row-payment-${payment.id}`}>
                  <td className="mono">{payment.id}</td>
                  <td><div className="mono">{order.id}</div><small>{order.orderNumber}</small></td>
                  <td>{new Date(payment.dateTime).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{businessDateForRecord(order.createdAt, order.businessDayId, data)}</td>
                  <td>{order.type}</td>
                  <td>{orderContextLabel(order)}</td>
                  <td>{payment.method}</td>
                  <td className="mono">{money(payment.amount, currency(data))}</td>
                  <td className="mono">{payment.amountReceived === undefined ? '—' : money(payment.amountReceived, currency(data))}</td>
                  <td className="mono">{payment.change === undefined ? '—' : money(payment.change, currency(data))}</td>
                  <td>{payment.reference || '—'}</td>
                  <td><span className={`badge ${payment.status === 'paid' ? 'badge-green' : 'badge-orange'}`}>{payment.status}</span></td>
                  <td><span className={`badge ${order.status === 'paid' ? 'badge-green' : 'badge-orange'}`}>{order.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty title="No payment records found" description="Paid orders create one independent payment record at checkout." icon={<Banknote size={20} />} />}
      </section>
    </div>
  );
}

const expenseCategories = ['Grocery', 'Raw Material', 'Gas', 'Electricity', 'Water', 'Rent', 'Salary', 'Delivery', 'Maintenance', 'Cleaning', 'Packaging', 'Other'];
const expenseMethods: PaymentMethod[] = ['Cash', 'Card', 'Easypaisa', 'JazzCash', 'Other'];
type ExpenseDraft = { dateTime: string; purpose: string; category: string; quantity: string; unitPrice: string; directTotal: boolean; total: string; paymentMethod: PaymentMethod; supplier: string; notes: string };
const toLocalDateTimeField = (value = now()) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const emptyExpenseDraft = (): ExpenseDraft => ({ dateTime: toLocalDateTimeField(), purpose: '', category: 'Grocery', quantity: '1', unitPrice: '', directTotal: false, total: '', paymentMethod: 'Cash', supplier: '', notes: '' });

function ExpensesPage() {
  const { data, setData, user, toast } = useStore();
  const [period, setPeriod] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [category, setCategory] = useState('all');
  const [method, setMethod] = useState('all');
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [viewing, setViewing] = useState<Expense | null>(null);
  const [draft, setDraft] = useState<ExpenseDraft>(emptyExpenseDraft);
  const [formError, setFormError] = useState('');

  const defaultRange = businessDatePeriodRange(period, data);
  const startDate = period === 'custom' ? fromDate || '0000-01-01' : defaultRange.startDate;
  const endDate = period === 'custom' ? toDate || '9999-12-31' : defaultRange.endDate;
  const invalidRange = period === 'custom' && !!fromDate && !!toDate && startDate > endDate;
  const rows = [...data.expenses].filter(expense => {
    const businessDate = businessDateForRecord(expense.dateTime, expense.businessDayId, data);
    return !invalidRange && businessDate >= startDate && businessDate <= endDate &&
      (category === 'all' || expense.category === category) &&
      (method === 'all' || expense.paymentMethod === method);
  }).sort((a, b) => b.dateTime.localeCompare(a.dateTime));
  const total = rows.reduce((sum, expense) => sum + expense.total, 0);

  const openEditor = (expense?: Expense) => {
    setEditing(expense || 'new');
    setViewing(null);
    setDraft(expense ? {
      dateTime: toLocalDateTimeField(expense.dateTime),
      purpose: expense.purpose,
      category: expense.category,
      quantity: String(expense.quantity),
      unitPrice: String(expense.unitPrice),
      directTotal: expense.directTotal ?? false,
      total: String(expense.total),
      paymentMethod: expense.paymentMethod,
      supplier: expense.supplier || '',
      notes: expense.notes || '',
    } : emptyExpenseDraft());
    setFormError('');
  };
  const saveExpense = (event: FormEvent) => {
    event.preventDefault();
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitPrice);
    const directTotal = Number(draft.total);
    const date = new Date(draft.dateTime);
    const total = draft.directTotal ? directTotal : quantity * unitPrice;
    if (!draft.purpose.trim() || !draft.category || !draft.paymentMethod || (!draft.directTotal && (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0)) || !Number.isFinite(total) || total <= 0 || Number.isNaN(date.getTime())) {
      setFormError(draft.directTotal ? 'Enter a purpose, valid date and positive total amount.' : 'Enter a purpose, valid date, positive quantity and unit price.');
      return;
    }
    const existing = typeof editing === 'object' ? editing : null;
    const stamp = now();
    const expenseBusinessDate = businessDateForTimestamp(date);
    const activeDay = activeBusinessDay(data.businessDays);
    const expenseBusinessDay = activeDay?.businessDate === expenseBusinessDate
      ? activeDay
      : data.businessDays.find(day => day.businessDate === expenseBusinessDate);
    const expense: Expense = {
      id: existing?.id || `EXP-${makeId().toUpperCase()}`,
      dateTime: date.toISOString(),
      businessDayId: expenseBusinessDay?.id,
      purpose: draft.purpose.trim(),
      category: draft.category,
      quantity: draft.directTotal ? 1 : quantity,
      unitPrice: draft.directTotal ? total : unitPrice,
      total,
      directTotal: draft.directTotal,
      paymentMethod: draft.paymentMethod,
      supplier: draft.supplier.trim() || undefined,
      notes: draft.notes.trim() || undefined,
      addedBy: existing?.addedBy || user?.name || 'Manager',
      createdAt: existing?.createdAt || stamp,
      updatedAt: stamp,
    };
    setData(current => ({
      ...current,
      expenses: existing
        ? current.expenses.map(entry => entry.id === existing.id ? expense : entry)
        : [...current.expenses, expense],
    }));
    setEditing(null);
    toast(existing ? 'Expense updated.' : 'Expense saved on this device.');
  };
  const deleteExpense = (expense: Expense) => {
    if (!window.confirm(`Delete expense ${expense.id} (${expense.purpose})?`)) return;
    setData(current => ({ ...current, expenses: current.expenses.filter(entry => entry.id !== expense.id) }));
    if (viewing?.id === expense.id) setViewing(null);
    toast('Expense deleted.');
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="LOCAL EXPENSE BOOK"
        title="Expenses."
        subtitle="Record restaurant spending on this device. Expense totals use saved records."
        action={<button className="btn btn-primary" onClick={() => openEditor()} data-testid="button-add-expense"><Plus size={15} /> Add expense</button>}
      />
      <div className="stat-grid expense-stat-grid">
        <Stat label="Total expenses" value={money(total, currency(data))} foot={`${rows.length} matching ${rows.length === 1 ? 'expense' : 'expenses'}`} icon={<CircleDollarSign />} />
        <Stat label="Expense records" value={String(rows.length)} foot="Current filters" icon={<ReceiptText />} />
      </div>
      <div className="toolbar expense-filters">
        <select className="select filter-select" value={period} onChange={event => setPeriod(event.target.value)} aria-label="Filter expense date" data-testid="filter-expense-period">
          <option value="all">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option>
        </select>
        {period === 'custom' && (
          <>
            <input className="input filter-select" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} aria-label="Expense start date" data-testid="filter-expense-from" />
            <input className="input filter-select" type="date" value={toDate} onChange={event => setToDate(event.target.value)} aria-label="Expense end date" data-testid="filter-expense-to" />
          </>
        )}
        <select className="select filter-select" value={category} onChange={event => setCategory(event.target.value)} aria-label="Filter expense category" data-testid="filter-expense-category">
          <option value="all">All categories</option>{expenseCategories.map(value => <option key={value}>{value}</option>)}
        </select>
        <select className="select filter-select" value={method} onChange={event => setMethod(event.target.value)} aria-label="Filter expense payment method" data-testid="filter-expense-method">
          <option value="all">All payment methods</option>{expenseMethods.map(value => <option key={value}>{value}</option>)}
        </select>
      </div>
      {invalidRange && <p className="validation" role="alert">The end date must be on or after the start date.</p>}
      <section className="panel">
        <div className="panel-head">
          <div><div className="eyebrow">SAVED EXPENSE RECORDS</div><h2 className="panel-title">Expense book</h2></div>
          <span className="badge">{rows.length} records</span>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Expense ID</th><th>Date</th><th>Business day</th><th>Item / purpose</th><th>Category</th><th>Amount</th><th>Payment</th><th>Added by</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(expense => (
                <tr key={expense.id} data-testid={`row-expense-${expense.id}`}>
                  <td className="mono">{expense.id}</td>
                  <td>{new Date(expense.dateTime).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{businessDateForRecord(expense.dateTime, expense.businessDayId, data)}</td>
                  <td>{expense.purpose}</td>
                  <td>{expense.category}</td>
                  <td className="mono">{money(expense.total, currency(data))}</td>
                  <td>{expense.paymentMethod}</td>
                  <td>{expense.addedBy}</td>
                  <td><div className="expense-actions">
                    <button className="btn btn-sm" onClick={() => setViewing(expense)} aria-label={`View ${expense.purpose}`} data-testid={`button-view-expense-${expense.id}`}><Eye size={13} /> View</button>
                    <button className="btn btn-sm" onClick={() => openEditor(expense)} aria-label={`Edit ${expense.purpose}`} data-testid={`button-edit-expense-${expense.id}`}><Pencil size={13} /> Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteExpense(expense)} aria-label={`Delete ${expense.purpose}`} data-testid={`button-delete-expense-${expense.id}`}><Trash2 size={13} /> Delete</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty title="No expenses in this view" description="Add an expense or adjust the date, category, and payment filters." icon={<ReceiptText size={20} />} />}
      </section>
      {editing && (
        <Dialog title={editing === 'new' ? 'Add expense' : `Edit expense · ${editing.id}`} onClose={() => setEditing(null)} wide>
          <form onSubmit={saveExpense} data-testid="form-expense">
            <div className="form-grid">
              <div className="field span-2"><label htmlFor="expense-purpose">Item / purpose *</label><input id="expense-purpose" className="input" value={draft.purpose} onChange={event => setDraft(current => ({ ...current, purpose: event.target.value }))} required data-testid="input-expense-purpose" /></div>
              <div className="field"><label htmlFor="expense-category">Category *</label><select id="expense-category" className="select" value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} data-testid="select-expense-category">{expenseCategories.map(value => <option key={value}>{value}</option>)}</select></div>
              <div className="field"><label htmlFor="expense-datetime">Date and time *</label><input id="expense-datetime" className="input" type="datetime-local" value={draft.dateTime} onChange={event => setDraft(current => ({ ...current, dateTime: event.target.value }))} required data-testid="input-expense-datetime" /></div>
              <div className="field span-2"><label className="check-setting"><input type="checkbox" checked={draft.directTotal} onChange={event => setDraft(current => ({ ...current, directTotal: event.target.checked, total: event.target.checked && !current.total ? String((Number(current.quantity) || 0) * (Number(current.unitPrice) || 0)) : current.total }))} data-testid="input-expense-direct-total" /> Enter a direct total when quantity and unit price do not apply</label></div>
              {draft.directTotal ? (
                <div className="field"><label htmlFor="expense-total">Total amount *</label><input id="expense-total" className="input" type="number" min="0.01" step="0.01" value={draft.total} onChange={event => setDraft(current => ({ ...current, total: event.target.value }))} required data-testid="input-expense-total" /></div>
              ) : (
                <>
                  <div className="field"><label htmlFor="expense-quantity">Quantity *</label><input id="expense-quantity" className="input" type="number" min="0.01" step="any" value={draft.quantity} onChange={event => setDraft(current => ({ ...current, quantity: event.target.value }))} required data-testid="input-expense-quantity" /></div>
                  <div className="field"><label htmlFor="expense-unit-price">Unit price *</label><input id="expense-unit-price" className="input" type="number" min="0.01" step="any" value={draft.unitPrice} onChange={event => setDraft(current => ({ ...current, unitPrice: event.target.value }))} required data-testid="input-expense-unit-price" /></div>
                  <div className="field"><label htmlFor="expense-total">Total amount</label><div id="expense-total" className="input expense-total" data-testid="text-expense-total">{money((Number(draft.quantity) || 0) * (Number(draft.unitPrice) || 0), currency(data))}</div></div>
                </>
              )}
              <div className="field"><label htmlFor="expense-method">Payment method *</label><select id="expense-method" className="select" value={draft.paymentMethod} onChange={event => setDraft(current => ({ ...current, paymentMethod: event.target.value as PaymentMethod }))} data-testid="select-expense-method">{expenseMethods.map(value => <option key={value}>{value}</option>)}</select></div>
              <div className="field"><label htmlFor="expense-supplier">Supplier / person</label><input id="expense-supplier" className="input" value={draft.supplier} onChange={event => setDraft(current => ({ ...current, supplier: event.target.value }))} data-testid="input-expense-supplier" /></div>
              <div className="field span-2"><label htmlFor="expense-notes">Notes</label><textarea id="expense-notes" className="textarea" value={draft.notes} onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))} data-testid="input-expense-notes" /></div>
            </div>
            {formError && <p className="validation" role="alert">{formError}</p>}
            <div className="dialog-actions expense-form-actions"><span className="page-subtitle">{editing === 'new' ? `Expense ID will be generated · Added by ${user?.name || 'Manager'}` : `Original ID ${editing.id} is retained`}</span><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" type="submit" data-testid="button-save-expense">Save expense</button></div>
          </form>
        </Dialog>
      )}
      {viewing && (
        <Dialog title={`Expense · ${viewing.id}`} onClose={() => setViewing(null)}>
          <div className="expense-detail" data-testid={`detail-expense-${viewing.id}`}>
            <div><span>Item / purpose</span><b>{viewing.purpose}</b></div>
            <div><span>Date and time</span><b>{new Date(viewing.dateTime).toLocaleString()}</b></div>
            <div><span>Category</span><b>{viewing.category}</b></div>
            <div><span>{viewing.directTotal ? 'Amount entry' : 'Quantity × unit price'}</span><b>{viewing.directTotal ? 'Direct total' : `${viewing.quantity} × ${money(viewing.unitPrice, currency(data))}`}</b></div>
            <div><span>Total amount</span><b>{money(viewing.total, currency(data))}</b></div>
            <div><span>Payment</span><b>{viewing.paymentMethod}</b></div>
            <div><span>Supplier / person</span><b>{viewing.supplier || '—'}</b></div>
            <div><span>Added by</span><b>{viewing.addedBy}</b></div>
            {viewing.notes && <div><span>Notes</span><b>{viewing.notes}</b></div>}
          </div>
          <div className="dialog-actions"><button className="btn" onClick={() => setViewing(null)}>Done</button><button className="btn btn-primary" onClick={() => openEditor(viewing)} data-testid={`button-edit-viewed-expense-${viewing.id}`}><Pencil size={13} /> Edit expense</button></div>
        </Dialog>
      )}
    </div>
  );
}

function businessDatePeriodRange(period: string, data: Pick<AppData, 'businessDays'>) {
  const today = activeBusinessDay(data.businessDays)?.businessDate || businessDateForTimestamp(new Date());
  const date = new Date(`${today}T12:00:00`);
  if (period === 'today') return { startDate: today, endDate: today };
  if (period === 'week') {
    date.setDate(date.getDate() - 6);
    return { startDate: localDateKey(date), endDate: today };
  }
  if (period === 'month') {
    return { startDate: localDateKey(new Date(date.getFullYear(), date.getMonth(), 1)), endDate: today };
  }
  return { startDate: '0000-01-01', endDate: '9999-12-31' };
}

function ReportsPage() {
  const { data, toast } = useStore();
  const todayKey = activeBusinessDay(data.businessDays)?.businessDate || businessDateForTimestamp(new Date());
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [customStart, setCustomStart] = useState(todayKey);
  const [customEnd, setCustomEnd] = useState(todayKey);
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all');
  const [type, setType] = useState<OrderType | 'all'>('all');
  const [periodError, setPeriodError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [applied, setApplied] = useState(() => ({
    period: 'today' as ReportPeriod,
    anchorDate: todayKey,
    startDate: todayKey,
    endDate: todayKey,
    paymentMethod: 'all' as PaymentMethod | 'all',
    orderType: 'all' as OrderType | 'all',
  }));

  const range = useMemo(
    () => resolveReportDateRange(
      applied.period,
      new Date(`${applied.anchorDate}T12:00:00`),
      applied.startDate,
      applied.endDate,
    ),
    [applied],
  );
  const report = useMemo(
    () => calculateReport(data, range, {
      paymentMethod: applied.paymentMethod,
      orderType: applied.orderType,
    }),
    [data, range, applied.paymentMethod, applied.orderType],
  );

  const generateReport = () => {
    const anchorDate = new Date(`${activeBusinessDay(data.businessDays)?.businessDate || businessDateForTimestamp(new Date())}T12:00:00`);
    try {
      resolveReportDateRange(period, anchorDate, customStart, customEnd);
      setApplied({
        period,
        anchorDate: localDateKey(anchorDate),
        startDate: customStart,
        endDate: customEnd,
        paymentMethod: method,
        orderType: type,
      });
      setPeriodError('');
    } catch (error) {
      setPeriodError(error instanceof Error ? error.message : 'Choose a valid reporting period.');
    }
  };

  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadReportWorkbook(report, data.settings);
      toast('Excel report downloaded.');
    } catch (error) {
      console.error('Excel report export failed:', error);
      toast('The Excel report could not be created. Try again in this browser.');
    } finally {
      setExporting(false);
    }
  };

  const best = report.itemsSold.slice(0, 8);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'register local time';

  return (
    <div className="page">
      <PageHeader
        eyebrow="SERVICE PERFORMANCE"
        title="Reports."
        subtitle="Review completed sales, saved expenses and daily performance for a selected period."
      />
      <div className="toolbar report-toolbar">
        <div className="field report-control">
          <label htmlFor="report-period">Reporting period</label>
          <select
            id="report-period"
            className="select"
            value={period}
            onChange={event => { setPeriod(event.target.value as ReportPeriod); setPeriodError(''); }}
            aria-label="Report period"
            data-testid="select-report-period"
          >
            {REPORT_PERIOD_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        {period === 'custom' && (
          <>
            <div className="field report-control">
              <label htmlFor="report-custom-start">Start date</label>
              <input
                id="report-custom-start"
                className="input"
                type="date"
                value={customStart}
                onChange={event => { setCustomStart(event.target.value); setPeriodError(''); }}
                data-testid="input-report-start"
              />
            </div>
            <div className="field report-control">
              <label htmlFor="report-custom-end">End date</label>
              <input
                id="report-custom-end"
                className="input"
                type="date"
                value={customEnd}
                onChange={event => { setCustomEnd(event.target.value); setPeriodError(''); }}
                data-testid="input-report-end"
              />
            </div>
          </>
        )}
        <div className="field report-control">
          <label htmlFor="report-method">Payment method</label>
          <select
            id="report-method"
            className="select"
            value={method}
            onChange={event => setMethod(event.target.value as PaymentMethod | 'all')}
            aria-label="Report payment method"
            data-testid="filter-report-method"
          >
            <option value="all">All methods</option>
            {REPORT_PAYMENT_METHODS.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="field report-control">
          <label htmlFor="report-type">Order type</label>
          <select
            id="report-type"
            className="select"
            value={type}
            onChange={event => setType(event.target.value as OrderType | 'all')}
            aria-label="Report order type"
            data-testid="filter-report-type"
          >
            <option value="all">All types</option>
            {REPORT_ORDER_TYPES.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" onClick={generateReport} data-testid="button-generate-report">
          <CalendarDays size={15} /> Generate report
        </button>
        <button
          className="btn"
          onClick={exportExcel}
          disabled={exporting}
          data-testid="button-export-report-excel"
        >
          <FileText size={15} /> {exporting ? 'Creating Excel…' : 'Export Excel (.xlsx)'}
        </button>
      </div>
      {periodError && <p className="validation" role="alert" data-testid="report-period-error">{periodError}</p>}
      <div className="report-period-summary" data-testid="report-period-summary">
        <div>
          <span className="eyebrow">REPORTING PERIOD</span>
          <strong>{report.range.label}</strong>
        </div>
        <span className="report-local-time">Register local time · {timezone}</span>
      </div>

      <div className="stat-grid report-stat-grid">
        <Stat label="Total sales" value={money(report.totals.sales, currency(data))} foot="Completed order totals" icon={<CircleDollarSign />} />
        <Stat label="Completed orders" value={String(report.totals.completedOrders)} foot="Cancelled tickets excluded from sales" icon={<Check />} />
        <Stat label="Cancelled orders" value={String(report.totals.cancelledOrders)} foot="Shown separately, not counted as sales" icon={<X />} />
        <Stat label="Total expenses" value={money(report.totals.expenses, currency(data))} foot={`${report.expenses.length} recorded expenses`} icon={<ReceiptText />} />
        <Stat label="Net amount after recorded expenses" value={money(report.totals.netAmount, currency(data))} foot="Completed sales minus recorded expenses" icon={<Banknote />} />
        <Stat label="Total discounts" value={money(report.totals.discounts, currency(data))} foot="Completed orders only" icon={<CircleHelp />} />
        <Stat label="Delivery charges collected" value={money(report.totals.deliveryCharges, currency(data))} foot="Included in order sales totals" icon={<MapPin />} />
        <Stat label="Average completed-order value" value={money(report.totals.averageOrderValue, currency(data))} foot="Completed sales divided by completed orders" icon={<BarChart3 />} />
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">PAYMENT METHOD</div>
              <h2 className="panel-title">Sales by payment method</h2>
            </div>
          </div>
          <div className="report-breakdown">
            {report.salesByPaymentMethod.map(row => (
              <div className="break-row" key={row.method}>
                <span>{row.method}</span>
                <b>{money(row.amount, currency(data))}</b>
              </div>
            ))}
          </div>
          <p className="report-footnote">Payment totals use saved paid payment records and are not added a second time to sales.</p>
        </section>
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">ORDER TYPE</div>
              <h2 className="panel-title">Sales by order type</h2>
            </div>
          </div>
          <div className="report-breakdown">
            {report.salesByOrderType.map(row => (
              <div className="break-row" key={row.type}>
                <span>{row.type}<small> · {row.orderCount} orders</small></span>
                <b>{money(row.amount, currency(data))}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="dash-grid report-secondary-grid">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="eyebrow">RECORDED SPEND</div>
              <h2 className="panel-title">Expenses by category</h2>
            </div>
            <span className="badge">{report.expensesByCategory.length} categories</span>
          </div>
          {report.expensesByCategory.length ? (
            <div className="report-breakdown">
              {report.expensesByCategory.map(row => (
                <div className="break-row" key={row.category}>
                  <span>{row.category}</span>
                  <b>{money(row.amount, currency(data))}</b>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No recorded expenses" description="Expenses entered for this period will appear here." icon={<ReceiptText size={20} />} />
          )}
        </section>
        <section className="panel report-net-note">
          <div className="eyebrow">HOW TO READ THIS FIGURE</div>
          <h2 className="panel-title">Net Amount After Recorded Expenses</h2>
          <p>{'Completed sales − recorded expenses.'}</p>
          <p className="report-footnote">This is not guaranteed accounting profit. Inventory costs, unpaid bills, taxes and other costs not recorded in this register are excluded.</p>
        </section>
      </div>

      <section className="panel report-table-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">DATE-BY-DATE</div>
            <h2 className="panel-title">Daily breakdown</h2>
          </div>
          <span className="badge">{report.dailyBreakdown.length} days</span>
        </div>
        <div className="table-wrap">
          <table className="data-table" data-testid="table-report-daily">
            <thead>
              <tr><th>Date</th><th>Completed orders</th><th>Sales total</th><th>Expenses total</th><th>Net amount after recorded expenses</th></tr>
            </thead>
            <tbody>
              {report.dailyBreakdown.map(row => (
                <tr key={row.date}>
                  <td>{formatLocalDateKey(row.date)}</td>
                  <td>{row.completedOrders}</td>
                  <td className="mono">{money(row.sales, currency(data))}</td>
                  <td className="mono">{money(row.expenses, currency(data))}</td>
                  <td className="mono">{money(row.netAmount, currency(data))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel report-table-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">SAVED ORDER-LINE SNAPSHOTS</div>
            <h2 className="panel-title">Best-selling items</h2>
          </div>
          <span className="badge">{report.itemsSold.length} items in export</span>
        </div>
        {best.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table" data-testid="table-report-items">
                <thead><tr><th>Rank</th><th>Item</th><th>Quantity sold</th><th>Sales amount</th></tr></thead>
                <tbody>
                  {best.map((item, index) => (
                    <tr key={`${item.menuItemId}-${item.name}`}>
                      <td className="mono">{String(index + 1).padStart(2, '0')}</td>
                      <td>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td className="mono">{money(item.sales, currency(data))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="report-footnote">{'Sales are saved line totals before any order-level discount allocation. Combo contents are shown only as their saved order line because individual contents are not stored.'}</p>
          </>
        ) : (
          <Empty title="No completed items in this period" description="Best sellers will appear after completed tickets are recorded." icon={<Salad size={20} />} />
        )}
      </section>
    </div>
  );
}

function StaffPage() {
  const {data,setData,toast}=useStore();
  const [editing,setEditing]=useState<string|null>(null);
  const [form,setForm]=useState({name:'',username:'',password:'',role:'Cashier' as UserRole});
  const [error,setError]=useState('');
  const open=(user?:AppData['users'][number])=>{setEditing(user?.id||'new');setForm({name:user?.name||'',username:user?.username||'',password:user?.password||'',role:user?.role||'Cashier'});setError('');};
  const save=(event:FormEvent)=>{event.preventDefault();if(!form.name.trim()||!form.username.trim()||(editing==='new'&&!form.password.trim())){setError('Name and username are required. Add a PIN for a new account.');return;}if(data.users.some(user=>user.username.toLowerCase()===form.username.trim().toLowerCase()&&user.id!==editing)){setError('That username is already in use.');return;}setData(current=>({...current,users:editing==='new'?[...current.users,{id:makeId(),name:form.name.trim(),username:form.username.trim(),password:form.password,role:form.role,createdAt:now()}]:current.users.map(user=>user.id===editing?{...user,name:form.name.trim(),username:form.username.trim(),...(form.password.trim()?{password:form.password}:{}),role:form.role}:user)}));toast('Staff account saved.');setEditing(null);};
  const remove=(user:AppData['users'][number])=>{if(user.developmentOnly){toast('Development accounts are protected.');return;}if(data.users.filter(entry=>entry.role==='Manager').length===1&&user.role==='Manager'){toast('Keep at least one manager account.');return;}if(window.confirm(`Remove ${user.name}'s local account?`)){setData(current=>({...current,users:current.users.filter(entry=>entry.id!==user.id)}));toast('Account removed.');}};
  return <div className="page"><PageHeader eyebrow="LOCAL ACCESS" title="Staff." subtitle="Local accounts for this register. Development accounts remain clearly marked." action={<button className="btn btn-primary" onClick={()=>open()}><Plus size={15}/> Add staff account</button>}/><section className="panel"><div className="panel-head"><div><div className="eyebrow">LOCAL ACCOUNTS</div><h2 className="panel-title">People on this register</h2></div><span className="badge">{data.users.length} accounts</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Account</th><th>Actions</th></tr></thead><tbody>{data.users.map(user=><tr key={user.id}><td><b>{user.name}</b></td><td className="mono">{user.username}</td><td><span className="badge">{user.role}</span></td><td>{user.developmentOnly?<span className="badge badge-orange">Development only</span>:'Local account'}</td><td><button className="btn btn-sm" onClick={()=>open(user)}><Pencil size={12}/> Edit</button> <button className="btn btn-sm btn-danger" disabled={!!user.developmentOnly} onClick={()=>remove(user)}><Trash2 size={12}/> Remove</button></td></tr>)}</tbody></table></div></section>{editing&&<Dialog title={editing==='new'?'Add staff account':'Edit staff account'} onClose={()=>setEditing(null)}><form onSubmit={save}><div className="form-grid"><div className="field span-2"><label>Name</label><input className="input" value={form.name} onChange={event=>setForm({...form,name:event.target.value})} required/></div><div className="field"><label>Username</label><input className="input" value={form.username} onChange={event=>setForm({...form,username:event.target.value})} required/></div><div className="field"><label>{editing==='new'?'PIN / password':'New PIN / password (leave blank to keep current)'}</label><input className="input" type="password" autoComplete="new-password" value={form.password} onChange={event=>setForm({...form,password:event.target.value})} required={editing==='new'} minLength={editing==='new'?4:undefined}/></div><div className="field span-2"><label>Role</label><select className="select" value={form.role} onChange={event=>setForm({...form,role:event.target.value as UserRole})}><option>Manager</option><option>Cashier</option></select></div></div>{error&&<p className="validation">{error}</p>}<div className="dialog-actions" style={{paddingRight:0,paddingBottom:0}}><button type="button" className="btn" onClick={()=>setEditing(null)}>Cancel</button><button className="btn btn-primary">Save account</button></div></form></Dialog>}</div>;
}

function prepareLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Choose an image file for the logo.')); return; }
    if (file.size > 8 * 1024 * 1024) { reject(new Error('Choose an image smaller than 8 MB.')); return; }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('This image could not be opened.')); };
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        const maxDimension = 1200;
        const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) { reject(new Error('This browser could not process the logo image.')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let dataUrl = canvas.toDataURL('image/webp', 0.86);
        if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > 1_000_000) { reject(new Error('The optimized logo is still too large. Choose a smaller image.')); return; }
        resolve(dataUrl);
      } catch {
        reject(new Error('This image could not be prepared for local storage.'));
      }
    };
    image.src = objectUrl;
  });
}

function SettingsPage() {
  const {data,setData,flushSave,toast}=useStore();
  const [form,setForm]=useState(data.settings);
  const [saved,setSaved]=useState(true);
  const [logoError,setLogoError]=useState('');
  const [backupResult,setBackupResult]=useState<Awaited<ReturnType<typeof localService.backupDatabase>>|null>(null);
  const [backupError,setBackupError]=useState('');
  const [verifiedBackups,setVerifiedBackups]=useState<VerifiedLocalDatabaseBackup[]>([]);
  const [backupListLoading,setBackupListLoading]=useState(false);
  const [backupListError,setBackupListError]=useState('');
  const [restoreTarget,setRestoreTarget]=useState<VerifiedLocalDatabaseBackup|null>(null);
  const [restoreConfirmation,setRestoreConfirmation]=useState('');
  const [restoreError,setRestoreError]=useState('');
  const [restoreBusy,setRestoreBusy]=useState(false);
  useEffect(()=>{setForm(data.settings);setSaved(true);},[data.settings]);
  const change=(key:keyof AppData['settings'],value:string|boolean)=>{setForm(current=>({...current,[key]:value}));setSaved(false);};
  const submit=(event:FormEvent)=>{event.preventDefault();if(!form.name.trim()||!form.currency.trim()){toast('Restaurant name and currency are required.');return;}setData(current=>({...current,settings:{...current.settings,...form,name:form.name.trim(),currency:form.currency.trim().toUpperCase()}}));setSaved(true);toast('Restaurant settings saved.');};
  const refreshBackupList=async()=>{
    if(!usesLocalSqlite)return;
    setBackupListLoading(true);
    setBackupListError('');
    try{setVerifiedBackups(await localService.listDatabaseBackups());}
    catch(error){setBackupListError(error instanceof Error?error.message:'Could not read verified SQLite backups.');}
    finally{setBackupListLoading(false);}
  };
  useEffect(()=>{void refreshBackupList();},[]);
  const createBackup=async()=>{setBackupError('');setBackupResult(null);try{const result=await localService.backupDatabase();setBackupResult(result);toast('Verified SQLite backup created.');void refreshBackupList();}catch(error){setBackupError(error instanceof Error?error.message:'Could not create the SQLite backup.');}};
  const openRestoreConfirmation=(backup:VerifiedLocalDatabaseBackup)=>{setRestoreTarget(backup);setRestoreConfirmation('');setRestoreError('');};
  const closeRestoreConfirmation=()=>{if(restoreBusy)return;setRestoreTarget(null);setRestoreConfirmation('');setRestoreError('');};
  const restoreBackup=async()=>{
    if(!restoreTarget||restoreConfirmation!=='RESTORE'||restoreBusy)return;
    setRestoreBusy(true);
    setRestoreError('');
    let currentDataSaved=false;
    try{
      await flushSave();
      currentDataSaved=true;
      const result=await localService.restoreDatabase(restoreTarget);
      toast(`Database restored. Safety backup: ${result.safetyBackup.filename}. Sign in again to continue.`);
      setRestoreTarget(null);
      window.setTimeout(()=>window.location.reload(),1200);
    }catch(error){
      const message=error instanceof Error?error.message:'The database could not be restored.';
      setRestoreError(currentDataSaved?message:`Restore was not started because current POS changes could not be saved: ${message}`);
    }
    finally{setRestoreBusy(false);}
  };
  return (
    <div className="page">
      <PageHeader eyebrow="REGISTER PREFERENCES" title="Settings." subtitle="Restaurant identity, receipt presentation and data transfer." />
      <form className="panel settings-form" onSubmit={submit}>
        <div className="panel-head"><div><div className="eyebrow">RECEIPT IDENTITY</div><h2 className="panel-title">Restaurant details</h2></div><span className="badge badge-green">Saved on this device</span></div>
        <div className="form-grid settings-grid">
          <div className="field span-2"><label htmlFor="settings-name">Restaurant name *</label><input id="settings-name" className="input" value={form.name} onChange={event=>change('name',event.target.value)} required data-testid="input-settings-name" /></div>
          <div className="field span-2"><label htmlFor="settings-address">Address</label><input id="settings-address" className="input" value={form.address} onChange={event=>change('address',event.target.value)} data-testid="input-settings-address" /></div>
          <div className="field"><label htmlFor="settings-phone">Phone</label><input id="settings-phone" className="input" value={form.phone} onChange={event=>change('phone',event.target.value)} data-testid="input-settings-phone" /></div>
          <div className="field"><label htmlFor="settings-currency">Currency code *</label><input id="settings-currency" className="input" maxLength={5} value={form.currency} onChange={event=>change('currency',event.target.value)} data-testid="input-settings-currency" /></div>
          <div className="field span-2"><label htmlFor="settings-footer">Receipt footer</label><textarea id="settings-footer" className="textarea" maxLength={180} value={form.receiptFooter} onChange={event=>change('receiptFooter',event.target.value)} data-testid="input-settings-footer" /></div>
          <div className="field"><label htmlFor="settings-width">Browser print width</label><select id="settings-width" className="select" value={form.printWidth} onChange={event=>change('printWidth',event.target.value)} data-testid="select-settings-print-width"><option value="narrow">Narrow receipt</option><option value="wide">Wide receipt</option></select></div>
          <label className="check-setting"><input type="checkbox" checked={form.compactDisplay} onChange={event=>change('compactDisplay',event.target.checked)} data-testid="input-settings-compact" /> Compact register display</label>
          <div className="field span-2">
            <label htmlFor="settings-logo">Restaurant logo</label>
            <div className="settings-logo-row">
              {form.logoDataUrl
                ? <img className="settings-logo-preview" src={form.logoDataUrl} alt="Restaurant logo preview" data-testid="img-restaurant-logo-preview" />
                : <div className="settings-logo-empty" data-testid="status-logo-missing">No logo configured</div>}
              <div className="settings-logo-controls">
                <input id="settings-logo" className="input" type="file" accept="image/*" onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(!file)return;setLogoError('');void prepareLogo(file).then(dataUrl=>change('logoDataUrl',dataUrl)).catch(error=>setLogoError(error instanceof Error?error.message:'Logo upload failed.'));}} data-testid="input-restaurant-logo" />
                {form.logoDataUrl && <button type="button" className="btn btn-sm btn-danger" onClick={()=>{change('logoDataUrl','');setLogoError('');}} data-testid="button-remove-restaurant-logo"><X size={13} /> Remove logo</button>}
              </div>
            </div>
            <p className="page-subtitle">Images are resized and saved locally in this browser. Save settings to keep the logo on receipts.</p>
            {logoError && <p className="validation" role="alert" data-testid="status-logo-error">{logoError}</p>}
          </div>
        </div>
        <div className="settings-actions"><span className="page-subtitle">{saved?'Changes are saved locally when submitted.':'Unsaved changes'}</span><button className="btn btn-primary" type="submit" data-testid="button-save-settings"><Check size={14}/> Save settings</button></div>
        <p className="page-subtitle"><Printer size={13}/> Receipt printing opens the browser print dialog; no physical printer integration is included.</p>
      </form>
      <section className="panel" style={{marginTop:16}}>
        <div className="panel-head"><div><div className="eyebrow">DATA SAFETY</div><h2 className="panel-title">Export and backup</h2></div><span className="badge">{usesLocalSqlite?'Local SQLite':'Browser storage'}</span></div>
        <p className="page-subtitle">{usesLocalSqlite?'Create a verified SQLite copy on this computer. The JSON export can be transferred to another empty local database.':'Download a one-time migration file to transfer this register to a local Windows database.'} Migration files contain business records; staff PINs are intentionally excluded. Store exported files securely.</p>
        <div className="settings-actions" style={{justifyContent:'flex-start',gap:10}}>
          <button className="btn" type="button" onClick={()=>{downloadMigrationFile(data);setBackupError('');toast('Migration JSON downloaded. Staff PINs were excluded.');}}>Download migration JSON</button>
          {usesLocalSqlite&&<button className="btn btn-primary" type="button" onClick={()=>void createBackup()}>Create verified SQLite backup</button>}
        </div>
        {backupError&&<p className="validation" role="alert">{backupError}</p>}
        {backupResult&&<div className="status-banner" role="status" style={{marginTop:12,display:'block'}}><b>Backup verified.</b> Copy saved as <code>{`backups/${backupResult.filename}`}</code><br/><span className="mono">SHA-256: {backupResult.sha256}</span></div>}
        <p className="page-subtitle" style={{marginTop:12}}>{usesLocalSqlite?'The SQLite database is stored under the current Windows user’s local application-data folder. Use the generated backup for recovery; do not copy the active database while the service is running.':'Replit Preview continues to use this browser’s local storage; exporting does not remove or modify it.'}</p>
      </section>
      {usesLocalSqlite&&<section className="panel" style={{marginTop:16}}>
        <div className="panel-head"><div><div className="eyebrow">RECOVERY</div><h2 className="panel-title">Restore a verified SQLite backup</h2></div><button className="btn btn-sm" type="button" onClick={()=>void refreshBackupList()} disabled={backupListLoading||restoreBusy}>{backupListLoading?'Checking…':'Refresh list'}</button></div>
        <p className="page-subtitle">Only verified, compatible Restaurant POS backups are listed. Restoring replaces all current SQLite records. A verified safety backup of the current database is created first, and the register signs out after a successful restore.</p>
        {backupListError&&<p className="validation" role="alert">{backupListError}</p>}
        {backupListLoading&&!verifiedBackups.length&&<div className="status-banner" role="status">Checking for verified backups…</div>}
        {!backupListLoading&&!backupListError&&!verifiedBackups.length&&<div className="status-banner" role="status">No verified SQLite backups are available on this computer.</div>}
        {!!verifiedBackups.length&&<div className="table-wrap"><table className="data-table">
          <thead><tr><th>Backup</th><th>Created</th><th>Size</th><th>SHA-256</th><th>Action</th></tr></thead>
          <tbody>{verifiedBackups.map(backup=><tr key={backup.filename}>
            <td><code>{backup.filename}</code></td>
            <td><time dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString()}</time></td>
            <td>{backup.size.toLocaleString()} bytes</td>
            <td><span className="mono" title={backup.sha256}>{backup.sha256.slice(0,12)}…</span></td>
            <td><button className="btn btn-sm btn-danger" type="button" onClick={()=>openRestoreConfirmation(backup)} disabled={restoreBusy}>Restore…</button></td>
          </tr>)}</tbody>
        </table></div>}
      </section>}
      {restoreTarget&&<Dialog title="Confirm SQLite restore" onClose={closeRestoreConfirmation}>
        <div className="callout" role="alert">This replaces the current restaurant database with the selected backup. The app will first create a verified safety copy of the current database. All register sessions will be signed out after the restore.</div>
        <div className="panel" style={{marginTop:14,padding:12}}>
          <div className="stat-label">SELECTED BACKUP</div>
          <div><code>{restoreTarget.filename}</code></div>
          <div className="page-subtitle" style={{marginTop:5}}>{new Date(restoreTarget.createdAt).toLocaleString()} · {restoreTarget.size.toLocaleString()} bytes</div>
        </div>
        <div className="field" style={{marginTop:14}}>
          <label htmlFor="restore-confirmation">Type RESTORE to confirm</label>
          <input id="restore-confirmation" className="input" autoComplete="off" value={restoreConfirmation} onChange={event=>setRestoreConfirmation(event.target.value)} disabled={restoreBusy} data-testid="input-restore-confirmation" />
        </div>
        {restoreError&&<p className="validation" role="alert" data-testid="status-restore-error">{restoreError}</p>}
        <div className="dialog-actions" style={{paddingRight:0,paddingBottom:0}}>
          <button className="btn" type="button" onClick={closeRestoreConfirmation} disabled={restoreBusy}>Cancel</button>
          <button className="btn btn-danger" type="button" onClick={()=>void restoreBackup()} disabled={restoreConfirmation!=='RESTORE'||restoreBusy} data-testid="button-confirm-sqlite-restore">{restoreBusy?'Restoring…':'Replace database'}</button>
        </div>
      </Dialog>}
    </div>
  );
}

interface CartEntry { item: MenuItem; quantity: number; note: string }
interface CartDealEntry { deal: OrderDeal; quantity: number }
function QuantityField({ value, onCommit, label, testId }: { value: number; onCommit: (next: number) => void; label: string; testId: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    if (/^[1-9]\d*$/.test(draft) && Number.isSafeInteger(Number(draft))) onCommit(Number(draft));
    else setDraft(String(value));
  };
  return <input className="input qty-entry" type="text" inputMode="numeric" aria-label={`${label} quantity`} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); (event.currentTarget as HTMLInputElement).blur(); } }} data-testid={testId} />;
}
function PosPage() {
  const { data, setData, user, draftTableId, setDraftTableId, recoveryDetected, toast } = useStore();
  const [type, setType] = useState<OrderType>('Dine-in');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [cartDeals, setCartDeals] = useState<CartDealEntry[]>([]);
  const [discount, setDiscount] = useState('0');
  const [deliveryCharge, setDeliveryCharge] = useState('0');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('Cash');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [completed, setCompleted] = useState<Order | null>(null);
  const autoPrintedOrders = useRef(new Set<string>());
  useEffect(() => {
    if (!completed || autoPrintedOrders.current.has(completed.id)) return;
    autoPrintedOrders.current.add(completed.id);
    try {
      printCompletedOrder();
    } catch {
      toast('The browser could not open printing automatically. Use Print bill + kitchen token below.');
    }
  }, [completed, toast]);
  const openDay = activeBusinessDay(data.businessDays);
  const occupied = useMemo(() => occupiedTableIds(data.orders, openDay), [data.orders, openDay]);
  const availableTables = useMemo(() => data.tables.filter(table => !occupied.has(table.id)), [data.tables, occupied]);
  const categories = [...data.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const dealsCategoryId = 'deals';
  const items = data.menuItems.filter(item => item.available && selectedCategory !== dealsCategoryId && (selectedCategory === 'all' || item.categoryId === selectedCategory) && `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()));
  const activeDeals = data.deals.filter(deal => deal.active);
  const visibleDeals = activeDeals.filter(deal => {
    const includedItems = deal.items.map(line => data.menuItems.find(item => item.id === line.menuItemId)?.name || line.nameSnapshot || '').join(' ');
    return `${deal.name} ${deal.description || ''} ${includedItems}`.toLowerCase().includes(search.toLowerCase());
  });
  const visibleProductCount = selectedCategory === dealsCategoryId ? visibleDeals.length : items.length;
  const subtotal = cart.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0) +
    cartDeals.reduce((sum, entry) => sum + entry.deal.unitPrice * entry.quantity, 0);
  const itemCount = cart.reduce((sum, entry) => sum + entry.quantity, 0) + cartDeals.reduce((sum, entry) => sum + entry.quantity, 0);
  const hasCart = cart.length > 0 || cartDeals.length > 0;
  const parsedDiscount = Math.max(0, Math.min(subtotal, Number(discount) || 0));
  const charge = type === 'Delivery' ? Math.max(0, Number(deliveryCharge) || 0) : 0;
  const total = subtotal - parsedDiscount + charge;
  const addItem = (item: MenuItem) => setCart(current => { const found = current.find(entry => entry.item.id === item.id); return found ? current.map(entry => entry.item.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry) : [...current, { item, quantity: 1, note: '' }]; });
  const updateQuantity = (id: string, quantity: number) => setCart(current => current.map(entry => entry.item.id === id ? { ...entry, quantity } : entry));
  const adjustQuantity = (id: string, diff: number) => setCart(current => current.map(entry => entry.item.id === id ? { ...entry, quantity: entry.quantity + diff } : entry).filter(entry => entry.quantity > 0));
  const addDeal = (deal: Deal) => {
    const activeDeal = data.deals.find(entry => entry.id === deal.id && entry.active);
    if (!activeDeal) return;
    const snapshot: OrderDeal = {
      dealId: activeDeal.id,
      name: activeDeal.name,
      description: activeDeal.description,
      unitPrice: activeDeal.fixedPrice,
      quantity: 1,
      lineTotal: activeDeal.fixedPrice,
      items: activeDeal.items.map(line => ({
        menuItemId: line.menuItemId,
        name: data.menuItems.find(item => item.id === line.menuItemId)?.name || line.nameSnapshot || 'Removed menu item',
        quantity: line.quantity,
      })),
    };
    setCartDeals(current => {
      const existing = current.find(entry => entry.deal.dealId === activeDeal.id);
      return existing
        ? current.map(entry => entry.deal.dealId === activeDeal.id ? { ...entry, quantity: entry.quantity + 1 } : entry)
        : [...current, { deal: snapshot, quantity: 1 }];
    });
  };
  const complete = () => {
    if (!openDay) { toast('Start a business day before taking new orders.'); setCheckout(false); return; }
    if (!hasCart) return;
    if (type === 'Dine-in' && draftTableId && occupied.has(draftTableId)) { setDraftTableId(nextAvailableTableId(availableTables, new Set())); toast('That table was just assigned to another order. Choose an available table.'); return; }
    if (type === 'Delivery' && (!customerName.trim() || !customerPhone.trim() || !deliveryAddress.trim())) { toast('Add the delivery name, phone and address.'); return; }
    const cashReceived = method === 'Cash' ? Number(received) : total;
    if (method === 'Cash' && cashReceived < total) { toast('Cash received must cover the total.'); return; }
    const table = type === 'Dine-in' && draftTableId ? data.tables.find(entry => entry.id === draftTableId && !occupied.has(entry.id)) : undefined;
    if (type === 'Dine-in' && draftTableId && !table) { setDraftTableId(null); toast('The selected table is no longer available. Choose another table or continue without one.'); return; }
    const createdAt = now();
    const orderId = makeId();
    const payment: Payment = {
      id: makeId(), orderId, dateTime: createdAt, createdAt, method, amount: total, status: 'paid',
      amountReceived: method === 'Cash' ? cashReceived : undefined,
      change: method === 'Cash' ? cashReceived - total : undefined,
      reference: reference.trim() || undefined,
    };
    const deals = cartDeals.map(entry => ({ ...entry.deal, quantity: entry.quantity, lineTotal: entry.deal.unitPrice * entry.quantity }));
    const order: Order = {
      id: orderId, orderNumber: `JH-${String(data.orders.length + 1).padStart(4, '0')}`, createdAt, updatedAt: createdAt, type, status: 'paid', businessDayId: openDay.id, tableId: table?.id, tableNameSnapshot: table?.name,
      customerName: customerName.trim() || undefined, customerPhone: customerPhone.trim() || undefined, deliveryAddress: deliveryAddress.trim() || undefined, notes: orderNotes.trim() || undefined, subtotal, discount: parsedDiscount, deliveryCharge: charge, total, cashierName: user?.name || 'Cashier',
      items: cart.map(entry => ({ menuItemId: entry.item.id, name: entry.item.name, unitPrice: entry.item.price, quantity: entry.quantity, lineTotal: entry.item.price * entry.quantity, note: entry.note || undefined })),
      deals,
      payment,
    };
    setData(current => ({ ...current, orders: [...current.orders, order], payments: [...current.payments.filter(entry => entry.orderId !== orderId), payment] }));
    setCompleted(order); setCheckout(false); setCart([]); setCartDeals([]); setDiscount('0'); setDeliveryCharge('0'); setCustomerName(''); setCustomerPhone(''); setDeliveryAddress(''); setOrderNotes(''); setReceived(''); setReference(''); setDraftTableId(null);
  };
  const resetOrder = () => { setCompleted(null); setType('Dine-in'); setMethod('Cash'); };
  const setOrderType = (value: OrderType) => {
    setType(value);
    if (value !== 'Dine-in') setDraftTableId(null);
  };
  return <div className="page"><PageHeader eyebrow="POINT OF SALE" title="Build an order." subtitle="Add menu items or a fixed-price deal, then take payment." action={openDay ? <span className="badge badge-green"><i className="local-dot" /> {openDay.businessDate} · Open</span> : user?.role === 'Manager' ? <Link href="/business-day" className="btn btn-primary">Start Day <ChevronRight size={14} /></Link> : <span className="badge badge-orange">No business day open</span>} />
    {recoveryDetected && <div className="status-banner" style={{ marginBottom: 14 }}><AlertCircle size={15} /> Previous register session ended unexpectedly. Saved orders remain available; an unfinished cart could not be recovered.</div>}
    {!openDay && <div className="status-banner" style={{ marginBottom: 14 }}><Clock3 size={15} /> New orders are paused until a manager starts a business day. Saved records are not affected.</div>}
    <div className="pos-layout"><div className="pos-main">
      <div className="order-types">{(['Dine-in', 'Takeaway', 'Delivery'] as OrderType[]).map((value, i) => <button key={value} className={`type-choice ${type === value ? 'active' : ''}`} onClick={() => setOrderType(value)} data-testid={`button-order-type-${value.toLowerCase()}`}><strong>{value}</strong><small>{['A table in the room', 'Collect at the counter', 'To your doorstep'][i]}</small></button>)}</div>
      {type === 'Dine-in' && <div className="field" style={{ marginBottom: 14, maxWidth: 360 }}><label htmlFor="table-select">Table (optional)</label><select id="table-select" className="select" value={draftTableId || ''} onChange={event => setDraftTableId(event.target.value || null)} data-testid="select-table"><option value="">No table selected</option>{availableTables.map(table => <option key={table.id} value={table.id}>{table.name} · {table.capacity} seats</option>)}</select>{!availableTables.length && <small className="page-subtitle">No tables are available. You can still complete this dine-in order without a table.</small>}{draftTableId && <small className="page-subtitle">Selected for this unfinished ticket only; it is not marked occupied until checkout.</small>}</div>}
      {type === 'Delivery' && <section className="panel" style={{ padding: 15, marginBottom: 15 }}><div className="eyebrow">DELIVERY DETAILS</div><div className="form-grid"><div className="field"><label htmlFor="customer">Customer name *</label><input id="customer" className="input" value={customerName} onChange={event => setCustomerName(event.target.value)} placeholder="Name for the rider" data-testid="input-delivery-name" /></div><div className="field"><label htmlFor="phone">Phone *</label><input id="phone" className="input" value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} placeholder="+92 ..." data-testid="input-delivery-phone" /></div><div className="field span-2"><label htmlFor="address">Delivery address *</label><input id="address" className="input" value={deliveryAddress} onChange={event => setDeliveryAddress(event.target.value)} placeholder="Street, area, landmark" data-testid="input-delivery-address" /></div><div className="field"><label htmlFor="delivery-charge">Delivery charge</label><input id="delivery-charge" className="input" type="number" min="0" value={deliveryCharge} onChange={event => setDeliveryCharge(event.target.value)} data-testid="input-delivery-charge" /></div><div className="field"><label htmlFor="delivery-notes">Order notes</label><input id="delivery-notes" className="input" value={orderNotes} onChange={event => setOrderNotes(event.target.value)} placeholder="Optional preparation note" data-testid="input-order-notes" /></div></div></section>}
      <div className="toolbar"><div className="search-wrap" style={{ flex: 1 }}><Search /><input className="input" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find menu items or deals…" aria-label="Search menu" data-testid="input-menu-search" /></div><span className="badge">{visibleProductCount} {selectedCategory === dealsCategoryId ? 'deals' : 'available'}</span></div>
      <div className="category-row"><button className={`category-chip ${selectedCategory === 'all' ? 'active' : ''}`} onClick={() => setSelectedCategory('all')} data-testid="category-all">Everything</button>{categories.map(category => <button key={category.id} className={`category-chip ${selectedCategory === category.id ? 'active' : ''}`} onClick={() => setSelectedCategory(category.id)} data-testid={`category-filter-${category.id}`}>{category.name}</button>)}<button className={`category-chip ${selectedCategory === dealsCategoryId ? 'active' : ''}`} onClick={() => setSelectedCategory(dealsCategoryId)} data-testid="category-deals">Deals</button></div>
      {selectedCategory === dealsCategoryId
        ? visibleDeals.length
          ? <div className="menu-grid">{visibleDeals.map(deal => <button type="button" className="menu-tile deal-menu-tile" key={deal.id} onClick={() => addDeal(deal)} aria-label={`Add ${deal.name} to order for ${money(deal.fixedPrice, currency(data))}`} data-testid={`pos-deal-${deal.id}`}><div className="deal-menu-image"><PackagePlus size={22} /><span>DEAL</span></div><div className="menu-tile-copy"><span className="menu-tile-name">{deal.name}</span><span className="deal-menu-includes">{deal.items.map(line => `${line.quantity} × ${data.menuItems.find(item => item.id === line.menuItemId)?.name || line.nameSnapshot || 'Menu item'}`).join(' · ')}</span><span className="menu-tile-price">{money(deal.fixedPrice, currency(data))}</span><span className="deal-menu-action"><Plus size={13} /> Add deal</span></div></button>)}</div>
          : <div className="panel"><Empty title={activeDeals.length ? 'No deals match your search' : 'No active deals'} description={activeDeals.length ? 'Try another search.' : 'Ask a manager to add or activate a deal.'} icon={<PackagePlus size={20} />} /></div>
        : items.length
          ? <div className="menu-grid">{items.map(item => <button key={item.id} className="menu-tile" onClick={() => addItem(item)} data-testid={`menu-item-${item.id}`}><div className="menu-image">{item.imageDataUrl ? <img src={item.imageDataUrl} alt={item.name} /> : <span className="menu-placeholder">{item.name.split(' ').map(word => word[0]).slice(0, 2).join('')}</span>}</div><div className="menu-tile-copy"><span className="menu-tile-name">{item.name}</span><span className="menu-tile-desc">{item.description}</span><span className="menu-tile-price">{money(item.price, currency(data))}</span></div></button>)}</div>
          : <div className="panel"><Empty title="Nothing available here" description="Try another category or update availability in Menu setup." icon={<UtensilsCrossed size={20} />} /></div>}
    </div>
      <aside className="panel cart-panel"><div className="cart-head"><div><div className="eyebrow">CURRENT TICKET</div><h2 className="panel-title">{type} order</h2></div><span className="badge">{itemCount} lines</span></div>
        {hasCart ? <div className="cart-list">
          {cart.map(entry => <div className="cart-item" key={entry.item.id} data-testid={`cart-item-${entry.item.id}`}><div className="cart-item-top"><span>{entry.item.name}</span><span className="mono">{money(entry.item.price * entry.quantity, currency(data))}</span></div><div className="cart-item-meta">{money(entry.item.price, currency(data))} each</div><div className="cart-item-controls"><button className="qty-btn" onClick={() => adjustQuantity(entry.item.id, -1)} aria-label={`Remove one ${entry.item.name}`} data-testid={`button-decrease-${entry.item.id}`}><Minus size={12} /></button><QuantityField value={entry.quantity} onCommit={quantity => updateQuantity(entry.item.id, quantity)} label={entry.item.name} testId={`input-quantity-${entry.item.id}`} /><button className="qty-btn" onClick={() => adjustQuantity(entry.item.id, 1)} aria-label={`Add one ${entry.item.name}`} data-testid={`button-increase-${entry.item.id}`}><Plus size={12} /></button><input className="cart-note" value={entry.note} onChange={event => setCart(current => current.map(item => item.item.id === entry.item.id ? { ...item, note: event.target.value } : item))} placeholder="Item note (optional)" aria-label={`Note for ${entry.item.name}`} data-testid={`input-note-${entry.item.id}`} /><button className="btn btn-quiet btn-sm" onClick={() => setCart(current => current.filter(item => item.item.id !== entry.item.id))} aria-label={`Remove ${entry.item.name}`} data-testid={`button-remove-${entry.item.id}`}><Trash2 size={13} /></button></div></div>)}
          {cartDeals.map(entry => <div className="cart-item cart-deal-item" key={entry.deal.dealId} data-testid={`cart-deal-${entry.deal.dealId}`}><div className="cart-item-top"><span>{entry.deal.name}</span><span className="mono">{money(entry.deal.unitPrice * entry.quantity, currency(data))}</span></div><div className="cart-item-meta">Fixed offer · includes {entry.deal.items.map(item => `${item.quantity} × ${item.name}`).join(', ')}</div><div className="cart-item-controls"><button className="qty-btn" onClick={() => setCartDeals(current => current.map(line => line.deal.dealId === entry.deal.dealId ? { ...line, quantity: line.quantity - 1 } : line).filter(line => line.quantity > 0))} aria-label={`Remove one ${entry.deal.name}`}><Minus size={12} /></button><QuantityField value={entry.quantity} onCommit={quantity => setCartDeals(current => current.map(line => line.deal.dealId === entry.deal.dealId ? { ...line, quantity } : line))} label={entry.deal.name} testId={`input-deal-quantity-${entry.deal.dealId}`} /><button className="qty-btn" onClick={() => setCartDeals(current => current.map(line => line.deal.dealId === entry.deal.dealId ? { ...line, quantity: line.quantity + 1 } : line))} aria-label={`Add one ${entry.deal.name}`}><Plus size={12} /></button><button className="btn btn-quiet btn-sm" onClick={() => setCartDeals(current => current.filter(line => line.deal.dealId !== entry.deal.dealId))} aria-label={`Remove ${entry.deal.name}`}><Trash2 size={13} /></button></div></div>)}
        </div> : <div className="cart-empty"><ShoppingCart size={23} /><span>Nothing on this ticket yet.<br />Choose an item or deal to begin.</span></div>}
        <div style={{ padding: '0 17px 12px' }}><div className="field"><label htmlFor="discount">Discount amount</label><input id="discount" className="input" type="number" min="0" max={subtotal} value={discount} onChange={event => setDiscount(event.target.value)} data-testid="input-discount" /></div>{type !== 'Delivery' && <div className="field" style={{ marginTop: 9 }}><label htmlFor="ticket-note">Order note</label><input id="ticket-note" className="input" value={orderNotes} onChange={event => setOrderNotes(event.target.value)} placeholder="Optional kitchen note" data-testid="input-order-note" /></div>}</div>
        <div className="cart-totals"><div className="total-line"><span>Subtotal</span><strong>{money(subtotal, currency(data))}</strong></div>{parsedDiscount > 0 && <div className="total-line"><span>Discount</span><strong>− {money(parsedDiscount, currency(data))}</strong></div>}{charge > 0 && <div className="total-line"><span>Delivery</span><strong>{money(charge, currency(data))}</strong></div>}<div className="total-line grand-total"><span>Total due</span><strong>{money(total, currency(data))}</strong></div></div>
        <div className="cart-actions"><button className="btn btn-quiet btn-sm" onClick={() => { setCart([]); setCartDeals([]); toast('Ticket cleared.'); }} disabled={!hasCart} data-testid="button-clear-cart">Clear</button><button className="btn btn-primary" onClick={() => setCheckout(true)} disabled={!hasCart || !openDay || (type === 'Dine-in' && !!draftTableId && occupied.has(draftTableId))} data-testid="button-checkout">Take payment <ChevronRight size={15} /></button></div>
      </aside>
    </div>
    {checkout && (
      <Dialog title="Settle this ticket" onClose={() => setCheckout(false)}>
        <div className="status-banner" style={{ marginBottom: 17 }}><ReceiptText size={16} /><span>{itemCount} lines · <b>{money(total, currency(data))}</b> due</span></div>
        <div className="field"><label>Payment method</label><div className="payment-methods">{(['Cash', 'Card', 'Easypaisa', 'JazzCash', 'Other'] as PaymentMethod[]).map(value => <button key={value} className={`pay-method ${method === value ? 'active' : ''}`} onClick={() => setMethod(value)} data-testid={`payment-${value.toLowerCase()}`}>{value}</button>)}</div></div>
        {method === 'Cash' && <div className="form-grid" style={{ marginTop: 16 }}><div className="field"><label htmlFor="received">Cash received</label><input id="received" type="number" min={total} className="input" autoFocus value={received} onChange={event => setReceived(event.target.value)} placeholder={String(total)} data-testid="input-cash-received" /></div><div className="field"><label>Change due</label><div className="input" style={{ background: 'hsl(var(--secondary))' }}>{money(Math.max(0, (Number(received) || 0) - total), currency(data))}</div></div></div>}
        {method !== 'Cash' && <p className="page-subtitle" style={{ marginTop: 12 }}>Record the full bill against {method}. No external payment service is connected.</p>}
        <div className="field" style={{ marginTop: 16 }}><label htmlFor="payment-reference">Transaction/reference number (optional)</label><input id="payment-reference" className="input" value={reference} onChange={event => setReference(event.target.value)} data-testid="input-payment-reference" /></div>
        <div className="dialog-actions" style={{ padding: '22px 0 0' }}><button className="btn" onClick={() => setCheckout(false)}>Go back</button><button className="btn btn-primary" onClick={complete} data-testid="button-complete-payment"><Check size={14} /> Complete sale</button></div>
      </Dialog>
    )}
    {completed && <Dialog title="Payment recorded" onClose={resetOrder} wide><div className="status-banner" style={{ marginBottom: 12 }}><Check size={16} /> Order {completed.orderNumber} is paid and saved on this device.</div><p className="page-subtitle print-workflow-hint">The app asks your browser to print the customer bill and separate kitchen token. If browser restrictions prevent the dialog from opening, choose Print bill + kitchen token below. Printing requires browser confirmation; silent printing is not supported.</p><div className={`order-print-pack ${data.settings.printWidth || 'narrow'}`} data-testid={`order-print-pack-${completed.id}`}><Receipt order={completed} data={data} /><div className="kitchen-token-container" dangerouslySetInnerHTML={{ __html: buildKitchenTokenMarkup(completed, data.settings) }} /></div><div className="dialog-actions" style={{ paddingBottom: 0 }}><button className="btn" onClick={() => printReceipt()} data-testid="button-print-receipt"><Printer size={14} /> Print receipt</button><button className="btn btn-primary" onClick={() => printCompletedOrder()} data-testid="button-print-order-bundle"><Printer size={14} /> Print bill + kitchen token</button><button className="btn" onClick={resetOrder} data-testid="button-new-ticket">Start next order <ChevronRight size={14} /></button></div></Dialog>}
  </div>;
}

export default App;
