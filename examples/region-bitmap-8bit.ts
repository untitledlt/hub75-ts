import { HUB75, rgb332 } from '../src/api.js';

const DEFAULT_IP = '10.0.0.78';
const DEFAULT_PORT = 1337;

const api = new HUB75({ ip: DEFAULT_IP, port: DEFAULT_PORT });

(async () => {
  try {
    api.clear();

    // Create a beautiful 64x64 circular rainbow gradient
    // Since max payload is 251 pixels, we'll send it in strips of 3 rows (64*3=192 pixels)
    const centerX = 32;
    const centerY = 32;

    // Draw in horizontal strips to maximize efficiency
    for (let stripY = 0; stripY < 64; stripY += 3) {
      const stripHeight = Math.min(3, 64 - stripY);
      const stripPixels = Buffer.alloc(64 * stripHeight);

      for (let y = 0; y < stripHeight; y++) {
        for (let x = 0; x < 64; x++) {
          const actualY = stripY + y;

          // Calculate distance from center
          const dx = x - centerX;
          const dy = actualY - centerY;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx);

          // Create rainbow based on angle and distance
          const hue = (angle + Math.PI) / (2 * Math.PI);
          const brightness = Math.max(0, 1 - distance / 45);

          const r = Math.floor(255 * brightness * (Math.sin(hue * Math.PI * 2) * 0.5 + 0.5));
          const g = Math.floor(
            255 * brightness * (Math.sin((hue + 0.33) * Math.PI * 2) * 0.5 + 0.5)
          );
          const b = Math.floor(
            255 * brightness * (Math.sin((hue + 0.67) * Math.PI * 2) * 0.5 + 0.5)
          );

          stripPixels[y * 64 + x] = rgb332(r, g, b);
        }
      }

      api.regionBitmap8Bit(0, stripY, 64, stripHeight, stripPixels);
    }

    await api.send();
  } finally {
    setTimeout(() => api.close(), 50);
  }
})();
