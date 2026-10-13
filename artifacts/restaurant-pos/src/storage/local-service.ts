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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
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
    throw new Error(message);
  }
  return body as T;
}

export class LocalServiceRepository implements RestaurantRepository {
  async load(): Promise<AppData> {
    return requestJson<AppData>('/api/data');
  }

  async save(data: AppData): Promise<void> {
    await requestJson<{ ok: boolean }>('/api/data', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
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
