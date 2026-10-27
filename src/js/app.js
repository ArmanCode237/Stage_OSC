import { uid } from './constants.js';
import { platform } from './platform.js';
import {
  state, $, normalizeConfig, getActiveScene, getActivePage,
  getSelectedWidget, isWidgetBeingTouched, scheduleSave
} from './state.js';
import { flashTxMonitor, applyRxConfiguration, openNetworkModal, bindNetworkEvents } from './network.js';
import { initWebMidi, openMidiModal, bindMidiModalEvents } from './webMidi.js';
import { triggerMidiPanic } from './midiRouter.js';
import { createWidgetData, buildWidgetElement, updateWidgetVisuals } from './widgets.js';
import {
  showDialog, openInspector, closeInspector,
  syncInspectorGeometry, bindInspectorInputs, initContextMenu
} from './inspector.js';
import {
  applyAppearance, updateStageBounds, stepCanvasZoom,
  openAppearanceModal, bindAppearanceEvents
} from './appearance.js';

const widgetCallbacks = {
  onOpenInspector: (w) => openInspector(w),
  onGeometryChange: (w) => syncInspectorGeometry(w),
  onDragEnd: () => updateStageBounds()
};

function setZenMode(enabled) {
  state.zenMode = Boolean(enabled);
  if (state.zenMode && state.editMode) {
    state.editMode = false;
    closeInspector();
  }
  $('topbar').classList.toggle('hidden', state.zenMode);
  $('btn-exit-zen').classList.toggle('hidden', !state.zenMode);
  renderAll();
}

function renderAll() {
  const scene = getActiveScene();
  const page = getActivePage();

  $('scene-select').innerHTML = state.config.scenes
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
  $('btn-toggle-edit').textContent = state.editMode ? '✓ Live' : '✎ Editar';
  $('btn-toggle-edit').classList.toggle('editing-on', state.editMode);

  const stage = $('canvas-stage');
  stage.innerHTML = '';
  page.widgets.forEach((w) => {
    stage.appendChild(buildWidgetElement(w, widgetCallbacks));
  });

  updateStageBounds();

  if (state.inspectorOpen && !getSelectedWidget()) {
    closeInspector();
  }
}

function addNewWidget(type, pos = null) {
  const page = getActivePage();
  const newW = createWidgetData(type, page.widgets.length, pos);
  page.widgets.push(newW);
  renderAll();
  openInspector(newW);
  scheduleSave();
}

