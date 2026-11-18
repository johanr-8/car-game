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
