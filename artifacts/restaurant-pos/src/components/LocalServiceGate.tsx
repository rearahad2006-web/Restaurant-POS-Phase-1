import { useState, type FormEvent, type ReactNode } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import type { LocalServiceBootstrap } from '@/storage/local-service';
import { localService } from '@/storage/local-service';

function GateLayout({ eyebrow, title, description, children }: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="login-screen">
      <section className="login-art">
        <div className="login-brand">
          <div className="brand-mark">J</div>
          <div><div className="brand-name">Juniper &amp; Hearth</div><div className="brand-sub">Local service desk</div></div>
        </div>
        <div className="login-hero">
          <div className="eyebrow" style={{ color: '#e8a17f' }}>{eyebrow}</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <span className="login-food-note">Your register data stays on this computer.</span>
      </section>
      <section className="login-form-side">
        <div className="login-form">{children}</div>
      </section>
    </div>
  );
}

export function LocalImportGate({ onImported }: { onImported: (info: LocalServiceBootstrap) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError('Choose the migration JSON exported from the browser that contains your POS records.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const parsed = JSON.parse(await file.text());
      const info = await localService.importBackup(parsed);
      onImported(info);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The migration file could not be imported.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateLayout
      eyebrow="ONE-TIME DATA IMPORT"
      title="Bring your register records."
      description="Choose the JSON migration file exported from the browser-based POS. The source browser data is not changed."
    >
      <form onSubmit={submit}>
        <div className="eyebrow">LOCAL REGISTER SETUP</div>
        <h2>Import existing data.</h2>
        <p>This empty Windows database accepts one validated import. Orders, payment history, menu, staff accounts and settings are preserved.</p>
        <div className="field">
          <label htmlFor="pos-migration-file">Browser migration file</label>
          <input
            id="pos-migration-file"
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={event => {
              setFile(event.currentTarget.files?.[0] || null);
              setError('');
            }}
            required
          />
        </div>
        <div className="status-banner" style={{ margin: '14px 0' }}>
          <FileText size={15} />
          Staff accounts will be kept, but their previous PINs are excluded. Set fresh PINs after import.
        </div>
        {error && <div className="validation" role="alert">{error}</div>}
        <button className="btn btn-primary login-submit" type="submit" disabled={busy || !file}>
          {busy ? 'Validating and importing…' : 'Validate and import'} <ChevronRight size={15} />
        </button>
      </form>
    </GateLayout>
  );
}

export function LocalManagerSetupGate({ restaurantName, onSetup }: {
  restaurantName?: string;
  onSetup: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await localService.setupManager({ name, username, password });
      await onSetup();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Manager setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateLayout
      eyebrow="SECURE LOCAL ACCESS"
      title="Set the manager PIN."
      description={restaurantName ? `Finish setting up ${restaurantName} on this Windows computer.` : 'Finish setting up the local register.'}
    >
      <form onSubmit={submit}>
        <div className="eyebrow">FIRST-TIME SETUP</div>
        <h2>Create manager access.</h2>
        <p>Use an existing manager username from the import to keep that account, or choose a new username.</p>
        <div className="field"><label htmlFor="setup-manager-name">Manager name</label><input id="setup-manager-name" className="input" value={name} onChange={event => setName(event.target.value)} autoComplete="name" required /></div>
        <div className="field"><label htmlFor="setup-manager-username">Username</label><input id="setup-manager-username" className="input" value={username} onChange={event => setUsername(event.target.value)} autoComplete="username" required /></div>
        <div className="field"><label htmlFor="setup-manager-pin">New PIN</label><input id="setup-manager-pin" className="input" type="password" inputMode="numeric" minLength={4} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" required /></div>
        {error && <div className="validation" role="alert">{error}</div>}
        <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
          {busy ? 'Setting up manager…' : 'Set manager PIN'} <ChevronRight size={15} />
        </button>
      </form>
    </GateLayout>
  );
}

export function LocalLoginGate({ restaurantName, onLogin }: {
  restaurantName?: string;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateLayout
      eyebrow="STAFF SIGN-IN"
      title="Open the register."
      description={restaurantName ? `${restaurantName} is running from this computer's local database.` : 'Your register is running from this computer’s local database.'}
    >
      <form onSubmit={submit}>
        <div className="eyebrow">LOCAL STAFF ACCESS</div>
        <h2>Welcome back.</h2>
        <p>Sign in to open the register on this computer.</p>
        <div className="field"><label htmlFor="local-username">Username</label><input id="local-username" className="input" value={username} onChange={event => { setUsername(event.target.value); setError(''); }} autoComplete="username" required /></div>
        <div className="field"><label htmlFor="local-pin">PIN</label><input id="local-pin" className="input" type="password" inputMode="numeric" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} autoComplete="current-password" required /></div>
        {error && <div className="validation" role="alert">{error}</div>}
        <button className="btn btn-primary login-submit" type="submit" disabled={busy}>
          {busy ? 'Checking PIN…' : 'Open register'} <ChevronRight size={15} />
        </button>
        <p style={{ marginTop: 20, fontSize: 10, lineHeight: 1.6 }}>Business records and PIN hashes stay in the local SQLite database. The local service is not connected to Replit or a cloud database.</p>
      </form>
    </GateLayout>
  );
}

export function LocalServiceStatus({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <GateLayout eyebrow="LOCAL SERVICE" title="The register did not start." description="The app will not fall back to browser storage while local SQLite mode is selected.">
      <div className="eyebrow">DATABASE NOT READY</div>
      <h2>Local service error.</h2>
      <div className="validation" role="alert">{message}</div>
      <button className="btn btn-primary login-submit" type="button" onClick={onRetry}>Retry connection</button>
    </GateLayout>
  );
}

export function BrowserStorageStatus({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <GateLayout eyebrow="BROWSER STORAGE" title="Saved register data could not be loaded." description="The register is blocked from opening with fallback data or creating a migration export. Keep this browser profile intact while resolving the storage issue.">
      <div className="validation" role="alert">{message}</div>
      <button className="btn btn-primary login-submit" type="button" onClick={onRetry}>Retry loading saved data</button>
    </GateLayout>
  );
}
