import { SWATCH_COLORS, uid } from './constants.js';
import { state, scheduleSave } from './state.js';
import { formatWidgetReadout, dispatchWidgetMessage } from './midiRouter.js';

const FADER_LED_COUNT = 20;
const KNOB_LED_COUNT = 15;
const NORD_TICK_COUNT = 26;

export function snapVal(v) {
  return state.snapToGrid ? Math.round(v / 20) * 20 : Math.round(v);
}

function getCanvasZoom() {
  return state.config?.appearance?.canvasZoom || 1;
}

// Resuelve el color exacto de fábrica de cada tema salvo que el usuario lo personalice en ese tema
export function getEffectiveWidgetColor(widget) {
  const theme = state.config?.appearance?.theme || 'cyber';

  if (theme === 'nord') {
    if (widget.themeColors?.nord) return widget.themeColors.nord;
    if (widget.type === 'fader') return '#00fa1d';
    if (widget.type === 'knob') return '#ffffff';
    if (widget.type === 'toggle') return '#ff3b30';
    if (widget.type === 'pad') return '#f4f6fa';
  }

  if (theme === 'montage') {
    if (widget.type === 'knob' && widget.superKnob) {
      return widget.themeColors?.montageSuper || '#0055ff';
    }
    if (widget.themeColors?.montage) return widget.themeColors.montage;
    if (widget.type === 'fader') return '#ff0000';
    if (widget.type === 'toggle') return '#ff5900';
    if (widget.type === 'knob') return '#ff0000';
    if (widget.type === 'pad') return '#f4f6fa';
  }

  return widget.color || '#00e5ff';
}

export function createWidgetData(type, count, pos = null) {
  let wSize = 145, hSize = 165;
  if (type === 'fader') { wSize = 95; hSize = 340; }
  if (type === 'toggle') { wSize = 125; hSize = 125; }

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
    themeColors: {},
    superKnob: false,
    superKnobBlink: false,
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

function syncSuperKnobPulse(widget, el, norm) {
  const pulseLayer = el.querySelector('.super-knob-pulse-layer');
  if (!pulseLayer) return;

  const theme = state.config?.appearance?.theme || 'cyber';
  const shouldBlink =
    theme === 'montage' &&
    widget.type === 'knob' &&
    Boolean(widget.superKnob) &&
    Boolean(widget.superKnobBlink) &&
    norm < 0.99;

  // Si está desactivado el parpadeo o llegó al 100% del recorrido, queda fijo encendido
  if (!shouldBlink) {
    if (el._skAnim) {
      el._skAnim.cancel();
      el._skAnim = null;
    }
    pulseLayer.style.opacity = '1';
    return;
  }

  if (!el._skAnim) {
    el._skAnim = pulseLayer.animate(
      [{ opacity: 1 }, { opacity: 0.08 }, { opacity: 1 }],
      { duration: 2400, iterations: Infinity, easing: 'ease-in-out' }
    );
  }

  // Parpadeo lento en valores bajos (1x = 2.4s) y aceleración progresiva hacia el máximo (~9x)
  const playbackRate = 1 + Math.pow(norm, 1.35) * 8;
  el._skAnim.updatePlaybackRate(playbackRate);
}

export function updateWidgetVisuals(widget, el = null) {
  if (!el) el = document.querySelector(`.osc-widget[data-id="${widget.id}"]`);
  if (!el) return;

  const norm = Math.max(0, Math.min(1, widget.normValue || 0));
  el.style.setProperty('--w-color', getEffectiveWidgetColor(widget));

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

    const leds = el.querySelectorAll('.fader-led-seg');
    if (leds.length) {
      const total = leds.length;
      const litCount = Math.min(total, Math.max(1, Math.round(1 + norm * (total - 1))));
      leds.forEach((seg, idx) => {
        seg.classList.toggle('lit', idx < litCount);
      });
    }
  } else if (widget.type === 'knob') {
    el.classList.toggle('is-super-knob', Boolean(widget.superKnob));

    const arcLen = 179.07;
    const fillArc = el.querySelector('.knob-arc-fill');
    const pointer = el.querySelector('.knob-pointer');
    const skNotch = el.querySelector('.sk-cap-notch');
    const angle = -135 + norm * 270;

    if (fillArc) fillArc.setAttribute('stroke-dasharray', `${norm * arcLen} 238.76`);
    if (pointer) pointer.setAttribute('transform', `rotate(${angle} 50 50)`);
    if (skNotch) skNotch.setAttribute('transform', `rotate(${angle} 50 50)`);

    // Anillo curvo de LEDs cuadrados intercalados para Knobs estándar en Montage
    const kLeds = el.querySelectorAll('.knob-led-seg');
    if (kLeds.length) {
      const totalK = kLeds.length;
      const litK = norm <= 0.005 ? 0 : Math.min(totalK, Math.max(1, Math.ceil(norm * totalK)));
      kLeds.forEach((seg, idx) => {
        seg.classList.toggle('lit', idx < litK);
      });
    }

    // Intensidad progresiva y parpadeo del Super Knob
    const minIntensity = widget.superKnobBlink && norm < 0.99 ? 0.28 : 0.12;
    const skIntensity = minIntensity + norm * (1 - minIntensity);
    el.style.setProperty('--sk-norm', norm.toFixed(3));
    el.style.setProperty('--sk-intensity', skIntensity.toFixed(3));
    el.style.setProperty('--sk-glow-px', `${(1.5 + norm * 16.5).toFixed(1)}px`);
    el.style.setProperty('--sk-core-opacity', (Math.pow(norm, 1.4) * 0.9).toFixed(3));

    syncSuperKnobPulse(widget, el, norm);
  } else if (widget.type === 'toggle') {
    const isOn = norm > 0.5;
    const padBody = el.querySelector('.pad-body');
    const stateText = el.querySelector('.pad-state-text');
    if (padBody) padBody.classList.toggle('active', isOn);
    if (stateText) {
      const onTxt = widget.onLabel !== undefined ? widget.onLabel : 'ON';
      const offTxt = widget.offLabel !== undefined ? widget.offLabel : 'OFF';
      stateText.textContent = isOn ? onTxt : offTxt;
    }
  } else if (widget.type === 'pad') {
    const padBody = el.querySelector('.pad-body');
    if (padBody) padBody.classList.toggle('active', norm > 0.01);
  }
}

