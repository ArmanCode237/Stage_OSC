const SWATCH_COLORS = ['#00e5ff', '#a855f7', '#10b981', '#f59e0b', '#f43f5e', '#3b82f6', '#f8fafc'];

const CC_NAMES = {
  0: 'Bank Select', 1: 'Modulation', 2: 'Breath', 4: 'Foot Ctrl', 5: 'Portamento Time',
  7: 'Volume', 8: 'Balance', 10: 'Pan', 11: 'Expression', 64: 'Sustain',
  65: 'Portamento', 71: 'Resonance', 72: 'Release', 73: 'Attack',
  74: 'Cutoff', 91: 'Reverb', 93: 'Chorus', 120: 'All Sound Off', 123: 'All Notes Off'
};
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiNoteToName(n) {
  const octave = Math.floor(n / 12) - 1;
  return `${NOTE_NAMES[n % 12]}${octave}`;
}
function uid() {
  return 'w_' + Math.random().toString(36).slice(2, 9);
}

function createDefaultConfig() {
  return {
    network: { host: '192.168.1.50', port: 8000 },
    activeSceneId: 'scene_default',
    scenes: [{
      id: 'scene_default',
      name: 'Live Rig Principal',
      activePageIndex: 0,
      pages: [{
        id: uid(),
        name: 'Página 1: Capas & Mix',
        widgets: [
          { id: uid(), type: 'fader', label: 'Piano Vol', x: 40, y: 40, w: 95, h: 340, color: '#00e5ff', glow: 'neon', style: 'glass', showTicks: true, showValue: true, spring: false, msgType: 'cc', channel: 1, midiNum: 7, noteBehavior: 'latch', oscAddress: '/track/1/volume', oscType: 'f', min: 0, max: 127, normValue: 0.8 },
          { id: uid(), type: 'toggle', label: 'Piano Layer', onLabel: 'ACTIVO', offLabel: 'MUTE', x: 40, y: 395, w: 95, h: 105, color: '#00e5ff', glow: 'neon', style: 'glass', showTicks: false, showValue: false, spring: false, msgType: 'cc', channel: 1, midiNum: 20, noteBehavior: 'latch', oscAddress: '/track/1/mute', oscType: 'f', min: 0, max: 127, normValue: 1 },
          { id: uid(), type: 'fader', label: 'Pad Layer', x: 155, y: 40, w: 95, h: 340, color: '#a855f7', glow: 'neon', style: 'glass', showTicks: true, showValue: true, spring: false, msgType: 'cc', channel: 1, midiNum: 11, noteBehavior: 'latch', oscAddress: '/track/2/volume', oscType: 'f', min: 0, max: 127, normValue: 0.65 },
          { id: uid(), type: 'toggle', label: 'Pad Layer', onLabel: 'ACTIVO', offLabel: 'MUTE', x: 155, y: 395, w: 95, h: 105, color: '#a855f7', glow: 'neon', style: 'glass', showTicks: false, showValue: false, spring: false, msgType: 'cc', channel: 1, midiNum: 21, noteBehavior: 'latch', oscAddress: '/track/2/mute', oscType: 'f', min: 0, max: 127, normValue: 1 },
          { id: uid(), type: 'knob', label: 'Cutoff', x: 280, y: 40, w: 145, h: 170, color: '#00e5ff', glow: 'neon', style: 'glass', showTicks: true, showValue: true, spring: false, msgType: 'cc', channel: 1, midiNum: 74, noteBehavior: 'latch', oscAddress: '/fx/1', oscType: 'f', min: 0, max: 127, normValue: 0.55 },
          { id: uid(), type: 'knob', label: 'Resonance', x: 440, y: 40, w: 145, h: 170, color: '#a855f7', glow: 'soft', style: 'glass', showTicks: true, showValue: true, spring: false, msgType: 'cc', channel: 1, midiNum: 71, noteBehavior: 'latch', oscAddress: '/fx/2', oscType: 'f', min: 0, max: 127, normValue: 0.25 }
        ]
      }]
    }]
  };
}

const state = {
  config: null,
  editMode: false,
  snapToGrid: true,
  selectedWidgetId: null,
  activePointers: new Map(),
  saveTimer: null,
  ledTimer: null,
  inspectorOpen: false
};

const $ = (id) => document.getElementById(id);

function getActiveScene() {
  return state.config.scenes.find((s) => s.id === state.config.activeSceneId) || state.config.scenes[0];
}
function getActivePage() {
  const scene = getActiveScene();
  if (!scene.pages.length) {
    scene.pages.push({ id: uid(), name: 'Página 1', widgets: [] });
  }
  const idx = Math.min(Math.max(0, scene.activePageIndex || 0), scene.pages.length - 1);
  scene.activePageIndex = idx;
  return scene.pages[idx];
}
function getSelectedWidget() {
  return getActivePage().widgets.find((w) => w.id === state.selectedWidgetId) || null;
}
function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    window.oscAPI.saveConfig(state.config);
  }, 300);
}

// ===== DIÁLOGO GENÉRICO =====
function showDialog({ title, defaultValue = '', isPrompt = true, message = '' }) {
  return new Promise((resolve) => {
    const modal = $('modal-dialog');
    const input = $('dialog-input');
    const msgEl = $('dialog-message');
    $('dialog-title').textContent = title;
    if (isPrompt) {
      input.classList.remove('hidden');
      msgEl.classList.add('hidden');
      input.value = defaultValue;
    } else {
      input.classList.add('hidden');
      msgEl.classList.remove('hidden');
      msgEl.textContent = message;
    }
    modal.classList.remove('hidden');
    if (isPrompt) setTimeout(() => input.focus(), 40);

    const cleanup = (result) => {
      modal.classList.add('hidden');
      $('dialog-ok').onclick = null;
      $('dialog-cancel').onclick = null;
      input.onkeydown = null;
      resolve(result);
    };
    $('dialog-ok').onclick = () => cleanup(isPrompt ? input.value.trim() : true);
    $('dialog-cancel').onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(input.value.trim());
      if (e.key === 'Escape') cleanup(null);
    };
  });
}

