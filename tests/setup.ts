/**
 * tests/setup.ts
 * Headless environment polyfills for Node/Vitest.
 */
if (typeof document === 'undefined') {
  (globalThis as any).document = {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 512,
          height: 512,
          getContext: () => ({
            fillStyle: '',
            strokeStyle: '',
            lineWidth: 1,
            fillRect: () => {},
            beginPath: () => {},
            arc: () => {},
            fill: () => {},
            stroke: () => {},
            moveTo: () => {},
            lineTo: () => {},
            createRadialGradient: () => ({ addColorStop: () => {} }),
          }),
        };
      }
      return {
        style: {},
        appendChild: () => {},
        addEventListener: () => {},
      };
    },
    body: {
      appendChild: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    hidden: false,
  };
}

if (typeof window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    innerWidth: 1920,
    innerHeight: 1080,
    devicePixelRatio: 1,
  };
}

if (typeof localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => { store[key] = String(val); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

if (typeof (globalThis as any).AudioContext === 'undefined') {
  class MockAudioParam {
    value = 0;
    setValueAtTime(v: number) { this.value = v; return this; }
    setTargetAtTime(v: number) { this.value = v; return this; }
    linearRampToValueAtTime(v: number) { this.value = v; return this; }
    exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  }

  class MockAudioNode {
    connect(target: any) { return target; }
    disconnect() {}
  }

  class MockGainNode extends MockAudioNode {
    gain = new MockAudioParam();
  }

  class MockOscillatorNode extends MockAudioNode {
    type = 'sine';
    frequency = new MockAudioParam();
    detune = new MockAudioParam();
    start() {}
    stop() {}
  }

  class MockBiquadFilterNode extends MockAudioNode {
    type = 'lowpass';
    frequency = new MockAudioParam();
    Q = new MockAudioParam();
  }

  class MockBufferSourceNode extends MockAudioNode {
    buffer: any = null;
    loop = false;
    start() {}
    stop() {}
  }

  class MockAudioContext {
    state = 'running';
    sampleRate = 44100;
    currentTime = 0;
    destination = new MockAudioNode();

    createGain() { return new MockGainNode(); }
    createOscillator() { return new MockOscillatorNode(); }
    createBiquadFilter() { return new MockBiquadFilterNode(); }
    createBuffer(channels: number, length: number, sampleRate: number) {
      return {
        sampleRate,
        length,
        duration: length / sampleRate,
        numberOfChannels: channels,
        getChannelData: () => new Float32Array(length),
      };
    }
    createBufferSource() { return new MockBufferSourceNode(); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }

  (globalThis as any).AudioContext = MockAudioContext;
  (window as any).AudioContext = MockAudioContext;
}
