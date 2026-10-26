import { state, $, scheduleSave } from './state.js';
import { platform } from './platform.js';

export function flashTxMonitor(label, isRx = false) {
  const textEl = $('tx-text');
  const led = $('tx-led');
  if (textEl) textEl.textContent = label;
  if (!led) return;

  led.classList.remove('active', 'rx-active');
  led.classList.add(isRx ? 'rx-active' : 'active');

  clearTimeout(state.ledTimer);
  state.ledTimer = setTimeout(() => {
    led.classList.remove('active', 'rx-active');
  }, 150);
}

export function sendOscRaw(address, args, monitorLabel) {
  const { host, port } = state.config.network;
  platform.sendOSC({ host, port, address, args });
  flashTxMonitor(monitorLabel || address, false);
}

export async function applyRxConfiguration() {
  const { rxEnabled, listenPort } = state.config.network;
  await platform.configureRX({ enabled: rxEnabled, port: listenPort });
}

export async function openNetworkModal() {
  $('net-host').value = state.config.network.host;
  $('net-port').value = state.config.network.port;
  $('net-rx-enabled').checked = Boolean(state.config.network.rxEnabled);
  $('net-listen-port').value = state.config.network.listenPort || 9000;

  const ips = await platform.getLocalIPs();
  $('local-ips-list').textContent = ips.length ? ips.join('  |  ') : 'Sin red activa detectada';
  $('modal-network').classList.remove('hidden');
}

export function bindNetworkEvents(onOscPacketsReceived) {
  const closeNet = () => $('modal-network').classList.add('hidden');

  $('tx-monitor').onclick = openNetworkModal;
  $('btn-close-net').onclick = closeNet;
  $('btn-x-net').onclick = closeNet;

  $('btn-save-net').onclick = async () => {
    state.config.network.host = $('net-host').value.trim() || '127.0.0.1';
    state.config.network.port = Number($('net-port').value) || 8000;
    state.config.network.rxEnabled = $('net-rx-enabled').checked;
    state.config.network.listenPort = Number($('net-listen-port').value) || 9000;
    closeNet();
    await applyRxConfiguration();
    scheduleSave();
  };

  $('btn-test-osc').onclick = () => {
    state.config.network.host = $('net-host').value.trim() || '127.0.0.1';
    state.config.network.port = Number($('net-port').value) || 8000;
    sendOscRaw('/vkb_midi/0/cc/1', [{ type: 'i', value: 100 }], 'Test Ch1 CC1 → 100');
  };

  platform.onOSCRX((packets) => {
    if (typeof onOscPacketsReceived === 'function') {
      onOscPacketsReceived(packets);
    }
  });
}