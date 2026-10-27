import { state, $, getActivePage, getSelectedWidget, scheduleSave } from './state.js';
import { updateWidgetVisuals } from './widgets.js';
import { openInspector } from './inspector.js';

export const THEMES = [
  { id: 'cyber', name: 'Cyber Cyan', previewBg: '#090c12', previewCard: '#161d2c', accent: '#00e5ff' },
  { id: 'oled', name: 'OLED Puro', previewBg: '#000000', previewCard: '#0d1017', accent: '#00f5d4' },
  { id: 'amber', name: 'Studio Ámbar', previewBg: '#12100e', previewCard: '#211c18', accent: '#f59e0b' },
  { id: 'crimson', name: 'Escenario Rojo', previewBg: '#11070a', previewCard: '#221017', accent: '#ff4d6d' },
  { id: 'emerald', name: 'Synth Esmeralda', previewBg: '#06120f', previewCard: '#0f241f', accent: '#10b981' },
  { id: 'light', name: 'Modo Claro', previewBg: '#e8eef5', previewCard: '#ffffff', accent: '#0284c7' },
  { id: 'montage', name: 'Yamaha Montage', previewBg: '#0a0c10', previewCard: '#1d222b', accent: '#ff5900' },
  { id: 'nord', name: 'Nord Stage', previewBg: '#7a090d', previewCard: '#4f5f70', accent: '#00fa1d' }
];

export function clampZoom(val, min = 0.5, max = 1.75) {
  const num = Number(val) || 1;
  return Math.round(Math.max(min, Math.min(max, num)) * 100) / 100;
}

export function applyAppearance() {
  const appCfg = state.config.appearance;
  const themeId = appCfg.theme || 'cyber';
  const canvasZoom = clampZoom(appCfg.canvasZoom, 0.5, 1.75);
  const uiScale = clampZoom(appCfg.uiScale, 0.75, 1.3);
  const allowScroll = Boolean(appCfg.canvasScroll);

  document.documentElement.setAttribute('data-theme', themeId);
  document.documentElement.style.setProperty('--canvas-zoom', String(canvasZoom));
  document.documentElement.style.setProperty('--ui-scale', String(uiScale));

  const canvasArea = $('canvas-area');
  if (canvasArea) {
    canvasArea.classList.toggle('allow-scroll', allowScroll);
  }

  getActivePage().widgets.forEach((w) => updateWidgetVisuals(w));

  if (state.inspectorOpen) {
    const sel = getSelectedWidget();
    if (sel) openInspector(sel);
  }

  updateStageBounds();
  syncAppearanceControls();
}

export function updateStageBounds() {
  const stage = $('canvas-stage');
  if (!stage || !state.config) return;

  const zoom = state.config.appearance?.canvasZoom || 1;
  const allowScroll = Boolean(state.config.appearance?.canvasScroll);
  const page = getActivePage();

  if (!allowScroll || !page.widgets.length) {
    stage.style.width = `${100 / zoom}%`;
    stage.style.height = `${100 / zoom}%`;
    return;
  }

  let maxRight = 0;
  let maxBottom = 0;
  page.widgets.forEach((w) => {
    maxRight = Math.max(maxRight, (w.x || 0) + (w.w || 100) + 40);
    maxBottom = Math.max(maxBottom, (w.y || 0) + (w.h || 100) + 40);
  });

  const area = $('canvas-area');
  const minW = (area?.clientWidth || window.innerWidth) / zoom;
  const minH = (area?.clientHeight || window.innerHeight) / zoom;

  stage.style.width = `${Math.max(minW, maxRight)}px`;
  stage.style.height = `${Math.max(minH, maxBottom)}px`;
}

export function fitCanvasToScreen() {
  const page = getActivePage();
  const area = $('canvas-area');
  if (!area || !page.widgets.length) {
    state.config.appearance.canvasZoom = 1;
    applyAppearance();
    scheduleSave();
    return;
  }

  let maxRight = 0;
  let maxBottom = 0;
  page.widgets.forEach((w) => {
    maxRight = Math.max(maxRight, (w.x || 0) + (w.w || 100) + 24);
    maxBottom = Math.max(maxBottom, (w.y || 0) + (w.h || 100) + 24);
  });

  const availW = Math.max(200, area.clientWidth);
  const availH = Math.max(160, area.clientHeight);
  const ideal = Math.min(availW / maxRight, availH / maxBottom);

  const snapped = Math.floor(Math.max(0.5, Math.min(1.5, ideal)) * 20) / 20;
  state.config.appearance.canvasZoom = clampZoom(snapped, 0.5, 1.75);
  applyAppearance();
  scheduleSave();
}

