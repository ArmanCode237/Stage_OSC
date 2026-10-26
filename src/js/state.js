import { uid, createDefaultConfig } from './constants.js';
import { platform } from './platform.js';

export const $ = (id) => document.getElementById(id);

export const state = {
  config: null,
  editMode: false,
  zenMode: false,
  snapToGrid: true,
  selectedWidgetId: null,
  inspectorOpen: false,
  inspectorDockLeft: false,
  activePointers: new Map(),
  saveTimer: null,
  ledTimer: null
};

const runtimeCache = new WeakMap();

export function getRuntime(widget) {
  let rt = runtimeCache.get(widget);
  if (!rt) {
    rt = { lastSent: null, sweepNote: null };
    runtimeCache.set(widget, rt);
  }
  return rt;
}

export function normalizeConfig(raw) {
  const fallback = createDefaultConfig();
  if (!raw || !Array.isArray(raw.scenes) || !raw.scenes.length) {
    raw = fallback;
  }

  raw.network = {
    host: raw.network?.host || '192.168.1.50',
    port: Number(raw.network?.port) || 8000,
    rxEnabled: Boolean(raw.network?.rxEnabled),
    listenPort: Number(raw.network?.listenPort) || 9000
  };

  // Por defecto mantiene 'udp' para no alterar la operación actual en Windows
  raw.midi = {
    transport: raw.midi?.transport || 'udp', // 'udp' | 'midi' | 'both'
    outputId: raw.midi?.outputId || '',
    outputName: raw.midi?.outputName || ''
  };

  raw.scenes.forEach((sc) => {
    sc.pages?.forEach((p) => {
      p.widgets?.forEach((w) => {
        delete w._lastSent;
        delete w._sweepNote;
      });
    });
  });

  return raw;
}

export function getActiveScene() {
  return state.config.scenes.find((s) => s.id === state.config.activeSceneId) || state.config.scenes[0];
}

export function getActivePage() {
  const scene = getActiveScene();
  if (!scene.pages.length) {
    scene.pages.push({ id: uid(), name: 'Página 1', widgets: [] });
  }
  const idx = Math.min(Math.max(0, scene.activePageIndex || 0), scene.pages.length - 1);
  scene.activePageIndex = idx;
  return scene.pages[idx];
}

export function getSelectedWidget() {
  return getActivePage().widgets.find((w) => w.id === state.selectedWidgetId) || null;
}

export function isWidgetBeingTouched(widgetId) {
  for (const session of state.activePointers.values()) {
    if (session.widget?.id === widgetId) return true;
  }
  return false;
}

export function scheduleSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    platform.saveConfig(state.config);
  }, 300);
}