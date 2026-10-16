import { access } from 'node:fs/promises';
import path from 'node:path';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function startElectronPos({
  app,
  BrowserWindow,
  dialog,
  createPosHttpService,
  appRoot,
  env = process.env,
  platform = process.platform,
}) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return { ready: Promise.resolve(), shutdown: async () => {} };
  }

  let service = null;
  let mainWindow = null;
  let quitAllowed = false;
  let shutdownPromise = null;

  const closeService = async () => {
    if (!service) return;
    const runningService = service;
    service = null;
    await runningService.close();
  };

  const focusMainWindow = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized?.()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const openWindow = async () => {
    if (mainWindow) {
      focusMainWindow();
      return mainWindow;
    }
    if (!service) {
      throw new Error('The local POS service must be ready before opening the register.');
    }

    const window = new BrowserWindow({
      width: 1440,
      height: 960,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    mainWindow = window;
    window.once('closed', () => {
      if (mainWindow === window) mainWindow = null;
    });

    await window.loadURL(`http://127.0.0.1:${service.port}/`);
    if (mainWindow === window) window.show();
    return window;
  };

  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      try {
        await closeService();
      } catch (error) {
        dialog.showErrorBox('Restaurant POS shutdown error', errorMessage(error));
      } finally {
        quitAllowed = true;
        app.quit();
      }
    })();
    return shutdownPromise;
  };

  const handleStartupFailure = async (error) => {
    let message = errorMessage(error);
    try {
      await closeService();
    } catch (cleanupError) {
      message += `\n\nThe local service also reported a shutdown error: ${errorMessage(cleanupError)}`;
    }
    if (quitAllowed) return;
    quitAllowed = true;
    dialog.showErrorBox('Restaurant POS could not start', message);
    app.quit();
  };

  app.on('second-instance', focusMainWindow);
  app.on('window-all-closed', () => {
    if (platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (mainWindow) {
      focusMainWindow();
    } else if (service && !quitAllowed) {
      void openWindow().catch(handleStartupFailure);
    }
  });
  app.on('before-quit', (event) => {
    if (quitAllowed) return;
    if (!service) {
      quitAllowed = true;
      return;
    }
    event.preventDefault();
    void shutdown();
  });

  const ready = Promise.resolve()
    .then(() => app.whenReady())
    .then(async () => {
      if (quitAllowed) return;
      const dataDir = env.POS_DATA_DIR
        || (env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'JuniperPOS') : null);
      if (!dataDir) {
        throw new Error('Set LOCALAPPDATA or POS_DATA_DIR before starting the desktop POS.');
      }

      const staticDir = path.join(appRoot, 'dist', 'public');
      await access(path.join(staticDir, 'index.html'));
      service = await createPosHttpService({ dataDir, staticDir, port: 0 });
      if (quitAllowed) {
        await closeService();
        return;
      }
      await openWindow();
    })
    .catch(handleStartupFailure);

  return {
    ready,
    shutdown,
    get service() {
      return service;
    },
    get window() {
      return mainWindow;
    },
  };
}
