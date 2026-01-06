# hub75-ts

TypeScript helpers for the ESP32 HUB75 UDP protocol described in [../hub75/README.md](../hub75/README.md).

## CLI

Run any firmware command from the shell:

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
- `batch <json | @path>` (send multiple commands in one datagram)

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