// ===== MONITOR TX =====
function flashTxMonitor(label) {
  $('tx-text').textContent = label;
  const led = $('tx-led');
  led.classList.add('active');
  clearTimeout(state.ledTimer);
  state.ledTimer = setTimeout(() => led.classList.remove('active'), 150);
}

function sendOscRaw(address, args, monitorLabel) {
  const { host, port } = state.config.network;
  window.oscAPI.sendOSC({ host, port, address, args });
  flashTxMonitor(monitorLabel || address);
}

function computeScaledInt(widget, norm = widget.normValue) {
  const raw = widget.min + norm * (widget.max - widget.min);
  const limit = widget.msgType === 'pitch' ? 16383 : 127;
  return Math.max(0, Math.min(limit, Math.round(raw)));
}

// ===== RUTEO MIDI / OSC =====
function dispatchWidgetMessage(widget, phase = 'move') {
  const chIndex = Math.max(0, Math.min(15, (Number(widget.channel) || 1) - 1));
  const valInt = computeScaledInt(widget);
  const isToggle = widget.type === 'toggle';
  const forceSend = phase === 'down' && (isToggle || widget.type === 'pad');

  if (widget.msgType === 'cc') {
    if (!forceSend && phase !== 'up' && widget._lastSent === valInt) return;
    widget._lastSent = valInt;
    const stateTag = isToggle ? (widget.normValue > 0.5 ? ' (ON)' : ' (OFF)') : '';
    sendOscRaw(
      `/vkb_midi/${chIndex}/cc/${widget.midiNum}`,
      [{ type: 'i', value: valInt }],
      `Ch${widget.channel} CC ${widget.midiNum} → ${valInt}${stateTag}`
    );
  } else if (widget.msgType === 'note') {
    if (isToggle) {
      const isOn = widget.normValue > 0.5;
      const vel = isOn ? Math.max(1, Math.min(127, Math.round(widget.max || 100))) : 0;
      widget._lastSent = vel;
      sendOscRaw(
        `/vkb_midi/${chIndex}/note/${widget.midiNum}`,
        [{ type: 'i', value: vel }],
        `Ch${widget.channel} Note ${midiNoteToName(widget.midiNum)} ${isOn ? `ON (${vel})` : 'OFF'}`
      );
      return;
    }
    const mode = widget.noteBehavior || 'latch';
    if (mode === 'latch') {
      if (!forceSend && widget._lastSent === valInt) return;
      widget._lastSent = valInt;
      sendOscRaw(
        `/vkb_midi/${chIndex}/note/${widget.midiNum}`,
        [{ type: 'i', value: valInt }],
        `Ch${widget.channel} Note ${midiNoteToName(widget.midiNum)} → ${valInt}`
      );
    } else if (mode === 'gate') {
      if (phase === 'up') {
        widget._lastSent = 0;
        sendOscRaw(
          `/vkb_midi/${chIndex}/note/${widget.midiNum}`,
          [{ type: 'i', value: 0 }],
          `Ch${widget.channel} Note ${midiNoteToName(widget.midiNum)} OFF`
        );
      } else {
        const vel = Math.max(1, valInt);
        if (phase === 'move' && widget._lastSent === vel) return;
        widget._lastSent = vel;
        sendOscRaw(
          `/vkb_midi/${chIndex}/note/${widget.midiNum}`,
          [{ type: 'i', value: vel }],
          `Ch${widget.channel} Note ${midiNoteToName(widget.midiNum)} ON (${vel})`
        );
      }
    } else if (mode === 'sweep') {
      if (phase === 'up') {
        if (widget._sweepNote != null) {
          sendOscRaw(`/vkb_midi/${chIndex}/note/${widget._sweepNote}`, [{ type: 'i', value: 0 }], 'Sweep OFF');
          widget._sweepNote = null;
        }
      } else if (valInt !== widget._sweepNote) {
        if (widget._sweepNote != null) {
          sendOscRaw(`/vkb_midi/${chIndex}/note/${widget._sweepNote}`, [{ type: 'i', value: 0 }]);
        }
        widget._sweepNote = valInt;
        sendOscRaw(
          `/vkb_midi/${chIndex}/note/${valInt}`,
          [{ type: 'i', value: 100 }],
          `Ch${widget.channel} Gliss ${midiNoteToName(valInt)}`
        );
      }
    }
  } else if (widget.msgType === 'program') {
    if (!forceSend && widget._lastSent === valInt) return;
    widget._lastSent = valInt;
    sendOscRaw(`/vkb_midi/${chIndex}/program`, [{ type: 'i', value: valInt }], `Ch${widget.channel} Prog ${valInt}`);
  } else if (widget.msgType === 'pitch') {
    if (!forceSend && widget._lastSent === valInt) return;
    widget._lastSent = valInt;
    sendOscRaw(`/vkb_midi/${chIndex}/pitch`, [{ type: 'i', value: valInt }], `Ch${widget.channel} Pitch ${valInt}`);
  } else if (widget.msgType === 'osc') {
    const addr = widget.oscAddress || '/track/1/mute';
    if (widget.oscType === 'i') {
      if (!forceSend && widget._lastSent === valInt) return;
      widget._lastSent = valInt;
      sendOscRaw(addr, [{ type: 'i', value: valInt }], `${addr} → ${valInt}`);
    } else {
      const fVal = Number(widget.normValue.toFixed(3));
      if (!forceSend && widget._lastSent === fVal) return;
      widget._lastSent = fVal;
      sendOscRaw(addr, [{ type: 'f', value: fVal }], `${addr} → ${fVal}`);
    }
  }
}

