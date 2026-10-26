export const SWATCH_COLORS = ['#00e5ff', '#a855f7', '#10b981', '#f59e0b', '#f43f5e', '#3b82f6', '#f8fafc'];

export const CC_NAMES = {
  0: 'Bank Select', 1: 'Modulation', 2: 'Breath', 4: 'Foot Ctrl', 5: 'Portamento Time',
  7: 'Volume', 8: 'Balance', 10: 'Pan', 11: 'Expression', 64: 'Sustain',
  65: 'Portamento', 71: 'Resonance', 72: 'Release', 73: 'Attack',
  74: 'Cutoff', 91: 'Reverb', 93: 'Chorus', 120: 'All Sound Off', 123: 'All Notes Off'
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiNoteToName(n) {
  const safe = Math.max(0, Math.min(127, Math.round(Number(n) || 0)));
  const octave = Math.floor(safe / 12) - 1;
  return `${NOTE_NAMES[safe % 12]}${octave}`;
}

export function uid() {
  return 'w_' + Math.random().toString(36).slice(2, 9);
}

export function createDefaultConfig() {
  return {
    network: {
      host: '192.168.1.50',
      port: 8000,
      rxEnabled: false,
      listenPort: 9000
    },
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