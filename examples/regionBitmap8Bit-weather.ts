import { createReadStream } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { HUB75, rgb332 } from '../src/api.js';
import { ip, port } from './config.js';

// const DEFAULT_IMAGE = path.join('examples', 'cloud-sun.png');
const DEFAULT_IMAGE = path.join('examples', 'weather.png');
const MAX_PIXELS_PER_CHUNK = 251; // Maximum payload size for regionBitmap8Bit

async function loadPng(file: string) {
  return await new Promise<PNG>((resolve, reject) => {
    createReadStream(file)
      .pipe(new PNG())
      .on('parsed', function parsed(this: PNG) {
        resolve(this)....     etgguy7
      })
      .on('error', reject);
  });
}

async function main() {
  const imagePath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_IMAGE);

  if (Number.isNaN(port)) {
    throw new Error(`Invalid HUB75_PORT value: ${port}`);
  }

  console.log(`Reading ${imagePath}`);
  const png = await loadPng(imagePath);
  console.log(`Image dimensions: ${png.width}x${png.height}`);

  const api = new HUB75({ ip, port });

  try {
    api.clear();
    api.setBrightness(30);

    // Calculate how many rows we can send per chunk
    // To stay under MAX_PIXELS_PER_CHUNK limit
    const rowsPerChunk = Math.floor(MAX_PIXELS_PER_CHUNK / png.width);

    if (rowsPerChunk === 0) {
      throw new Error(
        `Image width ${png.width} exceeds maximum chunk size ${MAX_PIXELS_PER_CHUNK}`
      );
    }

    console.log(`Sending image in chunks of ${rowsPerChunk} rows...`);

    // Send the image in horizontal strips
    for (let startY = 0; startY < png.height; startY += rowsPerChunk) {
      const stripHeight = Math.min(rowsPerChunk, png.height - startY);
      const stripPixels = Buffer.alloc(png.width * stripHeight);

      // Convert pixels from RGBA to RGB332
      for (let y = 0; y < stripHeight; y++) {
        for (let x = 0; x < png.width; x++) {
          const pngIndex = (png.width * (startY + y) + x) << 2;
          const r = png.data[pngIndex];
          const g = png.data[pngIndex + 1];
          const b = png.data[pngIndex + 2];
          const a = png.data[pngIndex + 3];

          // Handle transparency by blending with black background
          const alpha = a / 255;
          const blendedR = Math.floor(r * alpha);
          const blendedG = Math.floor(g * alpha);
          const blendedB = Math.floor(b * alpha);

          stripPixels[y * png.width + x] = rgb332(blendedR, blendedG, blendedB);
        }
      }

      api.regionBitmap8Bit(0, startY, png.width, stripHeight, stripPixels);
    }

    console.log('Sending to display...');
    await api.send();
    console.log('Done!');
  } finally {
    setTimeout(() => api.close(), 50);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