function formatWidgetReadout(widget) {
  if (widget.type === 'toggle' && widget.msgType === 'note') {
    const isOn = (widget.normValue || 0) > 0.5;
    return `${midiNoteToName(widget.midiNum)}:${isOn ? Math.max(1, widget.max || 100) : 0}`;
  }
  if (widget.msgType === 'osc' && widget.oscType === 'f') {
    return (widget.normValue || 0).toFixed(2);
  }
  const v = computeScaledInt(widget);
  if (widget.msgType === 'note' && widget.noteBehavior === 'sweep') {
    return `${v} (${midiNoteToName(v)})`;
  }
  return String(v);
}

function updateWidgetVisuals(widget, el) {
  if (!el) el = document.querySelector(`.osc-widget[data-id="${widget.id}"]`);
  if (!el) return;
  const norm = Math.max(0, Math.min(1, widget.normValue || 0));
  el.style.setProperty('--w-color', widget.color || '#00e5ff');

  let glowPx = '0px';
  if (widget.glow === 'soft') glowPx = norm > 0.02 ? `${4 + norm * 8}px` : '0px';
  if (widget.glow === 'neon') glowPx = norm > 0.02 ? `${6 + norm * 18}px` : '0px';
  el.style.setProperty('--w-glow', glowPx);

  const badge = el.querySelector('.w-badge');
  if (badge) badge.textContent = formatWidgetReadout(widget);

  if (widget.type === 'fader') {
    const pct = `${norm * 100}%`;
    const fill = el.querySelector('.fader-fill');
    const thumb = el.querySelector('.fader-thumb');
    if (fill) fill.style.height = pct;
    if (thumb) thumb.style.bottom = pct;
  } else if (widget.type === 'knob') {
    const arcLen = 179.07;
    const fillArc = el.querySelector('.knob-arc-fill');
    const pointer = el.querySelector('.knob-pointer');
    if (fillArc) fillArc.setAttribute('stroke-dasharray', `${norm * arcLen} 238.76`);
    if (pointer) {
      const angle = -135 + norm * 270;
      pointer.setAttribute('transform', `rotate(${angle} 50 50)`);
    }
  } else if (widget.type === 'toggle') {
    const isOn = norm > 0.5;
    const toggleBody = el.querySelector('.toggle-body');
    const stateText = el.querySelector('.toggle-state-text');
    if (toggleBody) toggleBody.classList.toggle('active', isOn);
    if (stateText) {
      stateText.textContent = isOn ? (widget.onLabel || 'ON') : (widget.offLabel || 'OFF');
    }
  } else if (widget.type === 'pad') {
    const padBody = el.querySelector('.pad-body');
    if (padBody) padBody.classList.toggle('active', norm > 0.01);
  }
}

// ===== BUILD WIDGET =====
function buildWidgetElement(widget) {
  const el = document.createElement('div');
  el.className = `osc-widget style-${widget.style || 'glass'}`;
  el.dataset.id = widget.id;
  el.style.left = `${widget.x}px`;
  el.style.top = `${widget.y}px`;
  el.style.width = `${widget.w}px`;
  el.style.height = `${widget.h}px`;

  const titleHtml = `<div class="w-title">${widget.label || 'Control'}</div>`;
  const badgeHtml = widget.showValue ? `<div class="w-badge">0</div>` : '';

  let bodyHtml = '';
  if (widget.type === 'fader') {
    bodyHtml = `<div class="fader-body">
      ${widget.showTicks ? '<div class="fader-ticks"></div>' : ''}
      <div class="fader-track">
        <div class="fader-fill"></div>
        <div class="fader-thumb"></div>
      </div>
    </div>`;
  } else if (widget.type === 'knob') {
    bodyHtml = `<div class="knob-body">
      <svg class="knob-svg" viewBox="0 0 100 100">
        <circle class="knob-arc-bg" cx="50" cy="50" r="38" stroke-dasharray="179.07 238.76" transform="rotate(135 50 50)" />
        <circle class="knob-arc-fill" cx="50" cy="50" r="38" stroke-dasharray="0 238.76" transform="rotate(135 50 50)" />
        <circle class="knob-cap" cx="50" cy="50" r="27" />
        <line class="knob-pointer" x1="50" y1="50" x2="50" y2="26" />
      </svg>
    </div>`;
  } else if (widget.type === 'toggle') {
    bodyHtml = `<div class="toggle-body">
      <div class="toggle-led"></div>
      <div class="toggle-switch-pill"><div class="toggle-switch-knob"></div></div>
      <div class="toggle-state-text">OFF</div>
    </div>`;
  } else {
    bodyHtml = `<div class="pad-body"></div>`;
  }

  // Botón de configuración visible en modo edición
  const cfgBtnHtml = state.editMode ? `<div class="btn-widget-config" data-cfg="1" title="Configurar">⚙</div>` : '';
  const resizeHtml = state.editMode ? `<div class="resize-handle" data-resize="1"></div>` : '';

  el.innerHTML = `${titleHtml}${bodyHtml}${badgeHtml}${cfgBtnHtml}${resizeHtml}`;
  updateWidgetVisuals(widget, el);
  attachWidgetPointerEvents(el, widget);
  return el;
}

function snapVal(v) {
  return state.snapToGrid ? Math.round(v / 20) * 20 : Math.round(v);
}

