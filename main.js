const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const os = require('os');

app.commandLine.appendSwitch('touch-events', 'enabled');

let mainWindow = null;
const txSocket = dgram.createSocket('udp4');
let rxSocket = null;
let currentRxPort = null;

txSocket.on('error', (err) => {
  console.error('Error en socket UDP TX:', err.message);
});

// --- Codificador binario OSC 1.0 ---
function encodeOscString(str) {
  const strBuf = Buffer.from(String(str), 'utf8');
  const padLength = 4 - (strBuf.length % 4);
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

// --- Decodificador ligero OSC 1.0 (Soporta mensajes simples y #bundle de REAPER) ---
function readOscString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const text = buf.toString('utf8', offset, end);
  const nextOffset = (end + 4) & ~3;
  return { text, nextOffset };
}

function parseOscPackets(buf, out = []) {
  if (!buf || buf.length < 4) return out;

  if (buf.length >= 16 && buf.toString('utf8', 0, 7) === '#bundle') {
    let offset = 16;
    while (offset + 4 <= buf.length) {
      const size = buf.readInt32BE(offset);
      offset += 4;
      if (size <= 0 || offset + size > buf.length) break;
      parseOscPackets(buf.subarray(offset, offset + size), out);
      offset += size;
    }
    return out;
  }

  if (buf[0] !== 0x2f) return out; // Debe iniciar con '/'

  const addr = readOscString(buf, 0);
  if (addr.nextOffset >= buf.length) {
    out.push({ address: addr.text, args: [] });
    return out;
  }

  const tags = readOscString(buf, addr.nextOffset);
  let offset = tags.nextOffset;
  const args = [];

  if (tags.text.startsWith(',')) {
    for (let i = 1; i < tags.text.length; i++) {
      const t = tags.text[i];
      if (t === 'f' && offset + 4 <= buf.length) {
        args.push(buf.readFloatBE(offset));
        offset += 4;
      } else if (t === 'i' && offset + 4 <= buf.length) {
        args.push(buf.readInt32BE(offset));
        offset += 4;
      } else if (t === 's' && offset < buf.length) {
        const s = readOscString(buf, offset);
        args.push(s.text);
        offset = s.nextOffset;
      } else if (t === 'T') {
        args.push(1);
      } else if (t === 'F') {
        args.push(0);
      }
    }
  }

  out.push({ address: addr.text, args });
  return out;
}

function closeRxSocket() {
  if (rxSocket) {
    try { rxSocket.close(); } catch (_) {}
    rxSocket = null;
    currentRxPort = null;
  }
}

function setupRxSocket(enabled, port) {
  const numPort = Number(port) || 9000;
  if (!enabled) {
    closeRxSocket();
    return { ok: true, listening: false };
  }
  if (rxSocket && currentRxPort === numPort) {
    return { ok: true, listening: true, port: numPort };
  }

  closeRxSocket();
  try {
    rxSocket = dgram.createSocket('udp4');
    rxSocket.on('error', (err) => {
      console.error('Error en socket UDP RX:', err.message);
      closeRxSocket();
    });
    rxSocket.on('message', (msg) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        const packets = parseOscPackets(msg);
        if (packets.length) {
          mainWindow.webContents.send('osc:rx', packets);
        }
      } catch (_) {}
    });
    rxSocket.bind(numPort);
    currentRxPort = numPort;
    return { ok: true, listening: true, port: numPort };
  } catch (err) {
    closeRxSocket();
    return { ok: false, error: err.message };
  }
}

function getDataFilePath() {
  return path.join(app.getPath('userData'), 'yoga-osc-scenes.json');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 800,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#090c12',
    icon: path.join(__dirname, 'src', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.on('osc:send', (_event, payload) => {
  try {
    const { host, port, address, args } = payload;
    if (!host || !port || !address) return;
    const packet = buildOscPacket(address, args);
    txSocket.send(packet, Number(port), host);
  } catch (err) {
    console.error('Fallo enviando paquete OSC:', err.message);
  }
});

ipcMain.handle('osc:configure-rx', (_event, { enabled, port }) => {
  return setupRxSocket(Boolean(enabled), port);
});

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

// 2. Al final de main.js, reemplaza app.whenReady().then(createWindow); por esto:
app.whenReady().then(() => {
  // Autorizar acceso nativo a puertos USB y Bluetooth MIDI (Web MIDI API) en Windows
  const allowedPermissions = new Set(['midi', 'midiSysex']);
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission);
  });
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });

  createWindow();
});

app.on('window-all-closed', () => {
  try { txSocket.close(); } catch (_) {}
  closeRxSocket();
  if (process.platform !== 'darwin') app.quit();
});