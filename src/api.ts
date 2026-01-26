import net from 'node:net';
import { Buffer } from 'node:buffer';

type CommandPayload = Buffer | Iterable<number>;

export const CMD = {
  CLEAR: 0x01,
  SET_COLOR: 0x02,
  SET_CURSOR: 0x03,
  SET_TEXT_SIZE: 0x04,
  SET_TEXT_WRAP: 0x05,
  FILL_SCREEN: 0x06,
  SET_BRIGHTNESS: 0x07,
  SET_FONT: 0x08,
  DRAW_LINE: 0x10,
  DRAW_RECT: 0x11,
  FILL_RECT: 0x13,
  PRINT: 0x20,
  CLOCK_START: 0x30,
  CLOCK_STOP: 0x31,
  SCROLL_TEXT_START: 0x40,
  SCROLL_TEXT_STOP: 0x41,
  TEXT_BLOCK: 0x42,
  FRAMEBUFFER_CHUNK: 0x50,
  FRAMEBUFFER_FLUSH: 0x51,
  FRAMEBUFFER_CLEAR: 0x52,
  REGION_BITMAP: 0x74,
  REGION_BITMAP_8BIT: 0x75,
  POLICE_START: 0x70,
  POLICE_STOP: 0x71,
  PROGRESS_START: 0x72,
  PROGRESS_STOP: 0x73,
} as const;

export type CommandId = (typeof CMD)[keyof typeof CMD];

export type IntervalPayloadSize = 2 | 4;
export type RegionBitmapSource = string | Buffer | Iterable<number>;

export interface Command {
  id: CommandId;
  payload?: CommandPayload;
}

export interface HUB75Options {
  ip: string;
  port?: number;
  socket?: net.Socket;
}

export class HUB75 {
  private readonly socket: net.Socket;
  private readonly ready: Promise<void>;
  private sendQueue: Promise<void>;
  private pendingFrames: Buffer[] = [];
  private pendingByteLength = 0;