// ===== EVENTOS DE WIDGET =====
function attachWidgetPointerEvents(el, widget) {
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);

    // Modo edición
    if (state.editMode) {
      // Clic en botón de configuración
      if (e.target.dataset.cfg) {
        openInspector(widget);
        return;
      }
      const isResize = Boolean(e.target.dataset.resize);
      state.activePointers.set(e.pointerId, {
        mode: isResize ? 'resize' : 'move',
        widget,
        el,
        startX: e.clientX,
        startY: e.clientY,
        origX: widget.x,
        origY: widget.y,
        origW: widget.w,
        origH: widget.h
      });
      // Seleccionar widget
      state.selectedWidgetId = widget.id;
      document.querySelectorAll('.osc-widget').forEach(w => w.classList.remove('selected-edit'));
      el.classList.add('selected-edit');
      return;
    }

    // Modo Live
    const session = {
      mode: 'live',
      widget,
      el,
      startY: e.clientY,
      startX: e.clientX,
      startNorm: widget.normValue || 0
    };
    state.activePointers.set(e.pointerId, session);

    if (widget.type === 'fader') {
      const track = el.querySelector('.fader-track').getBoundingClientRect();
      widget.normValue = Math.max(0, Math.min(1, 1 - (e.clientY - track.top) / track.height));
      updateWidgetVisuals(widget, el);
      dispatchWidgetMessage(widget, 'down');
    } else if (widget.type === 'toggle') {
      widget.normValue = widget.normValue > 0.5 ? 0 : 1;
      updateWidgetVisuals(widget, el);
      dispatchWidgetMessage(widget, 'down');
    } else if (widget.type === 'pad') {
      if (widget.spring || (widget.msgType === 'note' && widget.noteBehavior === 'gate')) {
        widget.normValue = 1;
      } else {
        widget.normValue = widget.normValue > 0.5 ? 0 : 1;
      }
      updateWidgetVisuals(widget, el);
      dispatchWidgetMessage(widget, 'down');
    } else if (widget.type === 'knob') {
      dispatchWidgetMessage(widget, 'down');
    }
  });

  el.addEventListener('pointermove', (e) => {
    const session = state.activePointers.get(e.pointerId);
    if (!session) return;

    if (session.mode === 'move') {
      widget.x = Math.max(0, snapVal(session.origX + (e.clientX - session.startX)));
      widget.y = Math.max(0, snapVal(session.origY + (e.clientY - session.startY)));
      el.style.left = `${widget.x}px`;
      el.style.top = `${widget.y}px`;
      // Actualizar inspector si está abierto para este widget
      if (state.inspectorOpen && state.selectedWidgetId === widget.id) {
        $('inp-x').value = widget.x;
        $('inp-y').value = widget.y;
      }
    } else if (session.mode === 'resize') {
      widget.w = Math.max(60, snapVal(session.origW + (e.clientX - session.startX)));
      widget.h = Math.max(60, snapVal(session.origH + (e.clientY - session.startY)));
      el.style.width = `${widget.w}px`;
      el.style.height = `${widget.h}px`;
      if (state.inspectorOpen && state.selectedWidgetId === widget.id) {
        $('inp-w').value = widget.w;
        $('inp-h').value = widget.h;
      }
    } else if (session.mode === 'live') {
      if (widget.type === 'fader') {
        const track = el.querySelector('.fader-track').getBoundingClientRect();
        widget.normValue = Math.max(0, Math.min(1, 1 - (e.clientY - track.top) / track.height));
      } else if (widget.type === 'knob') {
        const deltaY = session.startY - e.clientY;
        widget.normValue = Math.max(0, Math.min(1, session.startNorm + deltaY / 170));
        session.startY = e.clientY;
        session.startNorm = widget.normValue;
      } else {
        return;
      }
      updateWidgetVisuals(widget, el);
      dispatchWidgetMessage(widget, 'move');
    }
  });

  const endTouch = (e) => {
    const session = state.activePointers.get(e.pointerId);
    if (!session) return;
    state.activePointers.delete(e.pointerId);

    if (session.mode === 'live') {
      if (widget.type !== 'toggle') {
        if (widget.spring) {
          widget.normValue = widget.msgType === 'pitch' ? 0.5 : 0;
          updateWidgetVisuals(widget, el);
        }
        if (widget.spring || (widget.msgType === 'note' && (widget.noteBehavior === 'gate' || widget.noteBehavior === 'sweep'))) {
          dispatchWidgetMessage(widget, 'up');
        }
      }
      scheduleSave();
    } else {
      scheduleSave();
    }
  };

  el.addEventListener('pointerup', endTouch);
  el.addEventListener('pointercancel', endTouch);
}

// ===== INSPECTOR LATERAL =====
function populateMidiPresetOptions(msgType, currentVal) {
  const presetSel = $('inp-midi-preset');
  const opts = [];
  for (let i = 0; i <= 127; i++) {
    if (msgType === 'note') {
      opts.push(`<option value="${i}" ${i === currentVal ? 'selected' : ''}>Nota ${i} — ${midiNoteToName(i)}</option>`);
    } else {
      const desc = CC_NAMES[i] ? `(${CC_NAMES[i]})` : '';
      opts.push(`<option value="${i}" ${i === currentVal ? 'selected' : ''}>CC ${i}${desc}</option>`);
    }
  }
  presetSel.innerHTML = opts.join('');
}

