/**
 * Procedural audio: every sound in BLIND SHOT is synthesised at runtime with the Web Audio
 * API, so all audio is original and the download stays tiny.
 *
 * The gunshot is layered: sharp noise transient + sub "thump" pitch drop + mid body +
 * mechanical clack, through a soft clipper and a generated room reverb.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private drone: { stop: () => void } | null = null;
  private hum: { gain: GainNode; stop: () => void } | null = null;
  private volumes = { master: 0.8, sfx: 0.9, music: 0.5 };

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (!this.ctx) this.init();
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setVolumes(v: { master: number; sfx: number; music: number }): void {
    this.volumes = { ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(v.music, t, 0.05);
  }

  // --- Sounds ----------------------------------------------------------------

  /** The big one. `pan` -1..1, `distance` in metres, `delay` seconds. */
  gunshot(pan = 0, distance = 6, delay = 0, loudness = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const att = Math.max(0.35, 1 - distance / 40) * loudness;

    const out = ctx.createGain();
    out.gain.value = att;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    out.connect(clip).connect(panner);
    panner.connect(this.sfx);
    panner.connect(this.reverbSend);

    // 1. Crack: bright noise transient.
    this.noiseBurst(out, t, 0.09, { type: 'highpass', freq: 1800 }, 1.4, 0.0015);
    // 2. Body: mid noise.
    this.noiseBurst(out, t, 0.32, { type: 'bandpass', freq: 650, q: 0.7 }, 1.1, 0.002);
    // 3. Thump: sine pitch drop.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(160, t);
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(1.6, t + 0.004);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    sub.connect(subGain).connect(out);
    sub.start(t);
    sub.stop(t + 0.45);
    // 4. Mechanical clack (hammer / drum).
    const clack = ctx.createOscillator();
    clack.type = 'square';
    clack.frequency.setValueAtTime(2300, t + 0.03);
    clack.frequency.exponentialRampToValueAtTime(900, t + 0.06);
    const clackGain = ctx.createGain();
    clackGain.gain.setValueAtTime(0, t);
    clackGain.gain.setValueAtTime(0.18, t + 0.03);
    clackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    clack.connect(clackGain).connect(out);
    clack.start(t);
    clack.stop(t + 0.1);
    // 5. Tail: low rumble.
    this.noiseBurst(out, t + 0.02, 0.9, { type: 'lowpass', freq: 220 }, 0.9, 0.02);
  }

  countdownBeep(n: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const freq = n > 0 ? 660 + (3 - n) * 110 : 1320;
    this.tone(freq, t, 0.16, 'square', 0.16);
    this.tone(freq * 2, t, 0.08, 'sine', 0.08);
  }

  /** Power-cut "clunk" + falling electrical whine (targets hidden). */
  lightsOff(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.sfx, t, 0.18, { type: 'lowpass', freq: 400 }, 1.2, 0.002);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.62);
    // Relay clicks.
    for (let i = 0; i < 3; i++) this.noiseBurst(this.sfx, t + 0.05 + i * 0.07, 0.02, { type: 'highpass', freq: 3000 }, 0.4, 0.001);
  }

  /** Two-tone warning before the lights go out. */
  warning(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(880, t, 0.12, 'square', 0.12);
    this.tone(587, t + 0.13, 0.18, 'square', 0.12);
  }

  metalImpact(pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    for (const [f, a] of [
      [2140, 0.07],
      [3380, 0.05],
      [5210, 0.03],
    ] as const) {
      this.tone(f * (0.95 + Math.random() * 0.1), t, 0.35, 'sine', a, p);
    }
    this.noiseBurst(p, t, 0.05, { type: 'highpass', freq: 2500 }, 0.5, 0.001);
  }

  bodyHit(pan = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.sfx);
    this.noiseBurst(p, t, 0.16, { type: 'lowpass', freq: 600 }, 1.2, 0.003);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.2);
    // Cartoon "boing" squeak.
    const s = ctx.createOscillator();
    s.type = 'triangle';
    s.frequency.setValueAtTime(700, t + 0.04);
    s.frequency.exponentialRampToValueAtTime(260, t + 0.22);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0, t);
    sg.gain.setValueAtTime(0.08, t + 0.04);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    s.connect(sg).connect(p);
    s.start(t);
    s.stop(t + 0.26);
  }

  thud(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseBurst(this.sfx, ctx.currentTime, 0.12, { type: 'lowpass', freq: 300 }, 0.6, 0.004);
  }

  uiClick(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(520, t, 0.05, 'square', 0.06);
    this.noiseBurst(this.sfx, t, 0.02, { type: 'highpass', freq: 2000 }, 0.25, 0.001);
  }

  uiHover(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.tone(980, ctx.currentTime, 0.03, 'sine', 0.025);
  }

  whoosh(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseBurst(this.sfx, ctx.currentTime, 0.35, { type: 'bandpass', freq: 900, q: 1.2 }, 0.35, 0.12);
  }

  victory(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.11, 0.3, 'square', 0.07));
    this.tone(1046, t + 0.44, 0.7, 'triangle', 0.1);
  }

  defeat(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [392, 330, 262].forEach((f, i) => this.tone(f, t + i * 0.16, 0.35, 'triangle', 0.08));
  }

  /** Low industrial ambience (menu + rounds). */
  startAmbience(): void {
    const ctx = this.ctx;
    if (!ctx || this.drone) return;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.16, ctx.currentTime, 1.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const oscs = [55, 55.4, 82.6].map((freq) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.connect(f);
      o.start();
      return o;
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 60;
    lfo.connect(lfoGain).connect(f.frequency);
    lfo.start();
    f.connect(g).connect(this.music);
    this.drone = {
      stop: () => {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => {
          for (const o of oscs) o.stop();
          lfo.stop();
        }, 1500);
      },
    };
  }

  stopAmbience(): void {
    this.drone?.stop();
    this.drone = null;
  }

  /** Subtle laser hum during the visible phase. */
  setLaserHum(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.hum) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 118;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 4;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.035, ctx.currentTime, 0.2);
      o.connect(f).connect(gain).connect(this.sfx);
      o.start();
      this.hum = {
        gain,
        stop: () => {
          gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          o.stop(ctx.currentTime + 0.3);
        },
      };
    } else if (!on && this.hum) {
      this.hum.stop();
      this.hum = null;
    }
  }

  /** Heartbeat used during the blind phase. */
  heartbeat(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [dt, a] of [
      [0, 0.5],
      [0.18, 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, t + dt);
      o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + dt);
      g.gain.linearRampToValueAtTime(a, t + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + dt + 0.16);
      o.connect(g).connect(this.sfx);
      o.start(t + dt);
      o.stop(t + dt + 0.2);
    }
  }

  // --- Internals ---------------------------------------------------------------

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.music.connect(this.master);
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.3, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.sfx);
    this.setVolumes(this.volumes);
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  private noiseBurst(
    dest: AudioNode,
    t: number,
    dur: number,
    filter: { type: BiquadFilterType; freq: number; q?: number },
    amp: number,
    attack: number,
  ): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = filter.type;
    f.frequency.value = filter.freq;
    if (filter.q !== undefined) f.Q.value = filter.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, amp: number, dest?: AudioNode): void {
    const ctx = this.ctx as AudioContext;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

let clipCurve: Float32Array<ArrayBuffer> | null = null;
function softClipCurve(): Float32Array<ArrayBuffer> {
  if (clipCurve) return clipCurve;
  const n = 1024;
  clipCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    clipCurve[i] = Math.tanh(x * 2.2);
  }
  return clipCurve;
}

export const audio = new AudioEngine();
