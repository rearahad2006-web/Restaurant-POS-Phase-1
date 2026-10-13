import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  authenticateUser,
  closeRestaurantDatabase,
  createManagerAccount,
  getBootstrapInfo,
  importLegacyBackup,
  isEmptyDatabase,
  loadAppData,
  openRestaurantDatabase,
  saveAppData,
  validateAppData,
} from './database.mjs';

const MAX_BODY_BYTES = 50 * 1024 * 1024;
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const COOKIE_NAME = 'restaurant_pos_session';
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

function isLoopback(address = '') {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function validateLocalRequest(request) {
  if (!isLoopback(request.socket.remoteAddress)) {
    throw new HttpError(403, 'The local POS service accepts connections only from this computer.');
  }
  let host;
  try {
    host = new URL(`http://${request.headers.host || ''}`);
  } catch {
    throw new HttpError(400, 'Invalid local service host.');
  }
  if (!['127.0.0.1', 'localhost'].includes(host.hostname)) {
    throw new HttpError(403, 'The local POS service accepts only localhost requests.');
  }
  const origin = request.headers.origin;
  if (origin) {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new HttpError(403, 'The request origin is not allowed.');
    }
    if (parsedOrigin.protocol !== 'http:' || parsedOrigin.host !== host.host) {
      throw new HttpError(403, 'The request origin is not allowed.');
    }
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'The request exceeds the 50 MB limit.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'The request body must contain valid JSON.');
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertCashierCanSave(db, input) {
  const existing = loadAppData(db);
  const restrictedFields = [
    'users',
    'settings',
    'tables',
    'categories',
    'menuItems',
    'expenses',
    'deals',
    'businessDays',
  ];
  for (const field of restrictedFields) {
    if (!equalJson(input[field], existing[field])) {
      throw new HttpError(403, 'Cashier accounts cannot change staff, settings, menu, tables, expenses, deals, or business days.');
    }
  }
}

async function createVerifiedBackup(db, backupDir) {
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const filename = `restaurant-pos-${stamp}-${randomBytes(4).toString('hex')}.sqlite`;
  const target = path.join(backupDir, filename);
  const temporary = `${target}.partial`;
  try {
    await db.backup(temporary);
    const checkDb = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      const integrity = checkDb.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`);
    } finally {
      checkDb.close();
    }
    const bytes = await import('node:fs/promises').then(fs => fs.readFile(temporary));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    return { filename, sha256, createdAt: new Date().toISOString() };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw new Error(`Could not create a verified SQLite backup: ${error.message}`);
  }
}

async function serveStatic(request, response, staticDir, pathname) {
  if (pathname === '/runtime-config.js') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/javascript; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end('window.__RESTAURANT_POS_STORAGE__ = "sqlite";');
    return;
  }

  const root = path.resolve(staticDir);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Invalid page path.');
  }
  const relative = decoded.replace(/^[/\\]+/, '') || 'index.html';
  const filePath = path.resolve(root, relative);
  const fromRoot = path.relative(root, filePath);
  if (fromRoot.startsWith('..') || path.isAbsolute(fromRoot)) {
    throw new HttpError(403, 'That file is outside the application directory.');
  }
  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
  } catch {
    if ((request.headers.accept || '').includes('text/html')) {
      return serveStatic(request, response, staticDir, '/index.html');
    }
    throw new HttpError(404, 'The requested file was not found.');
  }
  response.writeHead(200, {
    'Cache-Control': filePath.endsWith('.html') ? 'no-cache' : 'public, max-age=3600',
    'Content-Length': fileStat.size,
    'Content-Type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(filePath).pipe(response);
}

export async function createPosHttpService({ dataDir, staticDir, port = 0 } = {}) {
  if (!dataDir) throw new Error('Set LOCALAPPDATA or POS_DATA_DIR before starting the local POS service.');
  if (!staticDir) throw new Error('The built POS files were not specified.');
  const resolvedDataDir = path.resolve(dataDir);
  const resolvedStaticDir = path.resolve(staticDir);
  const backupDir = path.join(resolvedDataDir, 'backups');
  await mkdir(resolvedDataDir, { recursive: true, mode: 0o700 });
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  const db = openRestaurantDatabase(path.join(resolvedDataDir, 'restaurant-pos.sqlite'));
  const sessions = new Map();

  function currentUser(request) {
    const token = readCookie(request, COOKIE_NAME);
    const session = sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
    if (!row) {
      sessions.delete(token);
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      username: row.username,
      password: '',
      role: row.role,
      createdAt: row.created_at,
      ...(row.development_only ? { developmentOnly: true } : {}),
    };
  }

  function requireUser(request) {
    const user = currentUser(request);
    if (!user) throw new HttpError(401, 'Sign in to use the local register.');
    return user;
  }

  function requireManager(request) {
    const user = requireUser(request);
    if (user.role !== 'Manager') throw new HttpError(403, 'Manager access is required for this action.');
    return user;
  }

  function setSession(response, user) {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
    response.setHeader(
      'Set-Cookie',
      `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    );
  }

  async function handleApi(request, response, url) {
    const route = `${request.method} ${url.pathname}`;
    if (route === 'GET /api/bootstrap') {
      const bootstrap = getBootstrapInfo(db, false);
      sendJson(response, 200, {
        ...bootstrap,
        needsImport: isEmptyDatabase(db),
      });
      return;
    }
    if (route === 'GET /api/session') {
      sendJson(response, 200, { user: currentUser(request) });
      return;
    }
    if (route === 'POST /api/import') {
      if (!isEmptyDatabase(db)) throw new HttpError(409, 'Import is allowed only into an empty database; existing data was not changed.');
      const source = await readJsonBody(request);
      const validated = validateAppData(source);
      const resetPinData = {
        ...validated,
        users: validated.users.map(user => ({ ...user, password: '', developmentOnly: false })),
      };
      const safeJson = JSON.stringify(resetPinData);
      const result = await importLegacyBackup(db, backupDir, safeJson);
      sendJson(response, 200, { ...result, bootstrap: { ...getBootstrapInfo(db, false), needsImport: isEmptyDatabase(db) } });
      return;
    }
    if (route === 'POST /api/manager-setup') {
      const bootstrap = getBootstrapInfo(db, false);
      if (!bootstrap.initialized || !bootstrap.needsManagerSetup) {
        throw new HttpError(409, 'Manager setup is not available in the current database state.');
      }
      const input = await readJsonBody(request);
      const user = createManagerAccount(db, input);
      setSession(response, user);
      sendJson(response, 200, { user });
      return;
    }
    if (route === 'POST /api/login') {
      const input = await readJsonBody(request);
      const user = authenticateUser(db, input.username, input.password, false);
      if (!user) throw new HttpError(401, 'That username or PIN does not match an enabled local account.');
      setSession(response, user);
      sendJson(response, 200, { user });
      return;
    }
    if (route === 'POST /api/logout') {
      const token = readCookie(request, COOKIE_NAME);
      if (token) sessions.delete(token);
      sendJson(response, 200, { ok: true }, {
        'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
      });
      return;
    }
    if (route === 'GET /api/data') {
      requireUser(request);
      sendJson(response, 200, loadAppData(db));
      return;
    }
    if (route === 'PUT /api/data') {
      const user = requireUser(request);
      const input = await readJsonBody(request);
      if (user.role !== 'Manager') {
        try {
          assertCashierCanSave(db, input);
        } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, error.message);
        }
      }
      saveAppData(db, input);
      sendJson(response, 200, { ok: true });
      return;
    }
    if (route === 'POST /api/backup') {
      requireManager(request);
      const backup = await createVerifiedBackup(db, backupDir);
      sendJson(response, 200, backup);
      return;
    }
    throw new HttpError(404, 'Local POS API route not found.');
  }

  const server = createServer(async (request, response) => {
    try {
      validateLocalRequest(request);
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url);
      } else if (request.method === 'GET' || request.method === 'HEAD') {
        await serveStatic(request, response, resolvedStaticDir, url.pathname);
        if (request.method === 'HEAD') response.end();
      } else {
        throw new HttpError(405, 'This method is not allowed.');
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof Error ? error.message : 'Unexpected local service error.';
      sendJson(response, status, { error: message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    server,
    db,
    port: server.address().port,
    backupDir,
    async close() {
      sessions.clear();
      await new Promise((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
      closeRestaurantDatabase(db);
    },
  };
}