function openInspector(widget) {
  state.selectedWidgetId = widget.id;
  state.inspectorOpen = true;

  const isToggle = widget.type === 'toggle';
  const isPad = widget.type === 'pad';

  $('inspector-title').textContent = widget.label || 'Control';
  $('inspector-subtitle').textContent = `${widget.type.toUpperCase()} · Ch ${widget.channel || 1}`;

  $('inp-label').value = widget.label;
  $('inp-type').value = widget.type;
  $('inp-on-label').value = widget.onLabel ?? 'ON';
  $('inp-off-label').value = widget.offLabel ?? 'OFF';
  $('inp-msg-type').value = widget.msgType;
  $('inp-channel').value = widget.channel || 1;
  $('inp-midi-num').value = widget.midiNum ?? 1;
  $('inp-note-behavior').value = widget.noteBehavior || 'latch';
  $('inp-osc-address').value = widget.oscAddress || '/track/1/mute';
  $('inp-osc-type').value = widget.oscType || 'f';
  $('inp-min').value = widget.min ?? 0;
  $('inp-max').value = widget.max ?? 127;
  $('inp-color').value = widget.color || '#00e5ff';
  $('inp-glow').value = widget.glow || 'neon';
  $('inp-style').value = widget.style || 'glass';
  $('inp-show-ticks').checked = Boolean(widget.showTicks);
  $('inp-show-value').checked = Boolean(widget.showValue);
  $('inp-spring').checked = Boolean(widget.spring);
  $('inp-x').value = widget.x;
  $('inp-y').value = widget.y;
  $('inp-w').value = widget.w;
  $('inp-h').value = widget.h;

  // Visibilidad condicional
  $('group-toggle-texts').classList.toggle('hidden', !isToggle);
  $('row-show-ticks').classList.toggle('hidden', isToggle || isPad);
  $('row-spring').classList.toggle('hidden', isToggle);
  $('lbl-min-val').textContent = isToggle ? 'Valor OFF (Mín)' : 'Valor Mín';
  $('lbl-max-val').textContent = isToggle ? 'Valor ON (Máx)' : 'Valor Máx';

  const isOsc = widget.msgType === 'osc';
  const hasNum = widget.msgType === 'cc' || widget.msgType === 'note';
  $('group-midi-ch').classList.toggle('hidden', isOsc);
  $('group-midi-num').classList.toggle('hidden', !hasNum);
  $('group-note-mode').classList.toggle('hidden', widget.msgType !== 'note' || isToggle);
  $('group-osc-path').classList.toggle('hidden', !isOsc);

  if (hasNum) {
    $('lbl-midi-num').textContent = widget.msgType === 'note' ? 'Nota MIDI (0–127)' : 'Número CC (0–127)';
    populateMidiPresetOptions(widget.msgType, Number(widget.midiNum) || 0);
  }

  // Marcar widget seleccionado
  document.querySelectorAll('.osc-widget').forEach(w => w.classList.remove('selected-edit'));
  const widgetEl = document.querySelector(`.osc-widget[data-id="${widget.id}"]`);
  if (widgetEl) widgetEl.classList.add('selected-edit');

  $('inspector').classList.remove('hidden');
}

function closeInspector() {
  state.inspectorOpen = false;
  state.selectedWidgetId = null;
  $('inspector').classList.add('hidden');
  document.querySelectorAll('.osc-widget').forEach(w => w.classList.remove('selected-edit'));
}

function updateWidgetFromInspector(field, value) {
  const w = getSelectedWidget();
  if (!w) return;
  w[field] = value;
  renderAll();
  scheduleSave();
  // Actualizar subtítulo
  $('inspector-subtitle').textContent = `${w.type.toUpperCase()} · Ch ${w.channel || 1}`;
  $('inspector-title').textContent = w.label || 'Control';
}

function bindInspectorInputs() {
  const chSel = $('inp-channel');
  chSel.innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">Canal ${i + 1}</option>`).join('');

  // Swatches
  const swatchBox = $('color-swatches');
  swatchBox.innerHTML = '';
  SWATCH_COLORS.forEach((col) => {
    const s = document.createElement('div');
    s.className = 'swatch';
    s.style.background = col;
    s.onclick = () => {
      const w = getSelectedWidget();
      if (!w) return;
      w.color = col;
      $('inp-color').value = col;
      renderAll();
      scheduleSave();
    };
    swatchBox.appendChild(s);
  });

  // Listeners
  $('inp-label').oninput = (e) => updateWidgetFromInspector('label', e.target.value);
  $('inp-on-label').oninput = (e) => updateWidgetFromInspector('onLabel', e.target.value);
  $('inp-off-label').oninput = (e) => updateWidgetFromInspector('offLabel', e.target.value);

  $('inp-type').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.type = e.target.value;
    if (w.type === 'knob' && w.h > 220) { w.w = 145; w.h = 170; }
    if (w.type === 'fader' && w.h < 220) { w.w = 95; w.h = 340; }
    if (w.type === 'toggle') {
      w.spring = false;
      w.onLabel = w.onLabel || 'ON';
      w.offLabel = w.offLabel || 'OFF';
      w.normValue = w.normValue > 0.5 ? 1 : 0;
      if (w.h > 200) { w.w = 115; w.h = 110; }
    }
    if (w.type === 'pad') {
      w.msgType = 'note';
      w.noteBehavior = 'gate';
    }
    openInspector(w); // refrescar inspector
    renderAll();
    scheduleSave();
  };

  $('inp-msg-type').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.msgType = e.target.value;
    if (w.msgType === 'pitch') { w.min = 0; w.max = 16383; w.normValue = 0.5; }
    else if (w.max > 127) { w.min = 0; w.max = 127; }
    openInspector(w);
    renderAll();
    scheduleSave();
  };

  $('inp-channel').onchange = (e) => updateWidgetFromInspector('channel', Number(e.target.value));
  $('inp-midi-num').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.midiNum = Math.max(0, Math.min(127, Number(e.target.value) || 0));
    scheduleSave();
  };
  $('inp-midi-preset').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.midiNum = Number(e.target.value);
    $('inp-midi-num').value = w.midiNum;
    scheduleSave();
  };
  $('inp-note-behavior').onchange = (e) => updateWidgetFromInspector('noteBehavior', e.target.value);
  $('inp-osc-address').oninput = (e) => updateWidgetFromInspector('oscAddress', e.target.value);
  $('inp-osc-type').onchange = (e) => updateWidgetFromInspector('oscType', e.target.value);
  $('inp-min').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.min = Number(e.target.value) || 0;
    scheduleSave();
  };
  $('inp-max').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.max = Number(e.target.value) || 127;
    scheduleSave();
  };
  $('inp-color').oninput = (e) => updateWidgetFromInspector('color', e.target.value);
  $('inp-glow').onchange = (e) => updateWidgetFromInspector('glow', e.target.value);
  $('inp-style').onchange = (e) => updateWidgetFromInspector('style', e.target.value);
  $('inp-show-ticks').onchange = (e) => updateWidgetFromInspector('showTicks', e.target.checked);
  $('inp-show-value').onchange = (e) => updateWidgetFromInspector('showValue', e.target.checked);
  $('inp-spring').onchange = (e) => updateWidgetFromInspector('spring', e.target.checked);

  ['x', 'y', 'w', 'h'].forEach((k) => {
    $(`inp-${k}`).oninput = (e) => {
      const w = getSelectedWidget();
      if (!w) return;
      w[k] = Math.max(0, Number(e.target.value) || 0);
      renderAll();
      scheduleSave();
    };
  });

  $('btn-del-widget').onclick = () => {
    const w = getSelectedWidget();
    if (!w) return;
    const page = getActivePage();
    page.widgets = page.widgets.filter((x) => x.id !== w.id);
    closeInspector();
    renderAll();
    scheduleSave();
  };

  $('btn-dup-widget').onclick = () => {
    const w = getSelectedWidget();
    if (!w) return;
    const copy = JSON.parse(JSON.stringify(w));
    copy.id = uid();
    copy.x += 20;
    copy.y += 20;
    getActivePage().widgets.push(copy);
    renderAll();
    openInspector(copy);
    scheduleSave();
  };

  $('inspector-close').onclick = closeInspector;
}

