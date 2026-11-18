const { app, BrowserWindow, Menu, net, protocol } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const DIST = path.join(__dirname, 'dist');

// Protocole interne « app:// » : le jeu charge ses textures avec fetch(), ce que file:// ne permet pas.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    backgroundColor: '#07120d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  window.loadURL('app://game/index.html');
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    // Refuse tout chemin qui sortirait du dossier du jeu.
    if (!file.startsWith(DIST + path.sep)) return new Response('Introuvable', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());
