/**
 * Poll for a newer full register snapshot without replacing edits currently
 * being made in this tab.
 */
export async function refreshRegisterSnapshot({
  getCurrentRevision,
  readRemoteRevision,
  loadSnapshot,
  hasPendingChanges,
  acceptSnapshot,
  onRemoteUpdate,
}) {
  const beforePollRevision = getCurrentRevision();
  if (!Number.isSafeInteger(beforePollRevision) || beforePollRevision < 0) return 'uninitialized';

  const observedRevision = await readRemoteRevision();
  const currentRevision = getCurrentRevision();
  if (!Number.isSafeInteger(observedRevision) || observedRevision < 0) {
    throw new Error('The local POS service returned an invalid data revision.');
  }
  if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || observedRevision <= currentRevision) {
    return 'unchanged';
  }
  if (hasPendingChanges()) {
    onRemoteUpdate();
    return 'pending';
  }

  const snapshot = await loadSnapshot();
  if (hasPendingChanges()) {
    onRemoteUpdate();
    return 'pending';
  }
  const latestCurrentRevision = getCurrentRevision();
  if (!Number.isSafeInteger(latestCurrentRevision) || snapshot.revision <= latestCurrentRevision) {
    return 'unchanged';
  }

  acceptSnapshot(snapshot);
  return 'refreshed';
}