  constructor({ ip, port = 1337, socket }: HUB75Options) {
    this.socket = socket ?? net.createConnection({ host: ip, port });
    this.socket.setNoDelay(true);

    const isPending = this.socket.pending ?? false;
    this.ready = isPending
      ? new Promise((resolve, reject) => {
          const cleanup = () => {
            this.socket.off('connect', onConnect);
            this.socket.off('error', onError);
          };
          const onConnect = () => {
            cleanup();
            resolve();
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          this.socket.once('connect', onConnect);
          this.socket.once('error', onError);
        })
      : Promise.resolve();

    this.ready.catch((error) => {
      console.error('TCP connection failed', error);
    });

    this.socket.on('error', (error) => {
      console.error('TCP socket error', error);
    });

    this.sendQueue = Promise.resolve();
  }

  clear() {
    this.sendCommand({ id: CMD.CLEAR });
  }

  setColor(r: number, g: number, b: number) {
    this.sendCommand({ id: CMD.SET_COLOR, payload: [r, g, b] });
  }

  setCursor(x: number, y: number) {
    this.sendCommand({ id: CMD.SET_CURSOR, payload: [x, y] });
  }

  setTextSize(size: number) {
    const normalized = Math.max(1, size | 0);
    this.sendCommand({ id: CMD.SET_TEXT_SIZE, payload: [normalized] });
  }

  setTextWrap(wrap: boolean) {
    this.sendCommand({ id: CMD.SET_TEXT_WRAP, payload: [wrap ? 1 : 0] });
  }

  fillScreen(r: number, g: number, b: number) {
    this.sendCommand({ id: CMD.FILL_SCREEN, payload: [r, g, b] });
  }

  setBrightness(level: number) {
    this.sendCommand({ id: CMD.SET_BRIGHTNESS, payload: [clampByte(level)] });
  }

  setFont(fontId: number) {
    this.sendCommand({ id: CMD.SET_FONT, payload: [clampByte(fontId)] });
  }

  drawLine(x0: number, y0: number, x1: number, y1: number) {
    this.sendCommand({ id: CMD.DRAW_LINE, payload: [x0, y0, x1, y1] });
  }

  drawRect(x: number, y: number, w: number, h: number) {
    this.sendCommand({ id: CMD.DRAW_RECT, payload: [x, y, w, h] });
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.sendCommand({ id: CMD.FILL_RECT, payload: [x, y, w, h] });
  }

  print(text: string | Buffer) {
    const payload = this.encodeTextPayload(text);
    this.sendCommand({ id: CMD.PRINT, payload });
  }

  clockStart(x: number, y: number, size: number, bgColor?: [number, number, number]) {
    const payload = [clampByte(x), clampByte(y), clampByte(Math.max(1, size | 0))];

    if (bgColor) {
      const [r, g, b] = bgColor;
      payload.push(clampByte(r), clampByte(g), clampByte(b));
    }

    this.sendCommand({ id: CMD.CLOCK_START, payload });
  }

  clockStop() {
    this.sendCommand({ id: CMD.CLOCK_STOP });
  }

  policeStart(intervalMs: number, payloadBytes?: IntervalPayloadSize) {
    const payload = createIntervalPayload(intervalMs, payloadBytes);
    this.sendCommand({ id: CMD.POLICE_START, payload });
  }

  policeStop() {
    this.sendCommand({ id: CMD.POLICE_STOP });
  }

  progressStart(
    x: number,
    y: number,
    w: number,
    h: number,
    intervalMs: number,
    payloadBytes?: IntervalPayloadSize
  ) {
    const header = Buffer.from([clampByte(x), clampByte(y), clampByte(w), clampByte(h)]);
    const intervalPayload = createIntervalPayload(intervalMs, payloadBytes);
    this.sendCommand({
      id: CMD.PROGRESS_START,
      payload: Buffer.concat([header, intervalPayload]),
    });
  }

  progressStop() {
    this.sendCommand({ id: CMD.PROGRESS_STOP });
  }

  invalid(byteLength = 8) {
    const normalized = Number.isFinite(byteLength) ? Math.max(1, Math.min(255, byteLength | 0)) : 8;
    const garbage = Buffer.allocUnsafe(normalized);
    for (let i = 0; i < normalized; i += 1) {
      garbage[i] = Math.floor(Math.random() * 0x100);
    }
    this.enqueueFrame(garbage).catch((error) => {
      console.error('Socket send failed', error);
    });
  }

  scrollTextStart(
    x: number,
    y: number,
    w: number,
    h: number,
    size: number,
    speed: number,
    text: string | Buffer,
    bgColor?: [number, number, number]
  ) {
    const body = this.encodeTextPayload(text);
    if (body.length === 0) {
      throw new Error('scrollTextStart requires text payload');
    }

    const headerBytes = [
      clampByte(x),
      clampByte(y),
      clampByte(w),
      clampByte(h),
      clampByte(Math.max(1, size | 0)),
      clampByte(Math.max(1, speed | 0)),
    ];

    if (bgColor) {
      const [r, g, b] = bgColor;
      headerBytes.push(clampByte(r), clampByte(g), clampByte(b));
    }
    const header = Buffer.from(headerBytes);

    this.sendCommand({
      id: CMD.SCROLL_TEXT_START,
      payload: Buffer.concat([header, body]),
    });
  }

  scrollTextStop() {
    this.sendCommand({ id: CMD.SCROLL_TEXT_STOP });
  }

  textBlock(x: number, y: number, w: number, h: number, size: number, text: string | Buffer) {
    const body = this.encodeTextPayload(text);
    if (body.length === 0) {
      throw new Error('textBlock requires text payload');
    }

    const header = Buffer.from([
      clampByte(x),
      clampByte(y),
      clampByte(w),
      clampByte(h),
      clampByte(Math.max(1, size | 0)),
    ]);

    this.sendCommand({
      id: CMD.TEXT_BLOCK,
      payload: Buffer.concat([header, body]),
    });
  }

  regionBitmap(x: number, y: number, w: number, h: number, bitmap: RegionBitmapSource) {
    const payload = createRegionBitmapPayload(x, y, w, h, bitmap);
    this.sendCommand({ id: CMD.REGION_BITMAP, payload });
  }

  regionBitmap8Bit(
    x: number,
    y: number,
    w: number,
    h: number,
    pixels: Buffer | Uint8Array | number[]
  ) {
    const payload = createRegionBitmap8BitPayload(x, y, w, h, pixels);
    this.sendCommand({ id: CMD.REGION_BITMAP_8BIT, payload });
  }

  async framebufferChunk(offset: number, pixelData: Buffer | Uint8Array | number[]) {
    if (offset < 0 || offset > 0xffff) {
      throw new Error('framebufferChunk offset must fit in 16 bits');
    }

    let pixels: Buffer;
    if (Buffer.isBuffer(pixelData)) {
      pixels = pixelData;
    } else if (pixelData instanceof Uint8Array) {
      pixels = Buffer.from(pixelData);
    } else {
      pixels = Buffer.from(pixelData);
    }

    if (pixels.length === 0) {
      throw new Error('framebufferChunk payload must include pixel data');
    }

    if (pixels.length + 2 > 0xff) {
      throw new Error('framebufferChunk payload exceeds single-frame limit (max 253 pixel bytes)');
    }

    const payload = Buffer.allocUnsafe(2 + pixels.length);
    payload[0] = (offset >> 8) & 0xff;
    payload[1] = offset & 0xff;
    pixels.copy(payload, 2);

    await this.sendCommand({ id: CMD.FRAMEBUFFER_CHUNK, payload }, true);
  }

  async framebufferFlush() {
    await this.sendCommand({ id: CMD.FRAMEBUFFER_FLUSH }, true);
  }

  framebufferClear(color?: [number, number, number]) {
    if (!color) {
      this.sendCommand({ id: CMD.FRAMEBUFFER_CLEAR });
      return;
    }
    const payload = color.map((component) => clampByte(component));
    this.sendCommand({ id: CMD.FRAMEBUFFER_CLEAR, payload });
  }

  async uploadFramebuffer(pixels: Buffer, chunkPixels = 180, interChunkDelayMs = 0) {
    if (pixels.length === 0) {
      throw new Error('uploadFramebuffer expects at least one pixel');
    }
    const bytesPerChunk = Math.min(chunkPixels, 0xff - 2);
    if (bytesPerChunk <= 0) {
      throw new Error('chunk size too small');
    }
    let offset = 0;
    for (let cursor = 0; cursor < pixels.length; cursor += bytesPerChunk) {
      const chunk = pixels.subarray(cursor, Math.min(cursor + bytesPerChunk, pixels.length));
      const pixelCount = chunk.length;
      await this.framebufferChunk(offset, chunk);
      offset += pixelCount;
      const hasMore = cursor + bytesPerChunk < pixels.length;
      if (hasMore && interChunkDelayMs > 0) {
        await sleep(interChunkDelayMs);
      }
    }
    await this.framebufferFlush();
  }

  async sendBatch(commands: Command[]) {
    if (commands.length === 0) {
      return;
    }
    await this.send();
    const frames = commands.map((cmd) => this.encodeCommand(cmd));
    const payload = Buffer.concat(frames);
    await this.enqueueFrame(payload);
  }

  async send() {
    if (this.pendingFrames.length === 0) {
      return;
    }
    const frames = this.pendingFrames;
    const totalBytes = this.pendingByteLength;
    this.pendingFrames = [];
    this.pendingByteLength = 0;
    const payload = frames.length === 1 ? frames[0] : Buffer.concat(frames, totalBytes);
    await this.enqueueFrame(payload);
  }

  close() {
    this.socket.end();
  }

  private sendCommand(command: Command, awaitSend = false): Promise<void> | void {
    const frame = this.encodeCommand(command);
    if (awaitSend) {
      return this.flushPendingThenSend(frame);
    }
    this.pendingFrames.push(frame);
    this.pendingByteLength += frame.length;
  }

  private async flushPendingThenSend(frame: Buffer) {
    await this.send();
    await this.enqueueFrame(frame);
  }

  private encodeCommand(command: Command) {
    const payload = this.encodePayload(command.payload);
    if (payload.length > 0xff) {
      throw new Error('Payload too large for single command frame');
    }
    const frame = Buffer.alloc(2 + payload.length);
    frame[0] = command.id & 0xff;
    frame[1] = payload.length;
    payload.copy(frame, 2);
    return frame;
  }

  private enqueueFrame(frame: Buffer): Promise<void> {
    const task = this.sendQueue.then(() => this.dispatchFrame(frame));
    this.sendQueue = task.catch(() => {});
    return task;
  }

  private dispatchFrame(frame: Buffer): Promise<void> {
    return this.ready.then(
      () =>
        new Promise((resolve, reject) => {
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          const cleanup = () => {
            this.socket.off('error', onError);
          };
          this.socket.once('error', onError);
          try {
            this.socket.write(frame, () => {
              cleanup();
              resolve();
            });
          } catch (error) {
            cleanup();
            reject(error as Error);
          }
        })
    );
  }

  private encodePayload(payload?: CommandPayload) {
    if (!payload) {
      return Buffer.alloc(0);
    }

    if (Buffer.isBuffer(payload)) {
      return payload;
    }

    const bytes = Array.from(payload, clampByte);
    return Buffer.from(bytes);
  }

  private encodeTextPayload(text: string | Buffer) {
    if (Buffer.isBuffer(text)) {
      return text;
    }
    const ascii = sanitizeText(text);
    return Buffer.from(ascii, 'ascii');
  }
}

function clampByte(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(0xff, value | 0));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ASCII_SUBSTITUTIONS: Record<string, string> = {
  // German
  '\u00df': 'ss',
  '\u1e9e': 'SS',
  // Nordic and other European
  '\u00c6': 'AE',
  '\u00e6': 'ae',
  '\u0152': 'OE',
  '\u0153': 'oe',
  '\u00d8': 'O',
  '\u00f8': 'o',
  '\u00c5': 'A',
  '\u00e5': 'a',
  '\u0141': 'L',
  '\u0142': 'l',
  '\u0110': 'D',
  '\u0111': 'd',
  '\u00de': 'Th',
  '\u00fe': 'th',
  '\u014a': 'N',
  '\u014b': 'n',
  '\u0126': 'H',
  '\u0127': 'h',
  '\u0132': 'IJ',
  '\u0133': 'ij',
  '\u00d1': 'N',
  '\u00f1': 'n',
  // Lithuanian
  '\u0104': 'A', // Ą
  '\u0105': 'a', // ą
  '\u010c': 'C', // Č
  '\u010d': 'c', // č
  '\u0118': 'E', // Ę
  '\u0119': 'e', // ę
  '\u0116': 'E', // Ė
  '\u0117': 'e', // ė
  '\u012e': 'I', // Į
  '\u012f': 'i', // į
  '\u0160': 'S', // Š
  '\u0161': 's', // š
  '\u0172': 'U', // Ų
  '\u0173': 'u', // ų
  '\u016a': 'U', // Ū
  '\u016b': 'u', // ū
  '\u017d': 'Z', // Ž
  '\u017e': 'z', // ž
  // Whitespace
  '\u00a0': ' ',
  // Quotation marks (smart/curly quotes)
  '\u2018': "'", // ' left single quotation mark
  '\u2019': "'", // ' right single quotation mark
  '\u201a': "'", // ‚ single low-9 quotation mark
  '\u201b': "'", // ‛ single high-reversed-9 quotation mark
  '\u201c': '"', // " left double quotation mark
  '\u201d': '"', // " right double quotation mark
  '\u201e': '"', // „ double low-9 quotation mark
  '\u201f': '"', // ‟ double high-reversed-9 quotation mark
  '\u2032': "'", // ′ prime
  '\u2033': '"', // ″ double prime
};

export function sanitizeText(input: string) {
  if (!input) {
    return '';
  }

  // First substitute known extended characters (Lithuanian, German, Nordic, etc.)
  const substituted = substituteExtendedChars(input);

  // Normalize Unicode (NFKD = decompose characters into base + combining marks)
  const decomposed = substituted.normalize('NFKD');

  // Remove combining diacritical marks
  const withoutMarks = decomposed.replace(/[\u0300-\u036f]/g, '');

  // Strip emoticons and other problematic Unicode ranges
  // Note: Using \u{...} syntax with 'u' flag for code points > U+FFFF
  const withoutEmoticons = withoutMarks
    // Emoticons and symbols (including emoji)
    .replace(/[\u2600-\u26FF]/gu, '') // Miscellaneous Symbols
    .replace(/[\u2700-\u27BF]/gu, '') // Dingbats
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '') // Alchemical Symbols
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '') // Geometric Shapes Extended
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '') // Supplemental Arrows-C
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols and Pictographs
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    .replace(/[\uFE00-\uFE0F]/gu, '') // Variation Selectors
    .replace(/\u200D/gu, ''); // Zero Width Joiner (used in emoji combinations)

  // Keep only printable ASCII and allowed control characters
  let result = '';
  for (const char of withoutEmoticons) {
    const code = char.charCodeAt(0);
    const isPrintableAscii = code >= 0x20 && code <= 0x7e;
    const isControlAllowed = char === '\n' || char === '\r' || char === '\t';
    if (isPrintableAscii || isControlAllowed) {
      result += char;
    }
  }

  return result;
}

