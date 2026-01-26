# hub75-ts

TypeScript helpers for the ESP32 HUB75 protocol described in [../hub75/README.md](../hub75/README.md). Commands are batched and delivered over a TCP socket to minimize packet loss.

## Installation

Install the package straight from GitHub (no publish step required):

```sh
# npm	npm install git+https://github.com/untitledlt/hub75-ts.git
# yarn	yarn add github:untitledlt/hub75-ts
```

After installation you can import the API helpers or run the bundled CLI:

```ts
import { HUB75 } from 'hub75-ts';

const api = new HUB75({ ip: '10.0.0.223', port: 1337 });
api.setColor(255, 255, 255);
api.print('HELLO');
await api.send();
```

When installed as a dependency a `hub75` binary is also available (`npx hub75 ...`).

## CLI

Run any firmware command from the shell (either via `npx hub75` or `yarn tsx src/index.ts` during development):

```sh
HUB75_IP=10.0.0.223 yarn tsx src/index.ts set-color 255 255 255
HUB75_IP=10.0.0.223 yarn tsx src/index.ts set-cursor 2 10
HUB75_IP=10.0.0.223 yarn tsx src/index.ts print HELLO
```

Supported commands mirror the firmware table:

- `clear`
- `set-color r g b`
- `set-cursor x y`
- `set-text-size size`
- `set-text-wrap on|off`
- `fill-screen r g b`
- `set-brightness level`
- `set-font fontId`
- `draw-line x0 y0 x1 y1`
- `draw-rect x y w h`
- `fill-rect x y w h`
- `text-block x y w h size text...`
- `scroll-text-start x y w h size speed [bgR bgG bgB] text...`
- `scroll-text-stop`
- `print text...`
- `clock-start x y size [bgR bgG bgB]`
- `clock-stop`
- `region-bitmap x y w h bitmap|@path` (bitmap is `w*h` zeros/ones, whitespace ignored)
- `region-bitmap-8bit x y w h pixels` (pixels is a JSON array of `w*h` RGB332 bytes or `@path`)
- `batch <json | @path>` (send multiple commands in one TCP batch)

Every `Api` method queues its command. Call `await api.send()` to flush the currently queued commands in a single TCP write. The CLI automatically flushes after each invocation, and `batch` already composes and flushes the provided payload.

## Image uploader

`HUB75_IP=10.0.0.223 yarn img` (or `yarn tsx src/img.ts [path/to.png]`) loads [`src/nature.png`](src/nature.png) by default, converts it to RGB332 bytes (RRR GGG BB), streams them via the `CMD_FRAMEBUFFER_*` commands, and flushes the framebuffer. Supply a custom PNG path as the first argument to push another still image (64×64 recommended). Set `HUB75_WIDTH`/`HUB75_HEIGHT` if your panel resolution differs—the script resizes automatically. If your ESP32 struggles with rapid packets, set `HUB75_CHUNK_DELAY_MS` (e.g., `5`) to pause between framebuffer chunk packets.

Example batch file (`commands.json`):

```json
[
  { "cmd": "setColor", "args": [255, 255, 255] },
  { "cmd": "setCursor", "args": [2, 10] },
  { "cmd": "print", "text": "HELLO" }
]
```

Send it with:

```sh
HUB75_IP=10.0.0.223 yarn tsx src/index.ts batch @commands.json
```

## Clock streamer

`yarn clock` runs [src/clock.ts](src/clock.ts), which sends a HH:MM:SS overlay by composing `SET_COLOR`, `FILL_RECT`, `SET_CURSOR`, and `PRINT` packets every second.

## 8-bit color bitmaps

The `regionBitmap8Bit` API method and `region-bitmap-8bit` CLI command allow you to draw small colored images using the `CMD_REGION_BITMAP_8BIT` (0x75) protocol command. Each pixel uses the RGB332 format (RRR GGG BB), giving you 256 colors per pixel.

### API Usage

```ts
import { HUB75, rgb332 } from 'hub75-ts';

const api = new HUB75({ ip: '10.0.0.223', port: 1337 });

// Create a 4x4 gradient from red to blue
const gradient = Buffer.alloc(16);
for (let row = 0; row < 4; row++) {
  for (let col = 0; col < 4; col++) {
    const r = 255 - col * 64;
    const b = row * 64;
    gradient[row * 4 + col] = rgb332(r, 0, b);
  }
}

api.regionBitmap8Bit(2, 2, 4, 4, gradient);
await api.send();
```

The `rgb332()` helper function converts 8-bit RGB values to the RGB332 format:

```ts
rgb332(255, 0, 0); // Red
rgb332(0, 255, 0); // Green
rgb332(0, 0, 255); // Blue
rgb332(255, 255, 0); // Yellow
```

### CLI Usage

You can also use the CLI with a JSON array of RGB332 pixel values:

```sh
# Draw a 2x2 colored square at position (10, 10)
# Pixels: red, green, blue, yellow
HUB75_IP=10.0.0.223 yarn tsx src/index.ts region-bitmap-8bit 10 10 2 2 '[224,28,3,252]'
```

### Example Script

Run the example with `yarn 8bit` or `yarn tsx examples/region-bitmap-8bit.ts` to see various 8-bit color patterns including gradients, rainbows, and color palettes.

## Development

```sh
yarn install
yarn build
```

`yarn build` compiles the TypeScript sources into `dist/` (with declarations). The build also runs automatically via the `prepare` script so GitHub consumers always receive ready-to-run artifacts.
