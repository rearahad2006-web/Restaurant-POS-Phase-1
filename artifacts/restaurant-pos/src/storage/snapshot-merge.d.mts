import type { AppData } from '../domain';

export function mergeAppDataSnapshots(
  base: AppData,
  local: AppData,
  remote: AppData,
  options?: { preferLocal?: boolean },
): { data: AppData; conflicts: string[] };
