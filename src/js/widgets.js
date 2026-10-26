import { SWATCH_COLORS, uid } from './constants.js';
import { state, $, scheduleSave } from './state.js';
import { formatWidgetReadout, dispatchWidgetMessage } from './midiRouter.js';

export function snapVal(v) {
  return state.snapToGrid ? Math.round(v / 20) * 20 : Math.round(v);
}

export function createWidgetData(type, count, pos = null) {
  let wSize = 145, hSize = 165;
  if (type === 'fader') { wSize = 95; hSize = 340; }
  if (type === 'toggle') { wSize = 115; hSize = 110; }

  const defaultLabels = {
    fader: `Fader ${count + 1}`,
    knob: `Knob ${count + 1}`,
    toggle: `Toggle ${count + 1}`,
    pad: `Pad ${count + 1}`
  };

  return {
    id: uid(),
    type,
    label: defaultLabels[type] || `Control ${count + 1}`,
    onLabel: 'ON',
    offLabel: 'OFF',
    x: pos ? snapVal(pos.x) : 40 + ((count * 40) % 440),
    y: pos ? snapVal(pos.y) : 40 + ((count * 30) % 200),
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
    oscAddress: type === 'toggle' ? `/track/${count + 1}/mute` : `/track/${count + 1}/volume`,
    oscType: 'f',
    min: 0,
    max: 127,
    normValue: type === 'fader' ? 0.5 : 0
  };
}

export function updateWidgetVisuals(widget, el = null) {
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

export function buildWidgetElement(widget, callbacks = {}) {
  const el = document.createElement('div');
  el.className = `osc-widget style-${widget.style || 'glass'}`;
  if (state.editMode && widget.id === state.selectedWidgetId) {
    el.classList.add('selected-edit');
  }
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

  const cfgBtnHtml = state.editMode ? `<div class="btn-widget-config" data-cfg="1" title="Configurar (Clic derecho)">⚙</div>` : '';
  const resizeHtml = state.editMode ? `<div class="resize-handle" data-resize="1"></div>` : '';

  el.innerHTML = `${titleHtml}${bodyHtml}${badgeHtml}${cfgBtnHtml}${resizeHtml}`;
  updateWidgetVisuals(widget, el);
  attachWidgetPointerEvents(el, widget, callbacks);
  return el;
}

export function rerenderSingleWidget(widget, callbacks = {}) {
  const oldEl = document.querySelector(`.osc-widget[data-id="${widget.id}"]`);
  if (!oldEl) return;
  const newEl = buildWidgetElement(widget, callbacks);
  oldEl.replaceWith(newEl);
}

function attachWidgetPointerEvents(el, widget, callbacks) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return; // Ignorar clic derecho para dejar actuar al menú contextual
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);

    if (state.editMode) {
      if (e.target.dataset.cfg) {
        callbacks.onOpenInspector?.(widget);
        return;
      }

      const isResize = Boolean(e.target.dataset.resize);
      const session = {
        mode: isResize ? 'resize' : 'move',
        widget,
        el,
        startX: e.clientX,
        startY: e.clientY,
        origX: widget.x,
        origY: widget.y,
        origW: widget.w,
        origH: widget.h,
        longPressTimer: null
      };

      // Pulsación larga en pantalla táctil (se cancela automáticamente si arrastras > 8px)
      if (e.pointerType === 'touch' && !isResize) {
        session.longPressTimer = setTimeout(() => {
          state.activePointers.delete(e.pointerId);
          try { el.releasePointerCapture(e.pointerId); } catch (_) {}
          callbacks.onOpenInspector?.(widget);
        }, 550);
      }

      state.activePointers.set(e.pointerId, session);
      state.selectedWidgetId = widget.id;
      document.querySelectorAll('.osc-widget').forEach((w) => w.classList.remove('selected-edit'));
      el.classList.add('selected-edit');

      if (state.inspectorOpen) {
        callbacks.onOpenInspector?.(widget);
      }
      return;
    }

    // --- Modo Live (Cachea rectángulo una sola vez para cero reflows en pointermove) ---
    const trackEl = widget.type === 'fader' ? el.querySelector('.fader-track') : null;
    const trackRect = trackEl ? trackEl.getBoundingClientRect() : null;

    const session = {
      mode: 'live',
      widget,
      el,
      trackRect,
      startY: e.clientY,
      startNorm: widget.normValue || 0
    };
    state.activePointers.set(e.pointerId, session);

    if (widget.type === 'fader' && trackRect) {
      widget.normValue = Math.max(0, Math.min(1, 1 - (e.clientY - trackRect.top) / trackRect.height));
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

    if (session.longPressTimer) {
      const dist = Math.hypot(e.clientX - session.startX, e.clientY - session.startY);
      if (dist > 8) {
        clearTimeout(session.longPressTimer);
        session.longPressTimer = null;
      }
    }

    if (session.mode === 'move') {
      widget.x = Math.max(0, snapVal(session.origX + (e.clientX - session.startX)));
      widget.y = Math.max(0, snapVal(session.origY + (e.clientY - session.startY)));
      el.style.left = `${widget.x}px`;
      el.style.top = `${widget.y}px`;
      callbacks.onGeometryChange?.(widget);
    } else if (session.mode === 'resize') {
      widget.w = Math.max(60, snapVal(session.origW + (e.clientX - session.startX)));
      widget.h = Math.max(60, snapVal(session.origH + (e.clientY - session.startY)));
      el.style.width = `${widget.w}px`;
      el.style.height = `${widget.h}px`;
      callbacks.onGeometryChange?.(widget);
    } else if (session.mode === 'live') {
      if (widget.type === 'fader' && session.trackRect) {
        widget.normValue = Math.max(0, Math.min(1, 1 - (e.clientY - session.trackRect.top) / session.trackRect.height));
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
    if (session.longPressTimer) clearTimeout(session.longPressTimer);
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
    }
    scheduleSave();
  };

  el.addEventListener('pointerup', endTouch);
  el.addEventListener('pointercancel', endTouch);
}