// Electron main process. This is a .cjs file (rather than the project's
// default ESM) for the same reason as bin/app.cjs: Electron's main process
// loads this file with require(), and require() cannot load a native ES
// module. The .cjs extension exempts it from package.json's
// "type": "module", so require() works, and it reaches the real ESM
// dashboard code via dynamic import().
const { app, BrowserWindow, Menu, shell, nativeImage } = require('electron');
const path = require('node:path');

const APP_NAME = 'Syndicate Marketing Site Audit';
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.png');

// Set as early as possible (before app is ready) so the Dock/menu-bar name
// and the userData directory (~/Library/Application Support/<name>) are
// correct from the start, including in unpackaged dev runs.
app.setName(APP_NAME);

let mainWindow = null;
let httpServer = null;

async function createWindow() {
  const { startDashboard } = await import('../src/startDashboard.js');
  const userDataDir = app.getPath('userData');

  httpServer = await startDashboard({
    port: 0, // let the OS pick a free local port
    host: '127.0.0.1',
    reportsDir: path.join(userDataDir, 'reports'),
    dataFile: path.join(userDataDir, 'jobs.json'),
    concurrency: 1,
    token: null, // single local user — no login needed
    // This is a trusted, single-user desktop app bound to localhost only,
    // not a server exposed to other people — so unlike the web dashboard,
    // it's safe (and useful, e.g. auditing a local dev server) to allow
    // auditing private/loopback addresses by default.
    allowPrivateTargets: true
  });

  const { port } = httpServer.address();

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Links that open in a new tab (report pages link out to external
  // helpUrl/spec references) should go to the user's real browser, not
  // spawn another app window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  // Packaged builds get the branded icon from electron-builder's
  // mac.icon (build/icon.icns) automatically; this only matters for
  // unpackaged dev runs (`npm run electron`), which otherwise show the
  // default Electron icon in the Dock.
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(ICON_PATH));
  }

  buildMenu();
  try {
    await createWindow();
  } catch (error) {
    console.error(`Failed to start ${APP_NAME}:`, error);
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (httpServer) httpServer.close();
});
