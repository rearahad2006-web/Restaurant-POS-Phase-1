const collectionKeys = [
  'users',
  'tables',
  'categories',
  'menuItems',
  'orders',
  'payments',
  'expenses',
  'deals',
  'businessDays',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function equal(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((entry, index) => equal(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).filter(key => left[key] !== undefined).sort();
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equal(left[key], right[key]));
}

function mergeValue(base, local, remote, path, conflicts, preferLocal) {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const result = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    for (const key of keys) {
      const value = mergeValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts, preferLocal);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  conflicts.push(path);
  return preferLocal ? local : remote;
}

function mergeCollection(baseRows, localRows, remoteRows, path, conflicts, preferLocal) {
  const base = new Map(baseRows.map(row => [row.id, row]));
  const local = new Map(localRows.map(row => [row.id, row]));
  const remote = new Map(remoteRows.map(row => [row.id, row]));
  const ids = new Set([...remote.keys(), ...local.keys()]);
  const merged = [];

  for (const id of ids) {
    const baseRow = base.get(id);
    const localRow = local.get(id);
    const remoteRow = remote.get(id);
    const localChanged = !equal(localRow, baseRow);
    const remoteChanged = !equal(remoteRow, baseRow);
    let row;

    if (!localChanged) row = remoteRow;
    else if (!remoteChanged) row = localRow;
    else if (localRow === undefined || remoteRow === undefined) {
      conflicts.push(`${path}.${id}`);
      row = preferLocal ? localRow : remoteRow;
    } else {
      row = mergeValue(baseRow, localRow, remoteRow, `${path}.${id}`, conflicts, preferLocal);
    }

    if (row !== undefined) merged.push(row);
  }

  return merged;
}

/**
 * Three-way merge a locally edited POS snapshot with the latest saved snapshot.
 * Conflicting values default to the remote value; callers may choose the local
 * value only after an explicit user confirmation.
 */
export function mergeAppDataSnapshots(base, local, remote, { preferLocal = false } = {}) {
  const conflicts = [];
  const result = {};

  for (const key of Object.keys(remote)) {
    if (collectionKeys.includes(key)) {
      result[key] = mergeCollection(base[key] || [], local[key] || [], remote[key] || [], key, conflicts, preferLocal);
    } else {
      result[key] = mergeValue(base[key], local[key], remote[key], key, conflicts, preferLocal);
    }
  }

  const orderNumbers = new Map();
  for (const order of result.orders || []) {
    const previous = orderNumbers.get(order.orderNumber);
    if (previous && previous !== order.id) conflicts.push(`orders.orderNumber (${order.orderNumber})`);
    else orderNumbers.set(order.orderNumber, order.id);
  }

  return { data: result, conflicts: [...new Set(conflicts)] };
}