// ===== CREAR WIDGET =====
function addNewWidget(type) {
  const page = getActivePage();
  const count = page.widgets.length;
  let wSize = 145, hSize = 165;
  if (type === 'fader') { wSize = 95; hSize = 340; }
  if (type === 'toggle') { wSize = 115; hSize = 110; }

  const defaultLabels = {
    fader: `Fader ${count + 1}`,
    knob: `Knob ${count + 1}`,
    toggle: `Toggle ${count + 1}`,
    pad: `Pad ${count + 1}`
  };

  const newW = {
    id: uid(),
    type,
    label: defaultLabels[type] || `Control ${count + 1}`,
    onLabel: 'ON',
    offLabel: 'OFF',
    x: 40 + ((count * 40) % 440),
    y: 40 + ((count * 30) % 200),
    w: wSize,
    h: hSize,
    color: SWATCH_COLORS[count % SWATCH_COLORS.length],
    glow: 'neon',
    style: 'glass',
    showTicks: type === 'fader' || type === 'knob',
    showValue: type !== 'toggle',
    spring: type === 'pad',
    msgType: type === 'pad' ? 'note' : 'cc',
    channel: 1,
    midiNum: type === 'pad' ? 60 : type === 'toggle' ? 64 : Math.min(127, count + 1),
    noteBehavior: type === 'pad' ? 'gate' : 'latch',
    oscAddress: type === 'toggle' ? `/track/${count + 1}/mute` : `/control/${count + 1}`,
    oscType: 'f',
    min: 0,
    max: 127,
    normValue: type === 'fader' ? 0.5 : 0
  };
  page.widgets.push(newW);
  renderAll();
  openInspector(newW);
  scheduleSave();
}

// ===== RENDER =====
function renderAll() {
  const scene = getActiveScene();
  const page = getActivePage();

  const sceneSel = $('scene-select');
  sceneSel.innerHTML = state.config.scenes
    .map((s) => `<option value="${s.id}" ${s.id === scene.id ? 'selected' : ''}>${s.name}</option>`)
    .join('');

  const tabsEl = $('page-tabs');
  tabsEl.innerHTML = '';
  scene.pages.forEach((p, idx) => {
    const btn = document.createElement('button');
    btn.className = `page-tab ${idx === scene.activePageIndex ? 'active' : ''}`;
    btn.textContent = p.name;
    btn.onclick = () => {
      scene.activePageIndex = idx;
      state.selectedWidgetId = null;
      closeInspector();
      renderAll();
      scheduleSave();
    };
    tabsEl.appendChild(btn);
  });

  $('edit-toolbar').classList.toggle('hidden', !state.editMode);
  $('canvas-area').classList.toggle('edit-grid', state.editMode);
  $('btn-toggle-edit').textContent = state.editMode ? '✓ Modo Live' : '✎ Editar UI';
  $('btn-toggle-edit').classList.toggle('editing-on', state.editMode);

  const canvas = $('canvas-area');
  canvas.innerHTML = '';
  page.widgets.forEach((w) => {
    const el = buildWidgetElement(w);
    if (state.editMode && w.id === state.selectedWidgetId) {
      el.classList.add('selected-edit');
    }
    canvas.appendChild(el);
  });

  // Si el inspector está abierto pero el widget ya no existe, cerrarlo
  if (state.inspectorOpen && !getSelectedWidget()) {
    closeInspector();
  }
}