function buildNordKnobTicksSvg() {
  return Array.from({ length: NORD_TICK_COUNT }, (_, i) => {
    const angle = -135 + (i / (NORD_TICK_COUNT - 1)) * 270;
    const isMajor = i % 2 === 0;
    const y1 = isMajor ? 8.5 : 12.2;
    const cls = isMajor ? 'nord-tick-major' : 'nord-tick-minor';
    return `<line class="${cls}" x1="50" y1="${y1}" x2="50" y2="17.5" transform="rotate(${angle.toFixed(2)} 50 50)" />`;
  }).join('');
}

function buildMontageKnobLedsSvg() {
  return Array.from({ length: KNOB_LED_COUNT }, (_, i) => {
    const angle = -135 + (i / (KNOB_LED_COUNT - 1)) * 270;
    return `<rect class="knob-led-seg" data-kled="${i}" x="47.3" y="9.3" width="5.4" height="5.4" rx="0.8" transform="rotate(${angle.toFixed(2)} 50 50)" />`;
  }).join('');
}

export function buildWidgetElement(widget, callbacks = {}) {
  const el = document.createElement('div');
  el.className = `osc-widget style-${widget.style || 'glass'}`;
  if (widget.type === 'knob' && widget.superKnob) {
    el.classList.add('is-super-knob');
  }
  if (state.editMode && widget.id === state.selectedWidgetId) {
    el.classList.add('selected-edit');
  }
  el.dataset.id = widget.id;
  el.dataset.type = widget.type;
  el.style.left = `${widget.x}px`;
  el.style.top = `${widget.y}px`;
  el.style.width = `${widget.w}px`;
  el.style.height = `${widget.h}px`;

  const titleHtml = `<div class="w-title">${widget.label || 'Control'}</div>`;
  const badgeHtml = widget.showValue ? `<div class="w-badge">0</div>` : '';

  let bodyHtml = '';
  if (widget.type === 'fader') {
    const ledsHtml = Array.from(
      { length: FADER_LED_COUNT },
      (_, i) => `<span class="fader-led-seg" data-led="${i}"></span>`
    ).join('');

    bodyHtml = `<div class="fader-body">
      <div class="fader-ticks ${widget.showTicks ? '' : 'ticks-hidden'}"></div>
      <div class="fader-led-strip" aria-hidden="true">${ledsHtml}</div>
      <div class="fader-track">
        <div class="fader-fill"></div>
        <div class="fader-thumb"></div>
      </div>
    </div>`;
  } else if (widget.type === 'knob') {
    const gradId = `knobGrad_${widget.id}`;
    const skGradId = `skBlackGrad_${widget.id}`;
    bodyHtml = `<div class="knob-body">
      <svg class="knob-svg" viewBox="0 0 100 100">
        <defs>
          <radialGradient id="${gradId}" cx="38%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#464d59" />
            <stop offset="45%" stop-color="#1a1d24" />
            <stop offset="100%" stop-color="#07080b" />
          </radialGradient>
          <radialGradient id="${skGradId}" cx="36%" cy="26%" r="72%">
            <stop offset="0%" stop-color="#262b34" />
            <stop offset="48%" stop-color="#0d1015" />
            <stop offset="100%" stop-color="#030406" />
          </radialGradient>
        </defs>

        <!-- Tema estándar -->
        <circle class="knob-arc-bg" cx="50" cy="50" r="38" stroke-dasharray="179.07 238.76" transform="rotate(135 50 50)" />
        <circle class="knob-arc-fill" cx="50" cy="50" r="38" stroke-dasharray="0 238.76" transform="rotate(135 50 50)" />

        <!-- Líneas intercaladas del Nord Stage -->
        <g class="knob-nord-ticks" aria-hidden="true">${buildNordKnobTicksSvg()}</g>

        <!-- Tira curva de LEDs cuadrados intercalados del Yamaha Montage -->
        <g class="knob-led-ring" aria-hidden="true">${buildMontageKnobLedsSvg()}</g>

        <!-- Cuerpo de Knob normal -->
        <circle class="knob-cap" cx="50" cy="50" r="27" style="--knob-lit-fill: url(#${gradId})" />
        <line class="knob-pointer" x1="50" y1="37" x2="50" y2="20" />

        <!-- Super Knob exclusivo de Yamaha Montage -->
        <g class="super-knob-group" aria-hidden="true">
          <g class="super-knob-pulse-layer">
            <circle class="sk-halo" cx="50" cy="50" r="38" />
            <circle class="sk-rim" cx="50" cy="50" r="32" />
            <circle class="sk-rim-core" cx="50" cy="50" r="32" />
          </g>
          <circle class="sk-black-center" cx="50" cy="50" r="21.5" fill="url(#${skGradId})" />
          <line class="sk-cap-notch" x1="50" y1="38" x2="50" y2="30" />
        </g>
      </svg>
    </div>`;
  } else if (widget.type === 'toggle') {
    bodyHtml = `<div class="pad-body toggle-pad">
      <span class="toggle-hw-led" aria-hidden="true"></span>
      <span class="toggle-nord-oval" aria-hidden="true"></span>
      <span class="pad-state-text"></span>
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
  if (oldEl._skAnim) oldEl._skAnim.cancel();
  const newEl = buildWidgetElement(widget, callbacks);
  oldEl.replaceWith(newEl);
}

function attachWidgetPointerEvents(el, widget, callbacks) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
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

    const zoom = getCanvasZoom();

    if (session.mode === 'move') {
      widget.x = Math.max(0, snapVal(session.origX + (e.clientX - session.startX) / zoom));
      widget.y = Math.max(0, snapVal(session.origY + (e.clientY - session.startY) / zoom));
      el.style.left = `${widget.x}px`;
      el.style.top = `${widget.y}px`;
      callbacks.onGeometryChange?.(widget);
    } else if (session.mode === 'resize') {
      widget.w = Math.max(60, snapVal(session.origW + (e.clientX - session.startX) / zoom));
      widget.h = Math.max(60, snapVal(session.origH + (e.clientY - session.startY) / zoom));
      el.style.width = `${widget.w}px`;
      el.style.height = `${widget.h}px`;
      callbacks.onGeometryChange?.(widget);
    } else if (session.mode === 'live') {
      if (widget.type === 'fader' && session.trackRect) {
        widget.normValue = Math.max(0, Math.min(1, 1 - (e.clientY - session.trackRect.top) / session.trackRect.height));
      } else if (widget.type === 'knob') {
        const deltaY = session.startY - e.clientY;
        const throwScale = Math.max(0.65, Math.min(1.35, zoom));
        widget.normValue = Math.max(0, Math.min(1, session.startNorm + deltaY / (170 * throwScale)));
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
    callbacks.onDragEnd?.();
    scheduleSave();
  };

  el.addEventListener('pointerup', endTouch);
  el.addEventListener('pointercancel', endTouch);
}