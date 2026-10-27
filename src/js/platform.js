const STORAGE_KEY = 'stage_osc_scenes_v1';

const getNativeUdp = () => window.Capacitor?.Plugins?.StageOscUdp || null;

export const platform = {
  sendOSC(payload) {
    if (window.oscAPI?.sendOSC) {
      window.oscAPI.sendOSC(payload);
    } else {
      getNativeUdp()?.send(payload);
    }
  },

  async configureRX(opts) {
    if (window.oscAPI?.configureRX) {
      return window.oscAPI.configureRX(opts);
    }
    const udp = getNativeUdp();
    if (udp) return udp.configureRX(opts);
    return { ok: false, listening: false };
  },

  onOSCRX(callback) {
    if (window.oscAPI?.onOSCRX) {
      window.oscAPI.onOSCRX(callback);
    } else {
      const udp = getNativeUdp();
      if (udp) {
        udp.removeAllListeners().then(() => {
          udp.addListener('oscRx', (data) => {
            if (data?.packets) callback(data.packets);
          });
        });
      }
    }
  },

  async loadConfig() {
    if (window.oscAPI?.loadConfig) return window.oscAPI.loadConfig();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  },

  async saveConfig(data) {
    if (window.oscAPI?.saveConfig) return window.oscAPI.saveConfig(data);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async exportConfig(jsonStr) {
    if (window.oscAPI?.exportConfig) return window.oscAPI.exportConfig(jsonStr);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mis-escenas-osc.json';
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  },

  async importConfig() {
    if (window.oscAPI?.importConfig) return window.oscAPI.importConfig();
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = () => {
        const file = inp.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      inp.click();
    });
  },

  async toggleFullscreen() {
    if (window.oscAPI?.toggleFullscreen) return window.oscAPI.toggleFullscreen();
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.();
      return true;
    }
    await document.exitFullscreen?.();
    return false;
  },

  async getLocalIPs() {
    if (window.oscAPI?.getLocalIPs) return window.oscAPI.getLocalIPs();
    const udp = getNativeUdp();
    if (udp) {
      const res = await udp.getLocalIPs();
      return res?.ips || [];
    }
    return ['Modo Web'];
  },

  openExternal(url) {
    if (!url) return;
    if (window.oscAPI?.openExternal) {
      window.oscAPI.openExternal(url);
    } else {
      // En Android (Capacitor), window.open con '_system' delega el Intent al navegador móvil predeterminado
      window.open(url, '_system', 'noopener,noreferrer');
    }
  },
};