export function stepCanvasZoom(delta) {
  const next = clampZoom((state.config.appearance.canvasZoom || 1) + delta, 0.5, 1.75);
  state.config.appearance.canvasZoom = next;
  applyAppearance();
  scheduleSave();
}

function renderThemeCards() {
  const grid = $('theme-grid');
  if (!grid) return;
  const activeTheme = state.config.appearance.theme || 'cyber';

  grid.innerHTML = THEMES.map((t) => `
    <button type="button" class="theme-card ${t.id === activeTheme ? 'active' : ''}" data-theme-id="${t.id}">
      <span class="theme-swatch-preview" style="background:${t.previewBg};border-color:${t.accent}">
        <span class="theme-swatch-inner" style="background:${t.previewCard}"></span>
        <span class="theme-swatch-dot" style="background:${t.accent}"></span>
      </span>
      <span class="theme-card-name">${t.name}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.theme-card').forEach((btn) => {
    btn.onclick = () => {
      state.config.appearance.theme = btn.dataset.themeId;
      applyAppearance();
      renderThemeCards();
      scheduleSave();
    };
  });
}

function syncAppearanceControls() {
  const modal = $('modal-appearance');
  if (!modal) return;
  const { canvasZoom, uiScale, canvasScroll } = state.config.appearance;

  const cPct = Math.round((canvasZoom || 1) * 100);
  const uPct = Math.round((uiScale || 1) * 100);

  if ($('zoom-canvas-range')) $('zoom-canvas-range').value = String(cPct);
  if ($('zoom-canvas-val')) $('zoom-canvas-val').textContent = `${cPct}%`;

  if ($('ui-scale-range')) $('ui-scale-range').value = String(uPct);
  if ($('ui-scale-val')) $('ui-scale-val').textContent = `${uPct}%`;

  if ($('chk-canvas-scroll')) $('chk-canvas-scroll').checked = Boolean(canvasScroll);
}

export function openAppearanceModal() {
  renderThemeCards();
  syncAppearanceControls();
  $('modal-appearance').classList.remove('hidden');
}

export function openAboutModal() {
  $('modal-about')?.classList.remove('hidden');
}

export function bindAppearanceEvents() {
  const closeAppModal = () => $('modal-appearance').classList.add('hidden');
  const closeAboutModal = () => $('modal-about').classList.add('hidden');

  $('btn-x-appearance').onclick = closeAppModal;
  $('btn-close-appearance').onclick = closeAppModal;

  if ($('btn-brand-logo')) {
    $('btn-brand-logo').onclick = openAboutModal;
  }
  if ($('btn-x-about')) {
    $('btn-x-about').onclick = closeAboutModal;
  }
  if ($('btn-close-about')) {
    $('btn-close-about').onclick = closeAboutModal;
  }

  $('zoom-canvas-range').oninput = (e) => {
    state.config.appearance.canvasZoom = clampZoom(Number(e.target.value) / 100, 0.5, 1.75);
    applyAppearance();
    scheduleSave();
  };

  $('btn-zoom-out').onclick = () => stepCanvasZoom(-0.05);
  $('btn-zoom-in').onclick = () => stepCanvasZoom(0.05);
  $('btn-zoom-reset').onclick = () => {
    state.config.appearance.canvasZoom = 1;
    applyAppearance();
    scheduleSave();
  };
  $('btn-zoom-fit').onclick = fitCanvasToScreen;

  $('ui-scale-range').oninput = (e) => {
    state.config.appearance.uiScale = clampZoom(Number(e.target.value) / 100, 0.75, 1.3);
    applyAppearance();
    scheduleSave();
  };

  document.querySelectorAll('[data-ui-preset]').forEach((btn) => {
    btn.onclick = () => {
      state.config.appearance.uiScale = clampZoom(Number(btn.dataset.uiPreset), 0.75, 1.3);
      applyAppearance();
      scheduleSave();
    };
  });

  $('chk-canvas-scroll').onchange = (e) => {
    state.config.appearance.canvasScroll = e.target.checked;
    applyAppearance();
    scheduleSave();
  };

  window.addEventListener('resize', () => {
    updateStageBounds();
  });
}