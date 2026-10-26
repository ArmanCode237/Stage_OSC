import { state, $, scheduleSave } from './state.js';

let midiAccess = null;
let activeOutput = null;

export function isWebMidiSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
}

export function getMidiOutputs() {
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

export function syncSelectedMidiOutput() {
  if (!midiAccess) {
    activeOutput = null;
    return null;
  }

  const { outputId, outputName } = state.config.midi;
  let found = outputId ? midiAccess.outputs.get(outputId) : null;

  // Reconexión inteligente por nombre si Windows o Android asignó un nuevo ID al reenchufar USB/BT
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
  if (!isWebMidiSupported()) return false;
  if (midiAccess) {
    syncSelectedMidiOutput();
    return true;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    midiAccess.onstatechange = () => {
      syncSelectedMidiOutput();
      if (!$('modal-midi')?.classList.contains('hidden')) {
        renderMidiPortOptions();
      }
    };
    syncSelectedMidiOutput();
    return true;
  } catch (err) {
    console.warn('Web MIDI no disponible:', err.message);
    return false;
  }
}

function sendBytes(bytes) {
  if (!activeOutput) syncSelectedMidiOutput();
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
    if (!activeOutput && !syncSelectedMidiOutput()) return;
    for (let ch = 0; ch < 16; ch++) {
      sendBytes([0xB0 | ch, 64, 0]);  // Sustain Off
      sendBytes([0xB0 | ch, 123, 0]); // All Notes Off
    }
  }
};

// --- Interfaz del Modal de Puertos MIDI ---
export function renderMidiPortOptions() {
  const selectEl = $('midi-output-select');
  const statusEl = $('midi-hw-status');
  if (!selectEl || !statusEl) return;

  if (!isWebMidiSupported()) {
    selectEl.innerHTML = '<option value="">Web MIDI no soportado en este entorno</option>';
    statusEl.textContent = 'Estado: Sin soporte Web MIDI';
    return;
  }

  const outputs = getMidiOutputs();
  const currentId = activeOutput?.id || state.config.midi.outputId || '';

  if (!outputs.length) {
    selectEl.innerHTML = '<option value="">— Ningún dispositivo USB / Bluetooth detectado —</option>';
    statusEl.textContent = 'Conecta una interfaz USB-C, teclado o adaptador Bluetooth MIDI.';
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
    ? `✓ Conectado a: ${activeOutput.name}`
    : `${outputs.length} puerto(s) MIDI disponible(s).`;
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

  $('btn-save-midi').onclick = () => {
    const sel = $('midi-output-select');
    const chosenId = sel.value;
    const outputs = getMidiOutputs();
    const chosenObj = outputs.find((o) => o.id === chosenId);

    state.config.midi.transport = $('midi-transport-mode').value || 'udp';
    state.config.midi.outputId = chosenId;
    state.config.midi.outputName = chosenObj ? chosenObj.name : '';

    syncSelectedMidiOutput();
    closeMidi();
    scheduleSave();
  };

  $('btn-test-midi').onclick = () => {
    const sel = $('midi-output-select');
    if (sel.value) {
      state.config.midi.outputId = sel.value;
      syncSelectedMidiOutput();
    }
    const ok = hwMidi.sendCC(1, 1, 100);
    onFlashMonitor?.(ok ? 'USB/BT Ch1 CC1 → 100' : 'Sin puerto MIDI activo');
  };
}