function substituteExtendedChars(text: string) {
  let result = '';
  for (const char of text) {
    const replacement = ASCII_SUBSTITUTIONS[char];
    result += replacement ?? char;
  }
  return result;
}

export function createIntervalPayload(intervalMs: number, payloadBytes?: IntervalPayloadSize) {
  const normalized = normalizeIntervalMs(intervalMs);
  const width = payloadBytes ?? (normalized > 0xffff ? 4 : 2);
  if (width !== 2 && width !== 4) {
    throw new Error('Interval payload must be 2 or 4 bytes');
  }

  if (width === 2) {
    if (normalized > 0xffff) {
      throw new Error('Interval exceeds 16-bit; request payloadBytes=4');
    }
    const payload = Buffer.allocUnsafe(2);
    payload[0] = (normalized >> 8) & 0xff;
    payload[1] = normalized & 0xff;
    return payload;
  }

  const payload = Buffer.allocUnsafe(4);
  const truncated = Math.min(normalized, 0xffffffff);
  payload.writeUInt32BE(truncated >>> 0);
  return payload;
}

export function createRegionBitmapPayload(
  x: number,
  y: number,
  w: number,
  h: number,
  bitmap: RegionBitmapSource
) {
  const xByte = normalizeCoordinate(x, 'x');
  const yByte = normalizeCoordinate(y, 'y');
  const width = normalizeSize(w, 'width');
  const height = normalizeSize(h, 'height');
  const expectedPixels = width * height;
  const headerBytes = 4;
  if (expectedPixels > 0xff - headerBytes) {
    throw new Error('regionBitmap payload exceeds single-frame limit (max 251 pixels)');
  }
  const header = Buffer.from([xByte, yByte, width, height]);
  const bitmapPayload = encodeRegionBitmapSource(bitmap, expectedPixels);
  return Buffer.concat([header, bitmapPayload]);
}

