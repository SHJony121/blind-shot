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
  private volumes = { master: 0.8, sfx: 0.9, music: 0.5 };
  /** Recorded gunshot samples (public/sfx/gunshot-*.wav, CC0). Synthesis is the fallback. */
  private shotSamples: AudioBuffer[] = [];

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

  /**
   * The big one: an oversized test-pistol "BANG". Layers: clipped noise transient, a
   * resonant low-pass sweep for the boom, a deep sub drop, a hammer clack, and two room
   * slap-back reflections into a long reverb tail. `pan` -1..1, `distance` metres.
   */
  gunshot(pan = 0, distance = 6, delay = 0, loudness = 1): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.shotSamples.length > 0) {
      this.playSample(this.shotSamples, pan, distance, delay, loudness);
      return;
    }
    const t = ctx.currentTime + delay;
    const att = Math.max(0.45, 1 - distance / 60) * loudness;

    const out = ctx.createGain();
    out.gain.value = att;
    const drive = ctx.createWaveShaper();
    drive.curve = softClipCurve();
    drive.oversample = '2x';
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(drive).connect(panner);
    panner.connect(this.sfx);
    panner.connect(this.reverbSend);

    // Room slap-back: two short reflections, darker each time.
    for (const [d, g, f] of [
      [0.055, 0.35, 2400],
      [0.13, 0.22, 1200],
    ] as const) {
      const delayNode = ctx.createDelay(0.3);
      delayNode.delayTime.value = d;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      panner.connect(delayNode).connect(lp).connect(gain).connect(this.sfx);
    }

    // 1. Transient: a hard, bright crack.
    this.noiseBurst(out, t, 0.05, { type: 'highpass', freq: 1200 }, 2.4, 0.0008);
    // 2. Boom: noise through a resonant low-pass sweeping down (the "chunk" of the blast).
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(0, t);
    boomGain.gain.linearRampToValueAtTime(2.2, t + 0.002);
    boomGain.gain.exponentialRampToValueAtTime(0.4, t + 0.12);
    boomGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(lp).connect(boomGain).connect(out);
    src.start(t, Math.random());
    src.stop(t + 0.75);
    // 3. Sub drop: the chest thump.
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(32, t + 0.45);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0, t);
    subGain.gain.linearRampToValueAtTime(2.4, t + 0.004);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    sub.connect(subGain).connect(out);
    sub.start(t);
    sub.stop(t + 0.62);
    // 4. Mechanical: hammer clack right after the shot.
    const clack = ctx.createOscillator();
    clack.type = 'square';
    clack.frequency.setValueAtTime(1900, t + 0.09);
    clack.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    const clackGain = ctx.createGain();
    clackGain.gain.setValueAtTime(0, t);
    clackGain.gain.setValueAtTime(0.12, t + 0.09);
    clackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    clack.connect(clackGain).connect(out);
    clack.start(t);
    clack.stop(t + 0.16);
    // 5. Tail: rumbling decay that rolls around the room.
    this.noiseBurst(out, t + 0.03, 1.4, { type: 'lowpass', freq: 180 }, 1.1, 0.03);
  }

  /** Play one of the recorded takes as-is: full, dry and loud (it is the moment of the round). */
  private playSample(takes: AudioBuffer[], pan: number, _distance: number, delay: number, loudness: number): void {
    const ctx = this.ctx as AudioContext;
    const buf = takes[Math.floor(Math.random() * takes.length)];
    if (!buf) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Tiny variation only: bigger pitch shifts make a real recording sound fake.
    src.playbackRate.value = 0.98 + Math.random() * 0.04;
    const gain = ctx.createGain();
    gain.gain.value = 1.15 * loudness;
    const panner = ctx.createStereoPanner();
    // Mostly centred: the shot should hit both ears hard.
    panner.pan.value = Math.max(-1, Math.min(1, pan)) * 0.4;
    src.connect(gain).connect(panner).connect(this.sfx);
    src.start(t);
  }

  private async loadSamples(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const takes: AudioBuffer[] = [];
    for (let i = 1; i <= 3; i++) {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sfx/gunshot-${i}.wav`);
        if (!res.ok) continue;
        takes.push(await ctx.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // Missing / undecodable file: keep the synthesized gunshot.
      }
    }
    this.shotSamples = takes;
  }

  /** Everyone reappears: rising sweep + bright sting. */
  reveal(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.sfx, t, 0.4, { type: 'bandpass', freq: 2400, q: 0.9 }, 0.35, 0.25);
    this.tone(988, t + 0.02, 0.5, 'triangle', 0.12);
    this.tone(1480, t + 0.02, 0.35, 'sine', 0.06);
  }

  /** FREEZE: a heavy mechanical lock-in. */
  freeze(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(this.sfx, t, 0.08, { type: 'highpass', freq: 2500 }, 0.6, 0.001);
    this.noiseBurst(this.sfx, t + 0.01, 0.35, { type: 'lowpass', freq: 260 }, 1.0, 0.003);
    this.tone(196, t, 0.45, 'square', 0.07);
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
    this.reverb.buffer = this.impulse(2.0, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.sfx);
    this.setVolumes(this.volumes);
    void this.loadSamples();
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
    clipCurve[i] = Math.tanh(x * 3.2);
  }
  return clipCurve;
}

export const audio = new AudioEngine();
