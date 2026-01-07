import net from "node:net";
import { Buffer } from "node:buffer";
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
    POLICE_START: 0x70,
    POLICE_STOP: 0x71,
    PROGRESS_START: 0x72,
    PROGRESS_STOP: 0x73,
};
export class Api {
    constructor({ ip, port = 1337, socket }) {
        this.pendingFrames = [];
        this.pendingByteLength = 0;
        this.socket = socket ?? net.createConnection({ host: ip, port });
        this.socket.setNoDelay(true);
        const isPending = this.socket.pending ?? false;
        this.ready = isPending
            ? new Promise((resolve, reject) => {
                const cleanup = () => {
                    this.socket.off("connect", onConnect);
                    this.socket.off("error", onError);
                };
                const onConnect = () => {
                    cleanup();
                    resolve();
                };
                const onError = (error) => {
                    cleanup();
                    reject(error);
                };
                this.socket.once("connect", onConnect);
                this.socket.once("error", onError);
            })
            : Promise.resolve();
        this.ready.catch((error) => {
            console.error("TCP connection failed", error);
        });
        this.socket.on("error", (error) => {
            console.error("TCP socket error", error);
        });
        this.sendQueue = Promise.resolve();
    }
    clear() {
        this.sendCommand({ id: CMD.CLEAR });
    }
    setColor(r, g, b) {
        this.sendCommand({ id: CMD.SET_COLOR, payload: [r, g, b] });
    }
    setCursor(x, y) {
        this.sendCommand({ id: CMD.SET_CURSOR, payload: [x, y] });
    }
    setTextSize(size) {
        const normalized = Math.max(1, size | 0);
        this.sendCommand({ id: CMD.SET_TEXT_SIZE, payload: [normalized] });
    }
    setTextWrap(wrap) {
        this.sendCommand({ id: CMD.SET_TEXT_WRAP, payload: [wrap ? 1 : 0] });
    }
    fillScreen(r, g, b) {
        this.sendCommand({ id: CMD.FILL_SCREEN, payload: [r, g, b] });
    }
    setBrightness(level) {
        this.sendCommand({ id: CMD.SET_BRIGHTNESS, payload: [clampByte(level)] });
    }
    setFont(fontId) {
        this.sendCommand({ id: CMD.SET_FONT, payload: [clampByte(fontId)] });
    }
    drawLine(x0, y0, x1, y1) {
        this.sendCommand({ id: CMD.DRAW_LINE, payload: [x0, y0, x1, y1] });
    }
    drawRect(x, y, w, h) {
        this.sendCommand({ id: CMD.DRAW_RECT, payload: [x, y, w, h] });
    }
    fillRect(x, y, w, h) {
        this.sendCommand({ id: CMD.FILL_RECT, payload: [x, y, w, h] });
    }
    print(text) {
        const payload = this.encodeTextPayload(text);
        this.sendCommand({ id: CMD.PRINT, payload });
    }
    clockStart(x, y, size, bgColor) {
        const payload = [
            clampByte(x),
            clampByte(y),
            clampByte(Math.max(1, size | 0)),
        ];
        if (bgColor) {
            const [r, g, b] = bgColor;
            payload.push(clampByte(r), clampByte(g), clampByte(b));
        }
        this.sendCommand({ id: CMD.CLOCK_START, payload });
    }
    clockStop() {
        this.sendCommand({ id: CMD.CLOCK_STOP });
    }
    policeStart(intervalMs, payloadBytes) {
        const payload = createIntervalPayload(intervalMs, payloadBytes);
        this.sendCommand({ id: CMD.POLICE_START, payload });
    }
    policeStop() {
        this.sendCommand({ id: CMD.POLICE_STOP });
    }
    progressStart(x, y, w, h, intervalMs, payloadBytes) {
        const header = Buffer.from([
            clampByte(x),
            clampByte(y),
            clampByte(w),
            clampByte(h),
        ]);
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
        const normalized = Number.isFinite(byteLength)
            ? Math.max(1, Math.min(255, byteLength | 0))
            : 8;
        const garbage = Buffer.allocUnsafe(normalized);
        for (let i = 0; i < normalized; i += 1) {
            garbage[i] = Math.floor(Math.random() * 0x100);
        }
        this.enqueueFrame(garbage).catch((error) => {
            console.error("Socket send failed", error);
        });
    }
    scrollTextStart(x, y, w, h, size, speed, text, bgColor) {
        const body = this.encodeTextPayload(text);
        if (body.length === 0) {
            throw new Error("scrollTextStart requires text payload");
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
    textBlock(x, y, w, h, size, text) {
        const body = this.encodeTextPayload(text);
        if (body.length === 0) {
            throw new Error("textBlock requires text payload");
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
    regionBitmap(x, y, w, h, bitmap) {
        const payload = createRegionBitmapPayload(x, y, w, h, bitmap);
        this.sendCommand({ id: CMD.REGION_BITMAP, payload });
    }
    async framebufferChunk(offset, pixelData) {
        if (offset < 0 || offset > 0xffff) {
            throw new Error("framebufferChunk offset must fit in 16 bits");
        }
        let pixels;
        if (Buffer.isBuffer(pixelData)) {
            pixels = pixelData;
        }
        else if (pixelData instanceof Uint8Array) {
            pixels = Buffer.from(pixelData);
        }
        else {
            pixels = Buffer.from(pixelData);
        }
        if (pixels.length === 0) {
            throw new Error("framebufferChunk payload must include pixel data");
        }
        if (pixels.length + 2 > 0xff) {
            throw new Error("framebufferChunk payload exceeds single-frame limit (max 253 pixel bytes)");
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
    framebufferClear(color) {
        if (!color) {
            this.sendCommand({ id: CMD.FRAMEBUFFER_CLEAR });
            return;
        }
        const payload = color.map((component) => clampByte(component));
        this.sendCommand({ id: CMD.FRAMEBUFFER_CLEAR, payload });
    }
    async uploadFramebuffer(pixels, chunkPixels = 180, interChunkDelayMs = 0) {
        if (pixels.length === 0) {
            throw new Error("uploadFramebuffer expects at least one pixel");
        }
        const bytesPerChunk = Math.min(chunkPixels, 0xff - 2);
        if (bytesPerChunk <= 0) {
            throw new Error("chunk size too small");
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
    async sendBatch(commands) {
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
    sendCommand(command, awaitSend = false) {
        const frame = this.encodeCommand(command);
        if (awaitSend) {
            return this.flushPendingThenSend(frame);
        }
        this.pendingFrames.push(frame);
        this.pendingByteLength += frame.length;
    }
    async flushPendingThenSend(frame) {
        await this.send();
        await this.enqueueFrame(frame);
    }
    encodeCommand(command) {
        const payload = this.encodePayload(command.payload);
        if (payload.length > 0xff) {
            throw new Error("Payload too large for single command frame");
        }
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = command.id & 0xff;
        frame[1] = payload.length;
        payload.copy(frame, 2);
        return frame;
    }
    enqueueFrame(frame) {
        const task = this.sendQueue.then(() => this.dispatchFrame(frame));
        this.sendQueue = task.catch(() => { });
        return task;
    }
    dispatchFrame(frame) {
        return this.ready.then(() => new Promise((resolve, reject) => {
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                this.socket.off("error", onError);
            };
            this.socket.once("error", onError);
            try {
                this.socket.write(frame, () => {
                    cleanup();
                    resolve();
                });
            }
            catch (error) {
                cleanup();
                reject(error);
            }
        }));
    }
    encodePayload(payload) {
        if (!payload) {
            return Buffer.alloc(0);
        }
        if (Buffer.isBuffer(payload)) {
            return payload;
        }
        const bytes = Array.from(payload, clampByte);
        return Buffer.from(bytes);
    }
    encodeTextPayload(text) {
        if (Buffer.isBuffer(text)) {
            return text;
        }
        const ascii = sanitizeText(text);
        return Buffer.from(ascii, "ascii");
    }
}
function clampByte(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(0xff, value | 0));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
const ASCII_SUBSTITUTIONS = {
    "\u00df": "ss",
    "\u1e9e": "SS",
    "\u00c6": "AE",
    "\u00e6": "ae",
    "\u0152": "OE",
    "\u0153": "oe",
    "\u00d8": "O",
    "\u00f8": "o",
    "\u00c5": "A",
    "\u00e5": "a",
    "\u0141": "L",
    "\u0142": "l",
    "\u0110": "D",
    "\u0111": "d",
    "\u00de": "Th",
    "\u00fe": "th",
    "\u014a": "N",
    "\u014b": "n",
    "\u0126": "H",
    "\u0127": "h",
    "\u0132": "IJ",
    "\u0133": "ij",
    "\u00d1": "N",
    "\u00f1": "n",
    "\u00a0": " ",
};
export function sanitizeText(input) {
    if (!input) {
        return "";
    }
    const substituted = substituteExtendedChars(input);
    const decomposed = substituted.normalize("NFKD");
    const withoutMarks = decomposed.replace(/[\u0300-\u036f]/g, "");
    let result = "";
    for (const char of withoutMarks) {
        const code = char.charCodeAt(0);
        const isPrintableAscii = code >= 0x20 && code <= 0x7e;
        const isControlAllowed = char === "\n" || char === "\r" || char === "\t";
        if (isPrintableAscii || isControlAllowed) {
            result += char;
        }
    }
    return result;
}
function substituteExtendedChars(text) {
    let result = "";
    for (const char of text) {
        const replacement = ASCII_SUBSTITUTIONS[char];
        result += replacement ?? char;
    }
    return result;
}
export function createIntervalPayload(intervalMs, payloadBytes) {
    const normalized = normalizeIntervalMs(intervalMs);
    const width = payloadBytes ?? (normalized > 0xffff ? 4 : 2);
    if (width !== 2 && width !== 4) {
        throw new Error("Interval payload must be 2 or 4 bytes");
    }
    if (width === 2) {
        if (normalized > 0xffff) {
            throw new Error("Interval exceeds 16-bit; request payloadBytes=4");
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
export function createRegionBitmapPayload(x, y, w, h, bitmap) {
    const xByte = normalizeCoordinate(x, "x");
    const yByte = normalizeCoordinate(y, "y");
    const width = normalizeSize(w, "width");
    const height = normalizeSize(h, "height");
    const expectedPixels = width * height;
    const headerBytes = 4;
    if (expectedPixels > 0xff - headerBytes) {
        throw new Error("regionBitmap payload exceeds single-frame limit (max 251 pixels)");
    }
    const header = Buffer.from([xByte, yByte, width, height]);
    const bitmapPayload = encodeRegionBitmapSource(bitmap, expectedPixels);
    return Buffer.concat([header, bitmapPayload]);
}
function normalizeIntervalMs(value) {
    if (!Number.isFinite(value)) {
        return 1;
    }
    return Math.max(1, Math.floor(value));
}
function normalizeCoordinate(value, label) {
    if (!Number.isFinite(value)) {
        throw new Error(`regionBitmap ${label} must be numeric`);
    }
    return clampByte(value);
}
function normalizeSize(value, label) {
    if (!Number.isFinite(value)) {
        throw new Error(`regionBitmap ${label} must be numeric`);
    }
    const clamped = clampByte(value);
    if (clamped === 0) {
        throw new Error(`regionBitmap ${label} must be between 1 and 255`);
    }
    return clamped;
}
function encodeRegionBitmapSource(source, expectedPixels) {
    if (typeof source === "string") {
        return encodeBitmapFromString(source, expectedPixels);
    }
    if (Buffer.isBuffer(source)) {
        return encodeBitmapFromIterable(source.values(), expectedPixels);
    }
    if (isIterable(source)) {
        return encodeBitmapFromIterable(source, expectedPixels);
    }
    throw new Error("regionBitmap bitmap must be a string, Buffer, or iterable of numbers");
}
function encodeBitmapFromString(text, expectedPixels) {
    const sanitized = text.replace(/\s+/g, "");
    if (!sanitized.length) {
        throw new Error("regionBitmap bitmap string is empty");
    }
    const buffer = Buffer.alloc(expectedPixels);
    let index = 0;
    for (const char of sanitized) {
        if (index >= expectedPixels) {
            throw new Error(`regionBitmap expected ${expectedPixels} pixels but received more data`);
        }
        buffer[index] = char === "1" ? 1 : char === "0" ? 0 : invalidBitmapChar(char);
        index += 1;
    }
    if (index !== expectedPixels) {
        throw new Error(`regionBitmap expected ${expectedPixels} pixels but received ${index}`);
    }
    return buffer;
}
function encodeBitmapFromIterable(source, expectedPixels) {
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
function normalizeBitmapValue(value) {
    if (!Number.isFinite(value)) {
        throw new Error("regionBitmap bitmap values must be numeric");
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
function invalidBitmapChar(char) {
    throw new Error(`regionBitmap bitmap strings may only contain 0 or 1 (found '${char}')`);
}
function isIterable(value) {
    return typeof value === "object" && value !== null && Symbol.iterator in value;
}
