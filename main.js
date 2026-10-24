const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const os = require('os');

// Forzar soporte de eventos táctiles en Windows 11
app.commandLine.appendSwitch('touch-events', 'enabled');

let mainWindow = null;
const udpSocket = dgram.createSocket('udp4');

udpSocket.on('error', (err) => {
  console.error('Error en socket UDP:', err.message);
});

// --- Codificador binario OSC 1.0 puro (Cero dependencias externas) ---
function encodeOscString(str) {
  const strBuf = Buffer.from(String(str), 'utf8');
  const padLength = 4 - (strBuf.length % 4); // Siempre entre 1 y 4 bytes nulos
  return Buffer.concat([strBuf, Buffer.alloc(padLength, 0)]);
}

function buildOscPacket(address, args = []) {
  const addrBuf = encodeOscString(address);
  let typeTags = ',';
  const argBuffers = [];

  for (const arg of args) {
    if (arg.type === 'i') {
      typeTags += 'i';
      const b = Buffer.alloc(4);
      b.writeInt32BE(Math.round(Number(arg.value) || 0), 0);
      argBuffers.push(b);
    } else if (arg.type === 'f') {
      typeTags += 'f';
      const b = Buffer.alloc(4);
      b.writeFloatBE(Number(arg.value) || 0, 0);
      argBuffers.push(b);
    } else if (arg.type === 's') {
      typeTags += 's';
      argBuffers.push(encodeOscString(arg.value ?? ''));
    }
  }

  const tagBuf = encodeOscString(typeTags);
  return Buffer.concat([addrBuf, tagBuf, ...argBuffers]);
}

function getDataFilePath() {
  return path.join(app.getPath('userData'), 'yoga-osc-scenes.json');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 1200,
    minHeight: 550,
    backgroundColor: '#090c12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// Envío OSC de baja latencia (Fire-and-forget IPC)
ipcMain.on('osc:send', (_event, payload) => {
  try {
    const { host, port, address, args } = payload;
    if (!host || !port || !address) return;
    const packet = buildOscPacket(address, args);
    udpSocket.send(packet, Number(port), host);
  } catch (err) {
    console.error('Fallo enviando paquete OSC:', err.message);
  }
});

// Persistencia de escenas y configuración
ipcMain.handle('config:load', async () => {
  try {
    const file = getDataFilePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (err) {
    console.error('Error leyendo escenas:', err);
  }
  return null;
});

ipcMain.handle('config:save', async (_event, data) => {
  try {
    fs.writeFileSync(getDataFilePath(), JSON.stringify(data, null, 2), 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('config:export', async (_event, jsonString) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar Escenas OSC',
    defaultPath: 'mis-escenas-osc.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, jsonString, 'utf8');
  return { ok: true };
});

ipcMain.handle('config:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar Escenas OSC',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (canceled || !filePaths.length) return null;
  return fs.readFileSync(filePaths[0], 'utf8');
});

ipcMain.handle('app:toggle-fullscreen', () => {
  if (!mainWindow) return false;
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  return next;
});

ipcMain.handle('app:get-ips', () => {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(`${name}: ${net.address}`);
      }
    }
  }
  return results;
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  try { udpSocket.close(); } catch (_) {}
  if (process.platform !== 'darwin') app.quit();
});