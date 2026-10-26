import { midiNoteToName } from './constants.js';
import { state, getActiveScene, getRuntime } from './state.js';
import { sendOscRaw, flashTxMonitor } from './network.js';
import { hwMidi } from './webMidi.js';

export function computeScaledInt(widget, norm = widget.normValue) {
  const raw = widget.min + norm * (widget.max - widget.min);
  const limit = widget.msgType === 'pitch' ? 16383 : 127;
  return Math.max(0, Math.min(limit, Math.round(raw)));
}

export function formatWidgetReadout(widget) {
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

function getTransportFlags() {
  const mode = state.config?.midi?.transport || 'udp';
  return {
    useUdp: mode === 'udp' || mode === 'both',
    useHwMidi: mode === 'midi' || mode === 'both'
  };
}

export function dispatchWidgetMessage(widget, phase = 'move') {
  const rt = getRuntime(widget);
  const ch = Math.max(1, Math.min(16, Number(widget.channel) || 1));
  const chIndex = ch - 1;
  const valInt = computeScaledInt(widget);
  const isToggle = widget.type === 'toggle';
  const forceSend = phase === 'down' && (isToggle || widget.type === 'pad');
  const { useUdp, useHwMidi } = getTransportFlags();

  if (widget.msgType === 'cc') {
    if (!forceSend && phase !== 'up' && rt.lastSent === valInt) return;
    rt.lastSent = valInt;
    const stateTag = isToggle ? (widget.normValue > 0.5 ? ' (ON)' : ' (OFF)') : '';
    const label = `Ch${ch} CC${widget.midiNum} → ${valInt}${stateTag}`;

    if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/cc/${widget.midiNum}`, [{ type: 'i', value: valInt }], label);
    if (useHwMidi) {
      hwMidi.sendCC(ch, widget.midiNum, valInt);
      if (!useUdp) flashTxMonitor(`MIDI ${label}`);
    }
  } else if (widget.msgType === 'note') {
    if (isToggle) {
      const isOn = widget.normValue > 0.5;
      const vel = isOn ? Math.max(1, Math.min(127, Math.round(widget.max || 100))) : 0;
      rt.lastSent = vel;
      const label = `Ch${ch} ${midiNoteToName(widget.midiNum)} ${isOn ? `ON(${vel})` : 'OFF'}`;

      if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${widget.midiNum}`, [{ type: 'i', value: vel }], label);
      if (useHwMidi) {
        hwMidi.sendNote(ch, widget.midiNum, vel);
        if (!useUdp) flashTxMonitor(`MIDI ${label}`);
      }
      return;
    }

    const mode = widget.noteBehavior || 'latch';
    if (mode === 'latch') {
      if (!forceSend && rt.lastSent === valInt) return;
      rt.lastSent = valInt;
      const label = `Ch${ch} ${midiNoteToName(widget.midiNum)} → ${valInt}`;

      if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${widget.midiNum}`, [{ type: 'i', value: valInt }], label);
      if (useHwMidi) {
        hwMidi.sendNote(ch, widget.midiNum, valInt);
        if (!useUdp) flashTxMonitor(`MIDI ${label}`);
      }
    } else if (mode === 'gate') {
      if (phase === 'up') {
        rt.lastSent = 0;
        const label = `Ch${ch} ${midiNoteToName(widget.midiNum)} OFF`;
        if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${widget.midiNum}`, [{ type: 'i', value: 0 }], label);
        if (useHwMidi) {
          hwMidi.sendNote(ch, widget.midiNum, 0);
          if (!useUdp) flashTxMonitor(`MIDI ${label}`);
        }
      } else {
        const vel = Math.max(1, valInt);
        if (phase === 'move' && rt.lastSent === vel) return;
        rt.lastSent = vel;
        const label = `Ch${ch} ${midiNoteToName(widget.midiNum)} ON(${vel})`;
        if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${widget.midiNum}`, [{ type: 'i', value: vel }], label);
        if (useHwMidi) {
          hwMidi.sendNote(ch, widget.midiNum, vel);
          if (!useUdp) flashTxMonitor(`MIDI ${label}`);
        }
      }
    } else if (mode === 'sweep') {
      if (phase === 'up') {
        if (rt.sweepNote != null) {
          if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${rt.sweepNote}`, [{ type: 'i', value: 0 }], 'Sweep OFF');
          if (useHwMidi) {
            hwMidi.sendNote(ch, rt.sweepNote, 0);
            if (!useUdp) flashTxMonitor('MIDI Sweep OFF');
          }
          rt.sweepNote = null;
        }
      } else if (valInt !== rt.sweepNote) {
        if (rt.sweepNote != null) {
          if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${rt.sweepNote}`, [{ type: 'i', value: 0 }]);
          if (useHwMidi) hwMidi.sendNote(ch, rt.sweepNote, 0);
        }
        rt.sweepNote = valInt;
        const label = `Ch${ch} Gliss ${midiNoteToName(valInt)}`;
        if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/note/${valInt}`, [{ type: 'i', value: 100 }], label);
        if (useHwMidi) {
          hwMidi.sendNote(ch, valInt, 100);
          if (!useUdp) flashTxMonitor(`MIDI ${label}`);
        }
      }
    }
  } else if (widget.msgType === 'program') {
    if (!forceSend && rt.lastSent === valInt) return;
    rt.lastSent = valInt;
    const label = `Ch${ch} Prog ${valInt}`;
    if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/program`, [{ type: 'i', value: valInt }], label);
    if (useHwMidi) {
      hwMidi.sendProgram(ch, valInt);
      if (!useUdp) flashTxMonitor(`MIDI ${label}`);
    }
  } else if (widget.msgType === 'pitch') {
    if (!forceSend && rt.lastSent === valInt) return;
    rt.lastSent = valInt;
    const label = `Ch${ch} Pitch ${valInt}`;
    if (useUdp) sendOscRaw(`/vkb_midi/${chIndex}/pitch`, [{ type: 'i', value: valInt }], label);
    if (useHwMidi) {
      hwMidi.sendPitchBend(ch, valInt);
      if (!useUdp) flashTxMonitor(`MIDI ${label}`);
    }
  } else if (widget.msgType === 'osc') {
    // Las rutas OSC nativas (/track/1/volume, etc.) siempre viajan por el motor OSC UDP
    const addr = widget.oscAddress || '/track/1/mute';
    if (widget.oscType === 'i') {
      if (!forceSend && rt.lastSent === valInt) return;
      rt.lastSent = valInt;
      sendOscRaw(addr, [{ type: 'i', value: valInt }], `${addr} → ${valInt}`);
    } else {
      const fVal = Number(widget.normValue.toFixed(3));
      if (!forceSend && rt.lastSent === fVal) return;
      rt.lastSent = fVal;
      sendOscRaw(addr, [{ type: 'f', value: fVal }], `${addr} → ${fVal}`);
    }
  }
}

export function triggerMidiPanic() {
  const { useUdp, useHwMidi } = getTransportFlags();

  if (useUdp) {
    for (let ch = 0; ch < 16; ch++) {
      sendOscRaw(`/vkb_midi/${ch}/cc/123`, [{ type: 'i', value: 0 }], 'PANIC: All Notes Off');
    }
  }
  if (useHwMidi) {
    hwMidi.sendPanic();
    if (!useUdp) flashTxMonitor('MIDI PANIC: All Notes Off');
  }

  getActiveScene().pages.forEach((p) =>
    p.widgets.forEach((w) => {
      if (w.msgType === 'note') {
        const ch = Math.max(1, Math.min(16, Number(w.channel) || 1));
        if (useUdp) sendOscRaw(`/vkb_midi/${ch - 1}/note/${w.midiNum}`, [{ type: 'i', value: 0 }], 'PANIC: Note Off');
        if (useHwMidi) hwMidi.sendNote(ch, w.midiNum, 0);
        w.normValue = 0;
        const rt = getRuntime(w);
        rt.lastSent = 0;
        rt.sweepNote = null;
      }
    })
  );
}