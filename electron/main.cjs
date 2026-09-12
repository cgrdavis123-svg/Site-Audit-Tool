// Electron main process. This is a .cjs file (rather than the project's
// default ESM) for the same reason as bin/app.cjs: Electron's main process
// loads this file with require(), and require() cannot load a native ES
// module. The .cjs extension exempts it from package.json's
// "type": "module", so require() works, and it reaches the real ESM
// dashboard code via dynamic import().
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

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
    title: 'Site Audit Tool',
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
  buildMenu();
  try {
    await createWindow();
  } catch (error) {
    console.error('Failed to start Site Audit Tool:', error);
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
