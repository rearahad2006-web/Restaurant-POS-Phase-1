import { AppData, seededData } from '../domain';

/** Replace this browser adapter with a SQLite adapter in the native Windows package. */
export interface RestaurantRepository {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
}

const STORAGE_KEY = 'juniper-pos.phase1.data.v1';
export class BrowserLocalRepository implements RestaurantRepository {
  async load(): Promise<AppData> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...seededData, ...JSON.parse(stored) } as AppData;
      const fresh = structuredClone(seededData);
      await this.save(fresh);
      return fresh;
    } catch {
      return structuredClone(seededData);
    }
  }
  async save(data: AppData): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }
}
export const repository: RestaurantRepository = new BrowserLocalRepository();
