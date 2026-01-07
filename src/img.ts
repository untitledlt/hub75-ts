import { createReadStream } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { Api } from "./api.js";

const DEFAULT_IP = "10.0.0.223";
const DEFAULT_PORT = 1337;
const DEFAULT_IMAGE = path.join("src", "fox.png");
const PANEL_WIDTH = parseEnvInt("HUB75_WIDTH", 64);
const PANEL_HEIGHT = parseEnvInt("HUB75_HEIGHT", 64);
const CHUNK_DELAY_MS = parseEnvInt("HUB75_CHUNK_DELAY_MS", 0);
const imagePath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_IMAGE);

async function loadPng(file: string) {
  return await new Promise<PNG>((resolve, reject) => {
    createReadStream(file)
      .pipe(new PNG())
      .on("parsed", function parsed(this: PNG) {
        resolve(this);
      })
      .on("error", reject);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function rgb888To332(r: number, g: number, b: number) {
  const r3 = r >> 5;
  const g3 = g >> 5;
  const b2 = b >> 6;
  return (r3 << 5) | (g3 << 2) | b2;
}

function parseEnvInt(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment ${name} must be numeric`);
  }
  return parsed;
}

async function main() {
  const ip = process.env.HUB75_IP ?? DEFAULT_IP;
  const portEnv = process.env.HUB75_PORT;
  const port = portEnv ? parseInt(portEnv, 10) : DEFAULT_PORT;
  if (Number.isNaN(port)) {
    throw new Error(`Invalid HUB75_PORT value: ${portEnv}`);
  }

  console.log(`Reading ${imagePath}`);
  const png = await loadPng(imagePath);

  if (!PANEL_WIDTH || !PANEL_HEIGHT) {
    throw new Error("Panel dimensions must be positive");
  }

  const totalPixels = PANEL_WIDTH * PANEL_HEIGHT;
  if (!totalPixels) {
    throw new Error("Target panel area is zero");
  }

  if (totalPixels > 0xffff) {
    throw new Error("Framebuffer offset is 16-bit; reduce HUB75_WIDTH/HEIGHT to <= 65535 pixels");
  }

  const api = new Api({ ip, port });
  api.clockStop();
  api.clear();
  api.setBrightness(30);
  await api.send();
  await delay(50);

  try {
    const pixelBytes = Buffer.alloc(totalPixels);
    for (let y = 0; y < PANEL_HEIGHT; y += 1) {
      const srcY = Math.min(png.height - 1, Math.floor((y * png.height) / PANEL_HEIGHT));
      for (let x = 0; x < PANEL_WIDTH; x += 1) {
        const srcX = Math.min(png.width - 1, Math.floor((x * png.width) / PANEL_WIDTH));
        const pngIndex = (png.width * srcY + srcX) << 2;
        const r = png.data[pngIndex];
        const g = png.data[pngIndex + 1];
        const b = png.data[pngIndex + 2];
        const a = png.data[pngIndex + 3];
        const color = a === 0 ? 0 : rgb888To332(r, g, b);
        const outIndex = PANEL_WIDTH * y + x;
        pixelBytes[outIndex] = color;
      }
    }

    if (png.width !== PANEL_WIDTH || png.height !== PANEL_HEIGHT) {
      console.log(`Resized ${png.width}x${png.height} -> ${PANEL_WIDTH}x${PANEL_HEIGHT}`);
    }

    if (CHUNK_DELAY_MS > 0) {
      console.log(`Inter-chunk delay: ${CHUNK_DELAY_MS}ms`);
    }

    console.log(`Uploading ${PANEL_WIDTH}x${PANEL_HEIGHT} image (${totalPixels} pixels)`);
    await api.uploadFramebuffer(pixelBytes, 180, CHUNK_DELAY_MS);
    console.log(`Image sent to tcp://${ip}:${port}`);
  } finally {
    setTimeout(() => api.close(), 50);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
