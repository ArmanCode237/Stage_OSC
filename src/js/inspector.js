import { SWATCH_COLORS, CC_NAMES, midiNoteToName, uid } from './constants.js';
import { state, $, getActivePage, getSelectedWidget, scheduleSave } from './state.js';
import { updateWidgetVisuals, rerenderSingleWidget } from './widgets.js';

export function showDialog({ title, defaultValue = '', isPrompt = true, message = '' }) {
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

function populateMidiPresetOptions(msgType, currentVal) {
  const presetSel = $('inp-midi-preset');
  const opts = [];
  for (let i = 0; i <= 127; i++) {
    if (msgType === 'note') {
      opts.push(`<option value="${i}" ${i === currentVal ? 'selected' : ''}>Nota ${i} — ${midiNoteToName(i)}</option>`);
    } else {
      const desc = CC_NAMES[i] ? ` (${CC_NAMES[i]})` : '';
      opts.push(`<option value="${i}" ${i === currentVal ? 'selected' : ''}>CC ${i}${desc}</option>`);
    }
  }
  presetSel.innerHTML = opts.join('');
}

function refreshSubtitle(widget) {
  const detail = widget.msgType === 'osc' ? widget.oscAddress : `CH ${widget.channel || 1}`;
  $('inspector-subtitle').textContent = `${widget.type.toUpperCase()} · ${detail}`;
  $('inspector-title').textContent = widget.label || 'Control';
}

export function syncInspectorGeometry(widget) {
  if (!state.inspectorOpen || state.selectedWidgetId !== widget.id) return;
  $('inp-x').value = widget.x;
  $('inp-y').value = widget.y;
  $('inp-w').value = widget.w;
  $('inp-h').value = widget.h;
}

export function openInspector(widget) {
  state.selectedWidgetId = widget.id;
  state.inspectorOpen = true;

  const zoom = state.config?.appearance?.canvasZoom || 1;
  const uiScale = state.config?.appearance?.uiScale || 1;
  const inspMargin = 350 * uiScale;
  const canvasW = $('canvas-area').clientWidth || window.innerWidth;
  const screenRight = (widget.x + widget.w) * zoom;
  const screenLeft = widget.x * zoom;

  if (!state.inspectorDockLeft && screenRight > canvasW - inspMargin) {
    state.inspectorDockLeft = true;
  } else if (state.inspectorDockLeft && screenLeft < inspMargin && screenRight < canvasW - inspMargin) {
    state.inspectorDockLeft = false;
  }
  $('inspector').classList.toggle('dock-left', state.inspectorDockLeft);

  const isToggle = widget.type === 'toggle';
  const isPad = widget.type === 'pad';

  refreshSubtitle(widget);

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
  syncInspectorGeometry(widget);

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

  document.querySelectorAll('.osc-widget').forEach((w) => w.classList.remove('selected-edit'));
  const widgetEl = document.querySelector(`.osc-widget[data-id="${widget.id}"]`);
  if (widgetEl) widgetEl.classList.add('selected-edit');

  $('inspector').classList.remove('hidden');
}

export function closeInspector() {
  state.inspectorOpen = false;
  $('inspector').classList.add('hidden');
}

export function bindInspectorInputs(widgetCallbacks, onFullRender) {
  const chSel = $('inp-channel');
  chSel.innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 1}">Canal ${i + 1}</option>`).join('');

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
      updateWidgetVisuals(w);
      scheduleSave();
    };
    swatchBox.appendChild(s);
  });

  $('btn-inspector-side').onclick = () => {
    state.inspectorDockLeft = !state.inspectorDockLeft;
    $('inspector').classList.toggle('dock-left', state.inspectorDockLeft);
  };

  $('inspector-close').onclick = closeInspector;

  $('inp-label').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.label = e.target.value;
    const titleEl = document.querySelector(`.osc-widget[data-id="${w.id}"] .w-title`);
    if (titleEl) titleEl.textContent = w.label || 'Control';
    refreshSubtitle(w);
    scheduleSave();
  };

  $('inp-on-label').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.onLabel = e.target.value;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-off-label').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.offLabel = e.target.value;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-type').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.type = e.target.value;
    if (w.type === 'knob' && w.h > 220) { w.w = 145; w.h = 170; }
    if (w.type === 'fader' && w.h < 220) { w.w = 95; w.h = 340; }
    if (w.type === 'toggle') {
      w.spring = false;
      if (w.onLabel === undefined) w.onLabel = 'ON';
      if (w.offLabel === undefined) w.offLabel = 'OFF';
      w.normValue = w.normValue > 0.5 ? 1 : 0;
      if (w.h > 220) { w.w = 125; w.h = 125; }
    }
    if (w.type === 'pad') {
      w.msgType = 'note';
      w.noteBehavior = 'gate';
      if (w.h > 220) { w.w = 145; w.h = 165; }
    }
    rerenderSingleWidget(w, widgetCallbacks);
    openInspector(w);
    scheduleSave();
  };

  $('inp-msg-type').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.msgType = e.target.value;
    if (w.msgType === 'pitch') { w.min = 0; w.max = 16383; w.normValue = 0.5; }
    else if (w.max > 127) { w.min = 0; w.max = 127; }
    updateWidgetVisuals(w);
    openInspector(w);
    scheduleSave();
  };

  $('inp-channel').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.channel = Number(e.target.value);
    refreshSubtitle(w);
    scheduleSave();
  };

  $('inp-midi-num').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.midiNum = Math.max(0, Math.min(127, Number(e.target.value) || 0));
    $('inp-midi-preset').value = String(w.midiNum);
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-midi-preset').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.midiNum = Number(e.target.value);
    $('inp-midi-num').value = w.midiNum;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-note-behavior').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.noteBehavior = e.target.value;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-osc-address').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.oscAddress = e.target.value;
    refreshSubtitle(w);
    scheduleSave();
  };

  $('inp-osc-type').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.oscType = e.target.value;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-min').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.min = Number(e.target.value) || 0;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-max').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.max = Number(e.target.value) || 127;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-color').oninput = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.color = e.target.value;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-glow').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.glow = e.target.value;
    updateWidgetVisuals(w);
    scheduleSave();
  };

  $('inp-style').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.style = e.target.value;
    rerenderSingleWidget(w, widgetCallbacks);
    scheduleSave();
  };

  $('inp-show-ticks').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.showTicks = e.target.checked;
    rerenderSingleWidget(w, widgetCallbacks);
    scheduleSave();
  };

  $('inp-show-value').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.showValue = e.target.checked;
    rerenderSingleWidget(w, widgetCallbacks);
    scheduleSave();
  };

  $('inp-spring').onchange = (e) => {
    const w = getSelectedWidget();
    if (!w) return;
    w.spring = e.target.checked;
    scheduleSave();
  };

  ['x', 'y', 'w', 'h'].forEach((k) => {
    $(`inp-${k}`).oninput = (e) => {
      const w = getSelectedWidget();
      if (!w) return;
      const minLimit = k === 'w' || k === 'h' ? 60 : 0;
      w[k] = Math.max(minLimit, Number(e.target.value) || 0);
      const el = document.querySelector(`.osc-widget[data-id="${w.id}"]`);
      if (el) {
        if (k === 'x') el.style.left = `${w.x}px`;
        if (k === 'y') el.style.top = `${w.y}px`;
        if (k === 'w') el.style.width = `${w.w}px`;
        if (k === 'h') el.style.height = `${w.h}px`;
      }
      scheduleSave();
    };
  });

  $('btn-del-widget').onclick = () => {
    const w = getSelectedWidget();
    if (!w) return;
    const page = getActivePage();
    page.widgets = page.widgets.filter((x) => x.id !== w.id);
    state.selectedWidgetId = null;
    closeInspector();
    onFullRender();
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
    onFullRender();
    openInspector(copy);
    scheduleSave();
  };
}