function renderScenesModal() {
  const list = $('scenes-list');
  list.innerHTML = '';
  state.config.scenes.forEach((sc) => {
    const row = document.createElement('div');
    row.className = `scene-item ${sc.id === state.config.activeSceneId ? 'active' : ''}`;
    row.innerHTML = `
      <div>
        <strong>${sc.name}</strong>
        <small style="color:var(--muted);display:block;margin-top:2px;font-size:11px">${sc.pages.length} página(s)</small>
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

function handleIncomingOscPackets(packets) {
  const activePage = getActivePage();
  for (const pkt of packets) {
    if (!pkt.args || !pkt.args.length) continue;
    const rawVal = Number(pkt.args[0]);
    if (Number.isNaN(rawVal)) continue;

    getActiveScene().pages.forEach((p) => {
      p.widgets.forEach((w) => {
        if (w.msgType !== 'osc' || w.oscAddress !== pkt.address) return;
        if (isWidgetBeingTouched(w.id)) return;

        if (w.oscType === 'i') {
          const span = (w.max - w.min) || 1;
          w.normValue = Math.max(0, Math.min(1, (rawVal - w.min) / span));
        } else {
          w.normValue = Math.max(0, Math.min(1, rawVal));
        }

        if (p.id === activePage.id) {
          updateWidgetVisuals(w);
        }
        flashTxMonitor(`RX ${pkt.address}`, true);
      });
    });
  }
}

async function init() {
  const saved = await platform.loadConfig();
  state.config = normalizeConfig(saved);

  applyAppearance();
  bindAppearanceEvents();
  bindInspectorInputs(widgetCallbacks, renderAll);
  bindNetworkEvents(handleIncomingOscPackets);
  bindMidiModalEvents((msg) => flashTxMonitor(msg, false));
  initContextMenu({
    onOpenInspector: openInspector,
    onFullRender: renderAll,
    onAddWidgetAt: addNewWidget
  });

  await applyRxConfiguration();

  if (state.config.midi.transport !== 'udp') {
    await initWebMidi();
  }

  document.addEventListener('click', (e) => {
    $('context-menu').classList.add('hidden');
    if (!e.target.closest('.sys-menu-wrap')) {
      $('system-dropdown').classList.add('hidden');
    }
  });

  $('canvas-area').addEventListener('pointerdown', (e) => {
    if ((e.target.id === 'canvas-area' || e.target.id === 'canvas-stage') && state.editMode) {
      state.selectedWidgetId = null;
      document.querySelectorAll('.osc-widget').forEach((w) => w.classList.remove('selected-edit'));
    }
  });

  // Menú desplegable de Sistema (☰)
  $('btn-system-menu').onclick = (e) => {
    e.stopPropagation();
    $('system-dropdown').classList.toggle('hidden');
  };
  $('menu-scenes').onclick = () => {
    $('system-dropdown').classList.add('hidden');
    renderScenesModal();
    $('modal-scenes').classList.remove('hidden');
  };
  $('menu-appearance').onclick = () => {
    $('system-dropdown').classList.add('hidden');
    openAppearanceModal();
  };
  $('menu-network').onclick = () => {
    $('system-dropdown').classList.add('hidden');
    openNetworkModal();
  };
  $('menu-midi').onclick = () => {
    $('system-dropdown').classList.add('hidden');
    openMidiModal();
  };
  $('menu-zen').onclick = () => {
    $('system-dropdown').classList.add('hidden');
    setZenMode(true);
  };
  $('menu-fullscreen').onclick = () => {
    $('system-dropdown').classList.add('hidden');
    platform.toggleFullscreen();
  };
  $('btn-exit-zen').onclick = () => setZenMode(false);

  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.key === 'Escape') {
      if (state.zenMode) setZenMode(false);
      closeInspector();
      $('system-dropdown').classList.add('hidden');
      $('modal-appearance').classList.add('hidden');
      $('modal-network').classList.add('hidden');
      $('modal-midi').classList.add('hidden');
      $('modal-scenes').classList.add('hidden');
      $('modal-dialog').classList.add('hidden');
      $('modal-about')?.addEventListener('click', (e) => {
        if (e.target.id === 'modal-about') $('modal-about').classList.add('hidden');
      });
      $('modal-about')?.classList.add('hidden');
    }
    if (e.key === 'Delete' && state.selectedWidgetId && state.editMode) {
      const page = getActivePage();
      page.widgets = page.widgets.filter((w) => w.id !== state.selectedWidgetId);
      state.selectedWidgetId = null;
      closeInspector();
      renderAll();
      scheduleSave();
    }
    if (e.key.toLowerCase() === 'e' && e.ctrlKey) {
      e.preventDefault();
      if (state.zenMode) setZenMode(false);
      state.editMode = !state.editMode;
      if (!state.editMode) closeInspector();
      renderAll();
    }
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
      e.preventDefault();
      stepCanvasZoom(0.05);
    }
    if (e.ctrlKey && e.key === '-') {
      e.preventDefault();
      stepCanvasZoom(-0.05);
    }
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      state.config.appearance.canvasZoom = 1;
      applyAppearance();
      scheduleSave();
    }
    if (e.key === 'F11') {
      e.preventDefault();
      platform.toggleFullscreen();
    }
  });

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
    const name = await showDialog({ title: 'Nueva Página en Escena', defaultValue: `Página ${sc.pages.length + 1}` });
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

  $('btn-panic').onclick = () => {
    triggerMidiPanic();
    renderAll();
    scheduleSave();
  };

  const closeScenes = () => $('modal-scenes').classList.add('hidden');
  $('btn-close-scenes').onclick = closeScenes;
  $('btn-x-scenes').onclick = closeScenes;

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
    platform.exportConfig(JSON.stringify(state.config, null, 2));
  };

  $('btn-import-json').onclick = async () => {
    const raw = await platform.importConfig();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed.scenes && Array.isArray(parsed.scenes)) {
        state.config = normalizeConfig(parsed);
        applyAppearance();
        await applyRxConfiguration();
        if (state.config.midi.transport !== 'udp') await initWebMidi();
        renderAll();
        renderScenesModal();
        scheduleSave();
      }
    } catch (_) {
      await showDialog({ title: 'Error', isPrompt: false, message: 'El archivo JSON no tiene un formato válido.' });
    }
  };

  renderAll();
}

init();