// ===== MODAL ESCENAS =====
function renderScenesModal() {
  const list = $('scenes-list');
  list.innerHTML = '';
  state.config.scenes.forEach((sc) => {
    const row = document.createElement('div');
    row.className = `scene-item ${sc.id === state.config.activeSceneId ? 'active' : ''}`;
    row.innerHTML = `
      <div>
        <strong>${sc.name}</strong>
        <small style="color:#8a99b5;display:block;margin-top:2px;font-size:11px">${sc.pages.length} página(s)</small>
      </div>
      <div class="row-gap">
        <button class="btn-mini btn-accent" data-act="load">Cargar</button>
        <button class="btn-mini" data-act="rename">Renombrar</button>
        <button class="btn-mini" data-act="dup">Duplicar</button>
        <button class="btn-mini btn-danger" data-act="del">Borrar</button>
      </div>
    `;
    row.querySelector('[data-act="load"]').onclick = () => {
      state.config.activeSceneId = sc.id;
      state.selectedWidgetId = null;
      closeInspector();
      renderAll();
      renderScenesModal();
      scheduleSave();
    };
    row.querySelector('[data-act="rename"]').onclick = async () => {
      const name = await showDialog({ title: 'Renombrar Escena', defaultValue: sc.name });
      if (name) { sc.name = name; renderAll(); renderScenesModal(); scheduleSave(); }
    };
    row.querySelector('[data-act="dup"]').onclick = () => {
      const copy = JSON.parse(JSON.stringify(sc));
      copy.id = 'scene_' + uid();
      copy.name = `${sc.name} (Copia)`;
      state.config.scenes.push(copy);
      state.config.activeSceneId = copy.id;
      renderAll();
      renderScenesModal();
      scheduleSave();
    };
    row.querySelector('[data-act="del"]').onclick = async () => {
      if (state.config.scenes.length <= 1) return;
      const ok = await showDialog({ title: 'Eliminar Escena', isPrompt: false, message: `¿Seguro que deseas borrar "${sc.name}"?` });
      if (!ok) return;
      state.config.scenes = state.config.scenes.filter((s) => s.id !== sc.id);
      if (state.config.activeSceneId === sc.id) state.config.activeSceneId = state.config.scenes[0].id;
      renderAll();
      renderScenesModal();
      scheduleSave();
    };
    list.appendChild(row);
  });
}

