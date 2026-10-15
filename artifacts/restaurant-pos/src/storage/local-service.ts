import type { AppData, User } from '../domain';
import type { RestaurantRepository } from './repository';

declare global {
  interface Window {
    __RESTAURANT_POS_STORAGE__?: 'browser' | 'sqlite';
  }
}

export const usesLocalSqlite = window.__RESTAURANT_POS_STORAGE__ === 'sqlite';

export interface LocalServiceBootstrap {
  initialized: boolean;
  needsImport: boolean;
  needsManagerSetup: boolean;
  developmentMode: false;
  restaurantName?: string;
}

export interface LocalDatabaseBackup {
  filename: string;
  sha256: string;
  createdAt: string;
}

export interface VerifiedLocalDatabaseBackup extends LocalDatabaseBackup {
  size: number;
}

export interface LocalDatabaseRestoreResult {
  restored: true;
  backup: Pick<LocalDatabaseBackup, 'filename' | 'sha256'>;
  safetyBackup: LocalDatabaseBackup;
  revision: number;
}

export interface LocalDataSnapshot {
  data: AppData;
  revision: number;
}

export class LocalServiceConflictError extends Error {
  readonly currentRevision: number;

  constructor(message: string, currentRevision: number) {
    super(message);
    this.name = 'LocalServiceConflictError';
    this.currentRevision = currentRevision;
  }
}

export class LocalServiceSessionExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalServiceSessionExpiredError';
  }
}

async function requestJsonResponse<T>(url: string, init?: RequestInit): Promise<{ body: T; response: Response }> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error('The local POS service could not be reached. Your changes were not saved.');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`The local POS service returned an invalid response (${response.status}).`);
  }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body ? String(body.error) : `Local service request failed (${response.status}).`;
    if (response.status === 401) throw new LocalServiceSessionExpiredError(message);
    if (response.status === 409 && body && typeof body === 'object' && 'code' in body && body.code === 'DATA_REVISION_CONFLICT') {
      const revision = 'revision' in body ? Number(body.revision) : Number.NaN;
      if (Number.isSafeInteger(revision) && revision >= 0) throw new LocalServiceConflictError(message, revision);
    }
    throw new Error(message);
  }
  return { body: body as T, response };
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  return (await requestJsonResponse<T>(url, init)).body;
}

function responseRevision(response: Response): number {
  const revision = Number(response.headers.get('X-POS-Revision'));
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('The local POS service did not provide a valid data revision.');
  }
  return revision;
}

export class LocalServiceRepository implements RestaurantRepository {
  async load(): Promise<AppData> {
    return (await this.loadSnapshot()).data;
  }

  async loadSnapshot(): Promise<LocalDataSnapshot> {
    const { body, response } = await requestJsonResponse<AppData>('/api/data');
    return { data: body, revision: responseRevision(response) };
  }

  async currentRevision(): Promise<number> {
    const result = await requestJson<{ revision: number }>('/api/revision');
    if (!Number.isSafeInteger(result.revision) || result.revision < 0) {
      throw new Error('The local POS service returned an invalid data revision.');
    }
    return result.revision;
  }

  async save(data: AppData, revision?: number): Promise<number> {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      throw new Error('The local register is missing its data revision. Reload before saving.');
    }
    const { body, response } = await requestJsonResponse<{ ok: boolean; revision: number }>('/api/data', {
      method: 'PUT',
      body: JSON.stringify(data),
      headers: { 'X-POS-Revision': String(revision) },
    });
    const savedRevision = Number.isSafeInteger(body.revision) && body.revision >= 0
      ? body.revision
      : responseRevision(response);
    return savedRevision;
  }
}

export const localService = {
  bootstrap(): Promise<LocalServiceBootstrap> {
    return requestJson('/api/bootstrap');
  },

  async session(): Promise<User | null> {
    const result = await requestJson<{ user: User | null }>('/api/session');
    return result.user;
  },

  async importBackup(data: AppData): Promise<LocalServiceBootstrap> {
    const result = await requestJson<{ bootstrap: LocalServiceBootstrap }>('/api/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return result.bootstrap;
  },

  async setupManager(input: { name: string; username: string; password: string }): Promise<User> {
    const result = await requestJson<{ user: User }>('/api/manager-setup', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return result.user;
  },

  async login(username: string, password: string): Promise<User> {
    const result = await requestJson<{ user: User }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    return result.user;
  },

  async logout(): Promise<void> {
    await requestJson<{ ok: boolean }>('/api/logout', { method: 'POST' });
  },

  backupDatabase(): Promise<LocalDatabaseBackup> {
    return requestJson('/api/backup', { method: 'POST', body: '{}' });
  },

  async listDatabaseBackups(): Promise<VerifiedLocalDatabaseBackup[]> {
    const result = await requestJson<{ backups: VerifiedLocalDatabaseBackup[] }>('/api/backups');
    return result.backups;
  },

  restoreDatabase(input: Pick<LocalDatabaseBackup, 'filename' | 'sha256'>): Promise<LocalDatabaseRestoreResult> {
    return requestJson('/api/restore', {
      method: 'POST',
      body: JSON.stringify({ ...input, confirmed: true }),
    });
  },
};

export function downloadMigrationFile(data: AppData): void {
  const transfer: AppData = {
    ...data,
    users: data.users.map(user => ({
      ...user,
      password: '',
      developmentOnly: false,
    })),
  };
  const content = JSON.stringify(transfer, null, 2);
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `restaurant-pos-migration-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
