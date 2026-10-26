import { state, $, scheduleSave } from './state.js';

const getNativeMidi = () => window.Capacitor?.Plugins?.StageOscMidi || null;
const isNativeAndroidMidi = () => Boolean(getNativeMidi());

let midiAccess = null;
let activeOutput = null;
let nativePortsCache = [];
let nativeBleAdvertising = false;
let nativeListenersBound = false;

export function isWebMidiSupported() {
  return isNativeAndroidMidi() || (typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function');
}

export function getMidiOutputs() {
  if (isNativeAndroidMidi()) {
    return nativePortsCache;
  }
  if (!midiAccess) return [];
  const list = [];
  for (const output of midiAccess.outputs.values()) {
    if (output.state === 'connected') {
      list.push({
        id: output.id,
        name: output.name || `Puerto MIDI (${output.id})`,
        manufacturer: output.manufacturer || ''
      });
    }
  }
  return list;
}

export async function syncSelectedMidiOutput() {
  // --- Ruta Nativa Android (USB-C MidiManager) ---
  if (isNativeAndroidMidi()) {
    const plugin = getNativeMidi();
    const status = await plugin.getStatus();
    nativePortsCache = status?.ports || [];
    nativeBleAdvertising = Boolean(status?.bleAdvertising);

    let targetId = state.config.midi.outputId || '';
    const savedName = state.config.midi.outputName || '';

    let match = nativePortsCache.find((p) => p.id === targetId);
    if (!match && savedName) {
      match = nativePortsCache.find((p) => p.name === savedName);
    }
    // Si el usuario acaba de activar el modo USB MIDI hacia PC, seleccionarlo automáticamente
    if (!match) {
      match = nativePortsCache.find((p) => p.isUsbPeripheral);
    }

    if (match) {
      state.config.midi.outputId = match.id;
      state.config.midi.outputName = match.name;
      await plugin.selectPort({ portId: match.id });
      activeOutput = match;
    } else {
      activeOutput = null;
    }
    return activeOutput;
  }

  // --- Ruta Escritorio Windows (Web MIDI API) ---
  if (!midiAccess) {
    activeOutput = null;
    return null;
  }

  const { outputId, outputName } = state.config.midi;
  let found = outputId ? midiAccess.outputs.get(outputId) : null;

  if ((!found || found.state !== 'connected') && outputName) {
    for (const out of midiAccess.outputs.values()) {
      if (out.state === 'connected' && out.name === outputName) {
        found = out;
        state.config.midi.outputId = out.id;
        break;
      }
    }
  }

  activeOutput = found && found.state === 'connected' ? found : null;
  return activeOutput;
}

export async function initWebMidi() {
  if (isNativeAndroidMidi()) {
    const plugin = getNativeMidi();
    if (!nativeListenersBound) {
      nativeListenersBound = true;
      await plugin.removeAllListeners();

      plugin.addListener('midiPortsChanged', async (ev) => {
        nativePortsCache = ev?.ports || [];
        await syncSelectedMidiOutput();
        if (!$('modal-midi')?.classList.contains('hidden')) {
          renderMidiPortOptions();
        }
      });

      plugin.addListener('bleStatusChanged', (ev) => {
        nativeBleAdvertising = Boolean(ev?.advertising);
        updateBleStatusUI(ev?.message);
      });
    }

    await syncSelectedMidiOutput();
    if (state.config.midi.blePeripheral && !nativeBleAdvertising) {
      try {
        await plugin.setBlePeripheral({ enabled: true });
        nativeBleAdvertising = true;
      } catch (_) {}
    }
    return true;
  }

  if (!isWebMidiSupported()) return false;
  if (midiAccess) {
    await syncSelectedMidiOutput();
    return true;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = async () => {
      await syncSelectedMidiOutput();
      if (!$('modal-midi')?.classList.contains('hidden')) {
        renderMidiPortOptions();
      }
    };
    await syncSelectedMidiOutput();
    return true;
  } catch (err) {
    console.warn('Web MIDI no disponible:', err.message);
    return false;
  }
}

function sendBytes(bytes) {
  if (isNativeAndroidMidi()) {
    if (!activeOutput && !nativeBleAdvertising) return false;
    getNativeMidi().send({ bytes });
    return true;
  }

  if (!activeOutput) return false;
  try {
    activeOutput.send(bytes);
    return true;
  } catch (err) {
    console.warn('Error enviando MIDI directo:', err.message);
    return false;
  }
}

export const hwMidi = {
  sendCC(channel, cc, value) {
    const ch = Math.max(0, Math.min(15, (Number(channel) || 1) - 1));
    return sendBytes([0xB0 | ch, cc & 0x7F, value & 0x7F]);
  },

  sendNote(channel, note, velocity) {
    const ch = Math.max(0, Math.min(15, (Number(channel) || 1) - 1));
    const v = velocity & 0x7F;
    if (v === 0) {
      return sendBytes([0x80 | ch, note & 0x7F, 0]);
    }
    return sendBytes([0x90 | ch, note & 0x7F, v]);
  },

  sendProgram(channel, program) {
    const ch = Math.max(0, Math.min(15, (Number(channel) || 1) - 1));
    return sendBytes([0xC0 | ch, program & 0x7F]);
  },

  sendPitchBend(channel, val14Bit) {
    const ch = Math.max(0, Math.min(15, (Number(channel) || 1) - 1));
    const clamped = Math.max(0, Math.min(16383, Math.round(val14Bit)));
    const lsb = clamped & 0x7F;
    const msb = (clamped >> 7) & 0x7F;
    return sendBytes([0xE0 | ch, lsb, msb]);
  },

  sendPanic() {
    for (let ch = 0; ch < 16; ch++) {
      sendBytes([0xB0 | ch, 64, 0]);
      sendBytes([0xB0 | ch, 123, 0]);
    }
  }
};

function updateBleStatusUI(customMsg = '') {
  const box = $('android-ble-box');
  const hint = $('android-usb-hint');
  if (!box) return;

  const isAndroid = isNativeAndroidMidi();
  box.classList.toggle('hidden', !isAndroid);
  hint?.classList.toggle('hidden', !isAndroid);
  if (!isAndroid) return;

  const btn = $('btn-toggle-ble');
  const statusTxt = $('ble-peripheral-status');

  btn.textContent = nativeBleAdvertising ? '✓ BT MIDI Activo' : 'Activar BT MIDI';
  btn.classList.toggle('btn-ble-on', nativeBleAdvertising);

  if (customMsg) {
    statusTxt.textContent = customMsg;
  } else {
    statusTxt.textContent = nativeBleAdvertising
      ? 'Visible como controlador Bluetooth MIDI para tu laptop.'
      : 'Convierte este dispositivo en un controlador MIDI inalámbrico detectable por tu laptop.';
  }
}

export function renderMidiPortOptions() {
  const selectEl = $('midi-output-select');
  const statusEl = $('midi-hw-status');
  if (!selectEl || !statusEl) return;

  updateBleStatusUI();

  if (!isWebMidiSupported()) {
    selectEl.innerHTML = '<option value="">MIDI directo no soportado en este entorno</option>';
    statusEl.textContent = 'Estado: Sin soporte MIDI';
    return;
  }

  const outputs = getMidiOutputs();
  const currentId = activeOutput?.id || state.config.midi.outputId || '';

  if (!outputs.length) {
    selectEl.innerHTML = '<option value="">— Ningún puerto USB MIDI activo —</option>';
    statusEl.textContent = isNativeAndroidMidi()
      ? 'Sin puerto USB MIDI activo (puedes usar Bluetooth MIDI arriba o conectar cable USB en modo MIDI).'
      : 'Conecta una interfaz USB, teclado o puerto virtual (ej. loopMIDI).';
    return;
  }

  selectEl.innerHTML = [
    '<option value="">— Seleccionar puerto de salida MIDI —</option>',
    ...outputs.map((o) => {
      const mfg = o.manufacturer ? ` [${o.manufacturer}]` : '';
      return `<option value="${o.id}" ${o.id === currentId ? 'selected' : ''}>${o.name}${mfg}</option>`;
    })
  ].join('');

  statusEl.textContent = activeOutput
    ? `✓ Puerto activo: ${activeOutput.name}`
    : `${outputs.length} puerto(s) detectado(s). Selecciona uno y pulsa Guardar.`;
}

export async function openMidiModal() {
  await initWebMidi();
  $('midi-transport-mode').value = state.config.midi.transport || 'udp';
  renderMidiPortOptions();
  $('modal-midi').classList.remove('hidden');
}

export function bindMidiModalEvents(onFlashMonitor) {
  const closeMidi = () => $('modal-midi').classList.add('hidden');

  $('btn-close-midi').onclick = closeMidi;
  $('btn-x-midi').onclick = closeMidi;

  $('btn-refresh-midi').onclick = async () => {
    await initWebMidi();
    renderMidiPortOptions();
  };

  $('btn-toggle-ble').onclick = async () => {
    const plugin = getNativeMidi();
    if (!plugin) return;
    const nextState = !nativeBleAdvertising;
    try {
      const res = await plugin.setBlePeripheral({ enabled: nextState });
      nativeBleAdvertising = Boolean(res?.advertising);
      state.config.midi.blePeripheral = nativeBleAdvertising;

      // Si activa Bluetooth MIDI y el transporte seguía en solo UDP, cambiar a Simultáneo/MIDI automáticamente
      if (nativeBleAdvertising && $('midi-transport-mode').value === 'udp') {
        $('midi-transport-mode').value = 'midi';
        state.config.midi.transport = 'midi';
      }
      updateBleStatusUI();
      scheduleSave();
    } catch (err) {
      updateBleStatusUI(`⚠ ${err?.message || 'No se pudo activar Bluetooth MIDI'}`);
    }
  };

  $('btn-save-midi').onclick = async () => {
    const sel = $('midi-output-select');
    const chosenId = sel.value;
    const outputs = getMidiOutputs();
    const chosenObj = outputs.find((o) => o.id === chosenId);

    let chosenTransport = $('midi-transport-mode').value || 'udp';
    // Si seleccionó un puerto USB o tiene BLE activo pero dejó UDP por descuido, conservar elección explícita del usuario
    state.config.midi.transport = chosenTransport;
    state.config.midi.outputId = chosenId;
    state.config.midi.outputName = chosenObj ? chosenObj.name : '';

    if (isNativeAndroidMidi()) {
      await getNativeMidi().selectPort({ portId: chosenId });
    }
    await syncSelectedMidiOutput();
    closeMidi();
    scheduleSave();
  };

  $('btn-test-midi').onclick = async () => {
    const sel = $('midi-output-select');
    if (sel.value) {
      state.config.midi.outputId = sel.value;
      if (isNativeAndroidMidi()) {
        await getNativeMidi().selectPort({ portId: sel.value });
      }
      await syncSelectedMidiOutput();
    }
    const ok = hwMidi.sendCC(1, 1, 100);
    onFlashMonitor?.(ok ? 'MIDI Directo Ch1 CC1 → 100' : 'Activa BT MIDI o elige puerto USB');
  };
}