// ===== INIT =====
async function init() {
  const saved = await window.oscAPI.loadConfig();
  state.config = saved && saved.scenes?.length ? saved : createDefaultConfig();

  bindInspectorInputs();

  // Cerrar menú contextual al hacer clic
  document.addEventListener('click', () => {
    $('context-menu').classList.add('hidden');
  });

  // Menú contextual (clic derecho)
  document.addEventListener('contextmenu', (e) => {
    if (!state.editMode) return;
    const widgetEl = e.target.closest('.osc-widget');
    if (!widgetEl) return;
    e.preventDefault();
    const widgetId = widgetEl.dataset.id;
    const page = getActivePage();
    const widget = page.widgets.find((w) => w.id === widgetId);
    if (!widget) return;

    state.selectedWidgetId = widget.id;
    const menu = $('context-menu');
    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 120)}px`;
    menu.classList.remove('hidden');

    $('ctx-btn-config').onclick = () => {
      menu.classList.add('hidden');
      openInspector(widget);
    };
    $('ctx-btn-dup').onclick = () => {
      menu.classList.add('hidden');
      const copy = JSON.parse(JSON.stringify(widget));
      copy.id = uid();
      copy.x += 20;
      copy.y += 20;
      page.widgets.push(copy);
      renderAll();
      openInspector(copy);
      scheduleSave();
    };
    $('ctx-btn-del').onclick = () => {
      menu.classList.add('hidden');
      page.widgets = page.widgets.filter((w) => w.id !== widget.id);
      if (state.selectedWidgetId === widget.id) closeInspector();
      renderAll();
      scheduleSave();
    };
  });

  // Soporte táctil: pulsación larga para abrir inspector
  let longPressTimer = null;
  document.addEventListener('touchstart', (e) => {
    if (!state.editMode) return;
    const widgetEl = e.target.closest('.osc-widget');
    if (!widgetEl) return;
    longPressTimer = setTimeout(() => {
      const widgetId = widgetEl.dataset.id;
      const widget = getActivePage().widgets.find((w) => w.id === widgetId);
      if (widget) openInspector(widget);
    }, 600);
  });
  document.addEventListener('touchend', () => clearTimeout(longPressTimer));
  document.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') {
      closeInspector();
      $('modal-network').classList.add('hidden');
      $('modal-scenes').classList.add('hidden');
      $('modal-dialog').classList.add('hidden');
    }
    if (e.key === 'Delete' && state.selectedWidgetId && state.editMode) {
      const page = getActivePage();
      page.widgets = page.widgets.filter((w) => w.id !== state.selectedWidgetId);
      closeInspector();
      renderAll();
      scheduleSave();
    }
    if (e.key === 'e' && e.ctrlKey) {
      e.preventDefault();
      state.editMode = !state.editMode;
      if (!state.editMode) closeInspector();
      renderAll();
    }
  });

  // Eventos UI
  $('scene-select').onchange = (e) => {
    state.config.activeSceneId = e.target.value;
    state.selectedWidgetId = null;
    closeInspector();
    renderAll();
    scheduleSave();
  };

  $('btn-prev-page').onclick = () => {
    const sc = getActiveScene();
    sc.activePageIndex = (sc.activePageIndex - 1 + sc.pages.length) % sc.pages.length;
    state.selectedWidgetId = null;
    closeInspector();
    renderAll();
    scheduleSave();
  };
  $('btn-next-page').onclick = () => {
    const sc = getActiveScene();
    sc.activePageIndex = (sc.activePageIndex + 1) % sc.pages.length;
    state.selectedWidgetId = null;
    closeInspector();
    renderAll();
    scheduleSave();
  };
  $('btn-add-page').onclick = async () => {
    const sc = getActiveScene();
    const defaultName = `Página ${sc.pages.length + 1}`;
    const name = await showDialog({ title: 'Nueva Página en Escena', defaultValue: defaultName });
    if (!name) return;
    sc.pages.push({ id: uid(), name, widgets: [] });
    sc.activePageIndex = sc.pages.length - 1;
    state.selectedWidgetId = null;
    closeInspector();
    renderAll();
    scheduleSave();
  };
  $('btn-rename-page').onclick = async () => {
    const page = getActivePage();
    const name = await showDialog({ title: 'Renombrar Página', defaultValue: page.name });
    if (name) { page.name = name; renderAll(); scheduleSave(); }
  };
  $('btn-dup-page').onclick = () => {
    const sc = getActiveScene();
    const copy = JSON.parse(JSON.stringify(getActivePage()));
    copy.id = uid();
    copy.name = `${copy.name} (2)`;
    copy.widgets.forEach((w) => (w.id = uid()));
    sc.pages.push(copy);
    sc.activePageIndex = sc.pages.length - 1;
    renderAll();
    scheduleSave();
  };
  $('btn-del-page').onclick = async () => {
    const sc = getActiveScene();
    if (sc.pages.length <= 1) return;
    const page = getActivePage();
    const ok = await showDialog({ title: 'Borrar Página', isPrompt: false, message: `¿Eliminar "${page.name}" y sus controles?` });
    if (!ok) return;
    sc.pages.splice(sc.activePageIndex, 1);
    sc.activePageIndex = Math.max(0, sc.activePageIndex - 1);
    state.selectedWidgetId = null;
    closeInspector();
    renderAll();
    scheduleSave();
  };

  $('btn-toggle-edit').onclick = () => {
    state.editMode = !state.editMode;
    if (!state.editMode) closeInspector();
    renderAll();
  };

  $('chk-snap').onchange = (e) => (state.snapToGrid = e.target.checked);

  $('btn-add-fader').onclick = () => addNewWidget('fader');
  $('btn-add-knob').onclick = () => addNewWidget('knob');
  $('btn-add-toggle').onclick = () => addNewWidget('toggle');
  $('btn-add-pad').onclick = () => addNewWidget('pad');

  $('btn-fullscreen').onclick = () => window.oscAPI.toggleFullscreen();

  $('btn-panic').onclick = () => {
    for (let ch = 0; ch < 16; ch++) {
      sendOscRaw(`/vkb_midi/${ch}/cc/123`, [{ type: 'i', value: 0 }], 'PANIC: All Notes Off');
    }
    getActiveScene().pages.forEach((p) =>
      p.widgets.forEach((w) => {
        if (w.msgType === 'note') {
          const ch = Math.max(0, Math.min(15, (w.channel || 1) - 1));
          sendOscRaw(`/vkb_midi/${ch}/note/${w.midiNum}`, [{ type: 'i', value: 0 }], 'PANIC: Note Off');
          w.normValue = 0;
        }
      })
    );
    renderAll();
    scheduleSave();
  };

  // Modal red
  $('btn-net-modal').onclick = async () => {
    $('net-host').value = state.config.network.host;
    $('net-port').value = state.config.network.port;
    const ips = await window.oscAPI.getLocalIPs();
    $('local-ips-list').textContent = ips.length ? ips.join('  |  ') : 'Sin red activa detectada';
    $('modal-network').classList.remove('hidden');
  };
  $('btn-close-net').onclick = () => $('modal-network').classList.add('hidden');
  $('btn-save-net').onclick = () => {
    state.config.network.host = $('net-host').value.trim() || '127.0.0.1';
    state.config.network.port = Number($('net-port').value) || 8000;
    $('modal-network').classList.add('hidden');
    scheduleSave();
  };
  $('btn-test-osc').onclick = () => {
    state.config.network.host = $('net-host').value.trim() || '127.0.0.1';
    state.config.network.port = Number($('net-port').value) || 8000;
    sendOscRaw('/vkb_midi/0/cc/1', [{ type: 'i', value: 100 }], 'Test Ch1 CC1 → 100');
  };

  // Modal escenas
  $('btn-scenes-modal').onclick = () => {
    renderScenesModal();
    $('modal-scenes').classList.remove('hidden');
  };
  $('btn-close-scenes').onclick = () => $('modal-scenes').classList.add('hidden');
  $('btn-new-scene').onclick = async () => {
    const name = await showDialog({ title: 'Nombre de la Nueva Escena', defaultValue: `Escena ${state.config.scenes.length + 1}` });
    if (!name) return;
    const newSc = {
      id: 'scene_' + uid(),
      name,
      activePageIndex: 0,
      pages: [{ id: uid(), name: 'Página 1', widgets: [] }]
    };
    state.config.scenes.push(newSc);
    state.config.activeSceneId = newSc.id;
    renderAll();
    renderScenesModal();
    scheduleSave();
  };
  $('btn-export-json').onclick = () => {
    window.oscAPI.exportConfig(JSON.stringify(state.config, null, 2));
  };
  $('btn-import-json').onclick = async () => {
    const raw = await window.oscAPI.importConfig();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.scenes && Array.isArray(parsed.scenes)) {
        state.config = parsed;
        renderAll();
        renderScenesModal();
        scheduleSave();
      }
    } catch (e) {
      await showDialog({ title: 'Error', isPrompt: false, message: 'El archivo JSON no tiene un formato válido.' });
    }
  };

  renderAll();
}

init();