export function rgb332(r: number, g: number, b: number): number {
  const r3 = (r >> 5) & 0x07; // Top 3 bits of red
  const g3 = (g >> 5) & 0x07; // Top 3 bits of green
  const b2 = (b >> 6) & 0x03; // Top 2 bits of blue
  return (r3 << 5) | (g3 << 2) | b2;
}

export function createRegionBitmap8BitPayload(
  x: number,
  y: number,
  w: number,
  h: number,
  pixels: Buffer | Uint8Array | number[]
) {
  const xByte = normalizeCoordinate(x, 'x');
  const yByte = normalizeCoordinate(y, 'y');
  const width = normalizeSize(w, 'width');
  const height = normalizeSize(h, 'height');
  const expectedPixels = width * height;
  const headerBytes = 4;
  if (expectedPixels > 0xff - headerBytes) {
    throw new Error('regionBitmap8Bit payload exceeds single-frame limit (max 251 pixels)');
  }

  let pixelBuffer: Buffer;
  if (Buffer.isBuffer(pixels)) {
    pixelBuffer = pixels;
  } else if (pixels instanceof Uint8Array) {
    pixelBuffer = Buffer.from(pixels);
  } else {
    pixelBuffer = Buffer.from(pixels);
  }

  if (pixelBuffer.length !== expectedPixels) {
    throw new Error(
      `regionBitmap8Bit expected ${expectedPixels} pixels but received ${pixelBuffer.length}`
    );
  }

  const header = Buffer.from([xByte, yByte, width, height]);
  return Buffer.concat([header, pixelBuffer]);
}

