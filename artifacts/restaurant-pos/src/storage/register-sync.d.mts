import type { AppData } from '../domain';

export function refreshRegisterSnapshot(options: {
  getCurrentRevision: () => number | null;
  readRemoteRevision: () => Promise<number>;
  loadSnapshot: () => Promise<{ data: AppData; revision: number }>;
  hasPendingChanges: () => boolean;
  acceptSnapshot: (snapshot: { data: AppData; revision: number }) => void;
  onRemoteUpdate: () => void;
}): Promise<'uninitialized' | 'unchanged' | 'pending' | 'refreshed'>;
