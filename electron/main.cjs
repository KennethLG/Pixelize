// Desktop shell: opens the same single-file page the build makes for the web
// (dist/desktop/index.html), so the app itself needs no Electron-specific code.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', 'dist', 'desktop', 'index.html');

// Remember the last folder a file was saved to, for the next save dialog.
let lastSaveDir = app.getPath('pictures');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#14121a',
    title: 'Pixelize',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  // Downloads (<a download>) open a native save dialog.
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(lastSaveDir, item.getFilename()) });
    item.once('done', (_ev, state) => {
      if (state === 'completed') lastSaveDir = path.dirname(item.getSavePath());
    });
  });

  // Links open in the system browser; the window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });

  win.loadFile(PAGE);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
