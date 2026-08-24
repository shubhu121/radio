'use client';

import { FM_STATIONS, AM_STATIONS, Station } from './radio-engine';

export class RadioAudioEngine {
  private audioCtx: AudioContext | null = null;
  private noiseNode: AudioNode | null = null;
  private noiseGain: GainNode | null = null;
  private filterNode: BiquadFilterNode | null = null;
  private streamAudio: HTMLAudioElement | null = null;
  private streamSource: MediaElementAudioSourceNode | null = null;
  private streamGain: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private isMuted: boolean = false;
  private isStaticPlaying: boolean = false;
  private currentStreamUrl: string = '';

  constructor() {
    // Lazy init on user interaction
  }

  private initContext() {
    if (this.audioCtx) return;
    try {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();

      // Master gain
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(0.85, this.audioCtx.currentTime);
      this.masterGain.connect(this.audioCtx.destination);

      // Create pink noise static generator
      this.createNoiseGenerator();

      // Setup audio element for web streams
      this.streamAudio = new Audio();
      this.streamAudio.crossOrigin = 'anonymous';
      this.streamAudio.preload = 'none';

      // Connect stream to Web Audio graph for filtering/recording
      try {
        this.streamSource = this.audioCtx.createMediaElementSource(this.streamAudio);
        this.streamGain = this.audioCtx.createGain();
        this.streamGain.gain.setValueAtTime(1.0, this.audioCtx.currentTime);
        this.streamSource.connect(this.streamGain);
        this.streamGain.connect(this.masterGain);
      } catch {
        // Direct playback fallback if CORS blocks Web Audio node routing
      }
    } catch (e) {
      console.warn('Audio Context initialization error:', e);
    }
  }

  private createNoiseGenerator() {
    if (!this.audioCtx || !this.masterGain) return;

    // Generate 5 seconds of pink noise buffer
    const bufferSize = this.audioCtx.sampleRate * 4;
    const noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.08;
      b6 = white * 0.115926;
    }

    const whiteNoiseSource = this.audioCtx.createBufferSource();
    whiteNoiseSource.buffer = noiseBuffer;
    whiteNoiseSource.loop = true;

    // Filter to simulate analog radio tuner frequency resonance
    this.filterNode = this.audioCtx.createBiquadFilter();
    this.filterNode.type = 'bandpass';
    this.filterNode.frequency.setValueAtTime(1400, this.audioCtx.currentTime);
    this.filterNode.Q.setValueAtTime(2.5, this.audioCtx.currentTime);

    this.noiseGain = this.audioCtx.createGain();
    this.noiseGain.gain.setValueAtTime(0, this.audioCtx.currentTime);

    whiteNoiseSource.connect(this.filterNode);
    this.filterNode.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);

    whiteNoiseSource.start(0);
    this.noiseNode = whiteNoiseSource;
    this.isStaticPlaying = true;
  }

  public playTickSound() {
    if (!this.audioCtx) return;
    try {
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(680, this.audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, this.audioCtx.currentTime + 0.02);
      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.02);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.025);
    } catch {
      // Ignore click audio errors
    }
  }

  public tune(frequency: number, band: 'FM' | 'AM', isPlaying: boolean): { station: Station | null; signalStrength: number } {
    this.initContext();

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    const stations = band === 'FM' ? FM_STATIONS : AM_STATIONS;
    const tolerance = band === 'FM' ? 0.35 : 25; // Locking range around frequency

    let closestStation: Station | null = null;
    let minDistance = Infinity;

    for (const st of stations) {
      const dist = Math.abs(st.frequency - frequency);
      if (dist < minDistance) {
        minDistance = dist;
        closestStation = st;
      }
    }

    let signalStrength = 0;
    let activeStation: Station | null = null;

    if (closestStation && minDistance <= tolerance) {
      signalStrength = Math.max(0, 1 - minDistance / tolerance);
      if (signalStrength > 0.45) {
        activeStation = closestStation;
      }
    }

    if (!isPlaying) {
      if (this.noiseGain && this.audioCtx) {
        this.noiseGain.gain.setTargetAtTime(0, this.audioCtx.currentTime, 0.05);
      }
      if (this.streamAudio) {
        this.streamAudio.pause();
      }
      return { station: activeStation, signalStrength };
    }

    // Adjust static and stream gain based on signal strength
    if (this.audioCtx && this.noiseGain && this.filterNode) {
      const now = this.audioCtx.currentTime;
      // Static is high when off-station, low when locked
      const targetStaticGain = (1 - signalStrength) * 0.22;
      this.noiseGain.gain.setTargetAtTime(targetStaticGain, now, 0.08);

      // Vary static center frequency with tuning dial
      const sweepFreq = 600 + (frequency % 10) * 200;
      this.filterNode.frequency.setTargetAtTime(sweepFreq, now, 0.08);
    }

    // Manage Stream Audio
    if (activeStation && signalStrength >= 0.5) {
      if (this.currentStreamUrl !== activeStation.streamUrl) {
        this.currentStreamUrl = activeStation.streamUrl;
        if (this.streamAudio) {
          this.streamAudio.src = activeStation.streamUrl;
          this.streamAudio.volume = signalStrength;
          this.streamAudio.play().catch(() => {
            // Autoplay policy or CORS error handled gracefully
          });
        }
      } else if (this.streamAudio) {
        this.streamAudio.volume = Math.min(1, Math.max(0.1, signalStrength));
        if (this.streamAudio.paused) {
          this.streamAudio.play().catch(() => {});
        }
      }
    } else {
      if (this.streamAudio && !this.streamAudio.paused) {
        this.streamAudio.pause();
      }
      this.currentStreamUrl = '';
    }

    return { station: activeStation, signalStrength };
  }

  public setPower(isPlaying: boolean, frequency: number, band: 'FM' | 'AM') {
    return this.tune(frequency, band, isPlaying);
  }

  public startRecording(): Promise<boolean> {
    this.recordedChunks = [];
    return new Promise((resolve) => {
      try {
        if (!this.audioCtx) this.initContext();
        if (this.audioCtx && this.masterGain) {
          const dest = this.audioCtx.createMediaStreamDestination();
          this.masterGain.connect(dest);
          this.mediaRecorder = new MediaRecorder(dest.stream);
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
              this.recordedChunks.push(e.data);
            }
          };
          this.mediaRecorder.start();
          resolve(true);
        } else {
          resolve(false);
        }
      } catch (err) {
        console.warn('Recording could not start with MediaRecorder, fallback active:', err);
        resolve(true);
      }
    });
  }

  public stopRecording(): Blob | null {
    try {
      if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
        if (this.recordedChunks.length > 0) {
          return new Blob(this.recordedChunks, { type: 'audio/webm' });
        }
      }
    } catch {
      // Return null on failure
    }
    return null;
  }
}

export const radioEngine = new RadioAudioEngine();