export function initContextMenu({ onOpenInspector, onFullRender, onAddWidgetAt }) {
  document.addEventListener('contextmenu', (e) => {
    if (!state.editMode) return;
    const widgetEl = e.target.closest('.osc-widget');
    const canvasEl = e.target.closest('#canvas-area');
    if (!widgetEl && !canvasEl) return;

    e.preventDefault();
    const menu = $('context-menu');

    if (widgetEl) {
      const page = getActivePage();
      const widget = page.widgets.find((w) => w.id === widgetEl.dataset.id);
      if (!widget) return;

      state.selectedWidgetId = widget.id;
      document.querySelectorAll('.osc-widget').forEach((w) => w.classList.remove('selected-edit'));
      widgetEl.classList.add('selected-edit');

      $('ctx-widget-group').classList.remove('hidden');
      $('ctx-canvas-group').classList.add('hidden');

      $('ctx-btn-config').onclick = () => {
        menu.classList.add('hidden');
        onOpenInspector(widget);
      };
      $('ctx-btn-dup').onclick = () => {
        menu.classList.add('hidden');
        const copy = JSON.parse(JSON.stringify(widget));
        copy.id = uid();
        copy.x += 20;
        copy.y += 20;
        page.widgets.push(copy);
        onFullRender();
        onOpenInspector(copy);
        scheduleSave();
      };
      $('ctx-btn-del').onclick = () => {
        menu.classList.add('hidden');
        page.widgets = page.widgets.filter((w) => w.id !== widget.id);
        if (state.selectedWidgetId === widget.id) {
          state.selectedWidgetId = null;
          closeInspector();
        }
        onFullRender();
        scheduleSave();
      };
    } else if (canvasEl) {
      const zoom = state.config?.appearance?.canvasZoom || 1;
      const stageRect = $('canvas-stage').getBoundingClientRect();
      const pos = {
        x: Math.max(0, (e.clientX - stageRect.left) / zoom - 45),
        y: Math.max(0, (e.clientY - stageRect.top) / zoom - 45)
      };

      $('ctx-widget-group').classList.add('hidden');
      $('ctx-canvas-group').classList.remove('hidden');

      ['fader', 'knob', 'toggle', 'pad'].forEach((type) => {
        $(`ctx-add-${type}`).onclick = () => {
          menu.classList.add('hidden');
          onAddWidgetAt(type, pos);
        };
      });
    }

    menu.style.left = `${Math.min(e.clientX, window.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(e.clientY, window.innerHeight - 190)}px`;
    menu.classList.remove('hidden');
  });
}