function normalizeIntervalMs(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeCoordinate(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`regionBitmap ${label} must be numeric`);
  }
  return clampByte(value);
}

function normalizeSize(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`regionBitmap ${label} must be numeric`);
  }
  const clamped = clampByte(value);
  if (clamped === 0) {
    throw new Error(`regionBitmap ${label} must be between 1 and 255`);
  }
  return clamped;
}

function encodeRegionBitmapSource(source: RegionBitmapSource, expectedPixels: number) {
  if (typeof source === 'string') {
    return encodeBitmapFromString(source, expectedPixels);
  }
  if (Buffer.isBuffer(source)) {
    return encodeBitmapFromIterable(source.values(), expectedPixels);
  }
  if (isIterable(source)) {
    return encodeBitmapFromIterable(source, expectedPixels);
  }
  throw new Error('regionBitmap bitmap must be a string, Buffer, or iterable of numbers');
}

function encodeBitmapFromString(text: string, expectedPixels: number) {
  const sanitized = text.replace(/\s+/g, '');
  if (!sanitized.length) {
    throw new Error('regionBitmap bitmap string is empty');
  }
  const buffer = Buffer.alloc(expectedPixels);
  let index = 0;
  for (const char of sanitized) {
    if (index >= expectedPixels) {
      throw new Error(`regionBitmap expected ${expectedPixels} pixels but received more data`);
    }
    buffer[index] = char === '1' ? 1 : char === '0' ? 0 : invalidBitmapChar(char);
    index += 1;
  }
  if (index !== expectedPixels) {
    throw new Error(`regionBitmap expected ${expectedPixels} pixels but received ${index}`);
  }
  return buffer;
}

function encodeBitmapFromIterable(source: Iterable<number>, expectedPixels: number) {
  const buffer = Buffer.alloc(expectedPixels);
  let index = 0;
  for (const value of source) {
    if (index >= expectedPixels) {
      throw new Error(`regionBitmap expected ${expectedPixels} pixels but received more data`);
    }
    buffer[index] = normalizeBitmapValue(value);
    index += 1;
  }
  if (index !== expectedPixels) {
    throw new Error(`regionBitmap expected ${expectedPixels} pixels but received ${index}`);
  }
  return buffer;
}

function normalizeBitmapValue(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error('regionBitmap bitmap values must be numeric');
  }
  const normalized = value & 0xff;
  if (normalized === 0 || normalized === 0x30) {
    return 0;
  }
  if (normalized === 1 || normalized === 0x31) {
    return 1;
  }
  throw new Error("regionBitmap bitmap values must be 0/1 or ASCII '0'/'1'");
}

function invalidBitmapChar(char: string): never {
  throw new Error(`regionBitmap bitmap strings may only contain 0 or 1 (found '${char}')`);
}

function isIterable(value: unknown): value is Iterable<number> {
  return typeof value === 'object' && value !== null && Symbol.iterator in value;
}
