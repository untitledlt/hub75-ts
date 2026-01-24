#!/usr/bin/env node
import fs from "node:fs";
import type { RegionBitmapSource } from "./api.js";
import {
	Api,
	CMD,
	Command,
	IntervalPayloadSize,
	createIntervalPayload,
	createRegionBitmapPayload,
	rgb332,
	sanitizeText,
} from "./api.js";

const DEFAULT_IP = "10.0.0.223";
const DEFAULT_PORT = 1337;

const ip = process.env.HUB75_IP ?? DEFAULT_IP;
const portEnv = process.env.HUB75_PORT;
const port = portEnv ? parseInt(portEnv, 10) : DEFAULT_PORT;

if (Number.isNaN(port)) {
	throw new Error(`Invalid HUB75_PORT value: ${portEnv}`);
}

const api = new Api({ ip, port });

type Handler = (args: string[]) => void | Promise<void>;

const handlers: Record<string, Handler> = {
	clear: () => api.clear(),
	"set-color": ([r, g, b]) => api.setColor(byte(r, "r"), byte(g, "g"), byte(b, "b")),
	"set-cursor": ([x, y]) => api.setCursor(byte(x, "x"), byte(y, "y")),
	"set-text-size": ([size]) => api.setTextSize(numberArg(size, "size")),
	"set-text-wrap": ([flag]) => api.setTextWrap(parseBool(flag ?? "")),
	"fill-screen": ([r, g, b]) => api.fillScreen(byte(r, "r"), byte(g, "g"), byte(b, "b")),
	"set-brightness": ([level]) => api.setBrightness(byte(level, "level")),
	"set-font": ([fontId]) => api.setFont(byte(fontId, "fontId")),
	"draw-line": ([x0, y0, x1, y1]) => api.drawLine(byte(x0, "x0"), byte(y0, "y0"), byte(x1, "x1"), byte(y1, "y1")),
	"draw-rect": ([x, y, w, h]) => api.drawRect(byte(x, "x"), byte(y, "y"), byte(w, "w"), byte(h, "h")),
	"fill-rect": ([x, y, w, h]) => api.fillRect(byte(x, "x"), byte(y, "y"), byte(w, "w"), byte(h, "h")),
	"text-block": (args) => {
		const [x, y, w, h, size, ...textParts] = args;
		if (!textParts.length) {
			throw new Error("text-block requires text payload");
		}
		api.textBlock(
			byte(x, "x"),
			byte(y, "y"),
			byte(w, "w"),
			byte(h, "h"),
			numberArg(size, "size"),
			textParts.join(" ")
		);
	},
	"scroll-text-start": (args) => {
		if (args.length < 7) {
			throw new Error("scroll-text-start requires x y w h size speed text...");
		}
		const [x, y, w, h, size, speed, ...rest] = args;
		if (!rest.length) {
			throw new Error("scroll-text-start requires text payload");
		}
		let textParts = rest;
		let bg: [number, number, number] | undefined;
		if (rest.length >= 4) {
			const candidate = rest.slice(0, 3);
			if (candidate.every(isFiniteNumberLike)) {
				bg = [byte(candidate[0], "bgR"), byte(candidate[1], "bgG"), byte(candidate[2], "bgB")];
				textParts = rest.slice(3);
			}
		}
		if (!textParts.length) {
			throw new Error("scroll-text-start requires text payload");
		}
		api.scrollTextStart(
			byte(x, "x"),
			byte(y, "y"),
			byte(w, "w"),
			byte(h, "h"),
			numberArg(size, "size"),
			numberArg(speed, "speed"),
			textParts.join(" "),
			bg
		);
	},
	"scroll-text-stop": () => api.scrollTextStop(),
	print: (args) => {
		if (!args.length) {
			throw new Error("print requires text payload");
		}
		api.print(args.join(" "));
	},
	"clock-start": (args) => {
		const [x, y, size, ...rest] = args;
		if (x === undefined || y === undefined || size === undefined) {
			throw new Error("clock-start requires x y size");
		}
		let bg: [number, number, number] | undefined;
		if (rest.length > 0) {
			if (rest.length !== 3 || !rest.every(isFiniteNumberLike)) {
				throw new Error("clock-start background expects bgR bgG bgB numbers");
			}
			bg = [byte(rest[0], "bgR"), byte(rest[1], "bgG"), byte(rest[2], "bgB")];
		}
		api.clockStart(byte(x, "x"), byte(y, "y"), numberArg(size, "size"), bg);
	},
	"clock-stop": () => api.clockStop(),
	"progress-start": (args) => {
		if (args.length < 5) {
			throw new Error("progress-start requires x y w h intervalMs");
		}
		const [x, y, w, h, interval, payloadWidth] = args;
		api.progressStart(
			byte(x, "x"),
			byte(y, "y"),
			byte(w, "w"),
			byte(h, "h"),
			numberArg(interval, "interval"),
			parseIntervalPayloadWidth(payloadWidth)
		);
	},
	"progress-stop": () => api.progressStop(),
	"police-start": (args) => {
		const [interval, bytesArg] = args;
		if (interval === undefined) {
			throw new Error("police-start requires intervalMs");
		}
		const payloadBytes = parseIntervalPayloadWidth(bytesArg);
		api.policeStart(numberArg(interval, "interval"), payloadBytes);
	},
	"police-stop": () => api.policeStop(),
	"region-bitmap": (args) => {
		if (args.length < 5) {
			throw new Error("region-bitmap requires x y w h bitmap");
		}
		const [x, y, w, h, ...dataParts] = args;
		if (!dataParts.length) {
			throw new Error("region-bitmap missing bitmap payload");
		}
		const bitmapSource = resolveBatchSource(dataParts.join(" "));
		api.regionBitmap(byte(x, "x"), byte(y, "y"), byte(w, "w"), byte(h, "h"), bitmapSource);
	},
	"region-bitmap-8bit": (args) => {
		if (args.length < 5) {
			throw new Error("region-bitmap-8bit requires x y w h pixels");
		}
		const [x, y, w, h, ...dataParts] = args;
		if (!dataParts.length) {
			throw new Error("region-bitmap-8bit missing pixel data");
		}
		const pixelData = resolveBatchSource(dataParts.join(" "));
		const pixels = typeof pixelData === "string" ? Buffer.from(JSON.parse(pixelData)) : pixelData;
		api.regionBitmap8Bit(byte(x, "x"), byte(y, "y"), byte(w, "w"), byte(h, "h"), pixels);
	},
	invalid: ([length]) => {
		const size = length === undefined ? undefined : numberArg(length, "bytes");
		api.invalid(size);
	},
	batch: (args) => runBatch(args),
	help: () => {
		printUsage();
	},
};

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

async function main() {
	const [cmd, ...args] = process.argv.slice(2);

	if (!cmd) {
		printUsage();
		process.exitCode = 1;
		return;
	}

	const handler = handlers[cmd];
	if (!handler) {
		console.error(`Unknown command: ${cmd}`);
		printUsage();
		process.exitCode = 1;
		return;
	}

	try {
		await handler(args);
		await api.send();
		console.log(`Sent '${cmd}' to tcp://${ip}:${port}`);
	} catch (error) {
		console.error((error as Error).message);
		process.exitCode = 1;
	} finally {
		shutdown();
	}
}

async function runBatch(args: string[]) {
	if (!args.length) {
		throw new Error("batch requires a JSON payload or @file path");
	}
	const raw = resolveBatchSource(args.join(" "));
	const parsed = JSON.parse(raw);
	if (!Array.isArray(parsed)) {
		throw new Error("batch JSON must be an array of command objects");
	}

	const commands: Command[] = parsed.map((entry, idx) => serializeCommand(entry, idx));
	await api.sendBatch(commands);
}

function serializeCommand(entry: any, idx: number): Command {
	if (!entry || typeof entry !== "object") {
		throw new Error(`batch item #${idx} must be an object`);
	}

	const name = String(entry.cmd ?? entry.command ?? "");
	if (!name) {
		throw new Error(`batch item #${idx} needs a 'cmd' field`);
	}

	switch (name) {
		case "clear":
			return { id: CMD.CLEAR };
		case "setColor":
			return { id: CMD.SET_COLOR, payload: expectArray(entry.args, 3, name) };
		case "setCursor":
			return { id: CMD.SET_CURSOR, payload: expectArray(entry.args, 2, name) };
		case "setTextSize":
			return { id: CMD.SET_TEXT_SIZE, payload: [numberArg(entry.args?.[0], "size")] };
		case "setTextWrap":
			return { id: CMD.SET_TEXT_WRAP, payload: [boolLike(entry.args?.[0]) ? 1 : 0] };
		case "fillScreen":
			return { id: CMD.FILL_SCREEN, payload: expectArray(entry.args, 3, name) };
		case "setBrightness":
			return { id: CMD.SET_BRIGHTNESS, payload: [byte(entry.args?.[0], "level")] };
		case "setFont":
			return { id: CMD.SET_FONT, payload: [byte(entry.args?.[0], "fontId")] };
		case "drawLine":
			return { id: CMD.DRAW_LINE, payload: expectArray(entry.args, 4, name) };
		case "drawRect":
			return { id: CMD.DRAW_RECT, payload: expectArray(entry.args, 4, name) };
		case "fillRect":
			return { id: CMD.FILL_RECT, payload: expectArray(entry.args, 4, name) };
		case "textBlock": {
			const rawArgs = entry.args;
			if (!Array.isArray(rawArgs) || rawArgs.length < 5) {
				throw new Error("textBlock requires at least 5 numeric args");
			}
			const [x, y, w, h, sizeRaw, ...textParts] = rawArgs;
			const required = [x, y, w, h, sizeRaw];
			required.forEach((value, idx) => {
				if (typeof value !== "number") {
					throw new Error(`textBlock arg #${idx} must be numeric`);
				}
			});
			const text =
				typeof entry.text === "string" && entry.text.length
					? entry.text
					: textParts.length
						? textParts.join(" ")
						: "";
			const asciiText = sanitizeText(text);
			if (!asciiText.length) {
				throw new Error("textBlock requires text (via 'text' or args)");
			}
			const header = Buffer.from([
				byte(x, "x"),
				byte(y, "y"),
				byte(w, "w"),
				byte(h, "h"),
				byte(Math.max(1, sizeRaw | 0), "size"),
			]);
			return {
				id: CMD.TEXT_BLOCK,
				payload: Buffer.concat([header, Buffer.from(asciiText, "ascii")]),
			};
		}
		case "scrollTextStart": {
			const rawArgs = entry.args;
			if (!Array.isArray(rawArgs) || rawArgs.length < 6) {
				throw new Error("scrollTextStart requires at least 6 numeric args");
			}
			const [x, y, w, h, sizeRaw, speedRaw, ...rest] = rawArgs;
			const required = [x, y, w, h, sizeRaw, speedRaw];
			required.forEach((value, idx) => {
				if (typeof value !== "number") {
					throw new Error(`scrollTextStart arg #${idx} must be numeric`);
				}
			});

			const explicitBg = entry.bg ?? entry.bgColor ?? entry.background;
			let textParts: Array<unknown> = rest;
			let bgFromArgs: [number, number, number] | undefined;
			if (
				explicitBg === undefined &&
				rest.length >= 4 &&
				rest.slice(0, 3).every((value) => typeof value === "number")
			) {
				bgFromArgs = [rest[0] as number, rest[1] as number, rest[2] as number];
				textParts = rest.slice(3);
			}
			const bgTuple = explicitBg !== undefined ? parseRgbTuple(explicitBg, "scrollTextStart") : bgFromArgs;
			const text =
				typeof entry.text === "string" && entry.text.length
					? entry.text
					: textParts.length
						? textParts.map((value) => String(value)).join(" ")
						: "";
			const asciiText = sanitizeText(text);
			if (!asciiText.length) {
				throw new Error("scrollTextStart requires text (via 'text' or args)");
			}
			const normalizedSize = Math.max(1, sizeRaw | 0);
			const normalizedSpeed = Math.max(1, speedRaw | 0);
			const headerValues = [
				byte(x, "x"),
				byte(y, "y"),
				byte(w, "w"),
				byte(h, "h"),
				byte(normalizedSize, "size"),
				byte(normalizedSpeed, "speed"),
			];
			if (bgTuple) {
				headerValues.push(
					byte(bgTuple[0], "bgR"),
					byte(bgTuple[1], "bgG"),
					byte(bgTuple[2], "bgB")
				);
			}
			const header = Buffer.from(headerValues);
			return {
				id: CMD.SCROLL_TEXT_START,
				payload: Buffer.concat([header, Buffer.from(asciiText, "ascii")]),
			};
		}
		case "scrollTextStop":
			return { id: CMD.SCROLL_TEXT_STOP };
		case "print": {
			const text = entry.text ?? entry.args?.[0];
			if (typeof text !== "string" || !text.length) {
				throw new Error("print batch command requires 'text'");
			}
			const asciiText = sanitizeText(text);
			return { id: CMD.PRINT, payload: Buffer.from(asciiText, "ascii") };
		}
		case "clockStart": {
			const rawArgs = entry.args;
			if (!Array.isArray(rawArgs) || rawArgs.length < 3) {
				throw new Error("clockStart requires at least [x, y, size]");
			}
			const [x, y, sizeRaw, ...rest] = rawArgs;
			[x, y, sizeRaw].forEach((value, idx) => {
				if (typeof value !== "number") {
					throw new Error(`clockStart arg #${idx} must be numeric`);
				}
			});
			const explicitBg = entry.bg ?? entry.bgColor ?? entry.background;
			let bgFromArgs: [number, number, number] | undefined;
			let extra = rest;
			if (
				explicitBg === undefined &&
				rest.length >= 3 &&
				rest.slice(0, 3).every((value) => typeof value === "number")
			) {
				bgFromArgs = [rest[0] as number, rest[1] as number, rest[2] as number];
				extra = rest.slice(3);
			}
			if (extra.length > 0 && explicitBg === undefined) {
				throw new Error("clockStart unexpected extra args; expected optional background only");
			}
			const bgTuple = explicitBg !== undefined ? parseRgbTuple(explicitBg, "clockStart") : bgFromArgs;
			const header = [
				byte(x, "x"),
				byte(y, "y"),
				byte(Math.max(1, sizeRaw | 0), "size"),
			];
			if (bgTuple) {
				header.push(byte(bgTuple[0], "bgR"), byte(bgTuple[1], "bgG"), byte(bgTuple[2], "bgB"));
			}
			return { id: CMD.CLOCK_START, payload: Buffer.from(header) };
		}
		case "clockStop":
			return { id: CMD.CLOCK_STOP };
		case "progressStart": {
			const rawArgs = entry.args;
			if (!Array.isArray(rawArgs) || rawArgs.length < 5) {
				throw new Error("progressStart requires at least [x, y, w, h, intervalMs]");
			}
			const [x, y, w, h, intervalRaw, explicitWidth] = rawArgs;
			[x, y, w, h, intervalRaw].forEach((value, argIdx) => {
				if (typeof value !== "number") {
					throw new Error(`progressStart arg #${argIdx} must be numeric`);
				}
			});
			const widthSource = entry.payloadBytes ?? entry.bytes ?? entry.width ?? explicitWidth;
			const header = Buffer.from([
				byte(x, "x"),
				byte(y, "y"),
				byte(w, "w"),
				byte(h, "h"),
			]);
			const intervalPayload = createIntervalPayload(intervalRaw, parseIntervalPayloadWidth(widthSource));
			return {
				id: CMD.PROGRESS_START,
				payload: Buffer.concat([header, intervalPayload]),
			};
		}
		case "progressStop":
			return { id: CMD.PROGRESS_STOP };
		case "policeStart": {
			const rawArgs = entry.args;
			if (!Array.isArray(rawArgs) || rawArgs.length < 1) {
				throw new Error("policeStart requires intervalMs arg");
			}
			const [intervalRaw, explicitWidth] = rawArgs;
			const interval = numberArg(intervalRaw, "interval");
			const widthSource = entry.payloadBytes ?? entry.bytes ?? entry.width ?? explicitWidth;
			const payloadBytes = parseIntervalPayloadWidth(widthSource);
			return {
				id: CMD.POLICE_START,
				payload: createIntervalPayload(interval, payloadBytes),
			};
		}
		case "policeStop":
			return { id: CMD.POLICE_STOP };
		case "regionBitmap": {
			const rawArgs = entry.args;
			if (!Array.isArray(rawArgs) || rawArgs.length < 4) {
				throw new Error("regionBitmap requires args [x, y, w, h]");
			}
			const [x, y, w, h] = rawArgs;
			const bitmapSource =
				entry.bitmap ?? entry.bits ?? entry.data ?? entry.payload ?? entry.text ?? null;
			if (bitmapSource === null) {
				throw new Error("regionBitmap batch item requires 'bitmap' (or 'bits'/'data') field");
			}
			return {
				id: CMD.REGION_BITMAP,
				payload: createRegionBitmapPayload(
					byte(x, "x"),
					byte(y, "y"),
					byte(w, "w"),
					byte(h, "h"),
					bitmapSource as RegionBitmapSource
				),
			};
		}
		default:
			throw new Error(`Unsupported batch command: ${name}`);
	}
}

function expectArray(value: unknown, expectedLen: number, name: string) {
	if (!Array.isArray(value) || value.length !== expectedLen) {
		throw new Error(`${name} expects an array args length ${expectedLen}`);
	}
	return value.map((item: unknown, idx: number) => {
		if (typeof item !== "number") {
			throw new Error(`${name} arg #${idx} must be a number`);
		}
		return item;
	});
}

function resolveBatchSource(arg: string) {
	if (arg.startsWith("@")) {
		const filePath = arg.slice(1);
		return fs.readFileSync(filePath, "utf-8");
	}
	return arg;
}

function byte(value: string | number | undefined, label: string) {
	if (value === undefined) {
		throw new Error(`${label} is required`);
	}
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num)) {
		throw new Error(`${label} must be numeric`);
	}
	return Math.max(0, Math.min(0xff, num | 0));
}

function numberArg(value: string | number | undefined, label: string) {
	if (value === undefined) {
		throw new Error(`${label} is required`);
	}
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num)) {
		throw new Error(`${label} must be numeric`);
	}
	return num;
}

function isFiniteNumberLike(value: string | number | undefined) {
	if (value === undefined) {
		return false;
	}
	const num = typeof value === "number" ? value : Number(value);
	return Number.isFinite(num);
}

function parseRgbTuple(value: unknown, context: string): [number, number, number] {
	if (!Array.isArray(value) || value.length !== 3) {
		throw new Error(`${context} background must be [r, g, b]`);
	}
	const [r, g, b] = value;
	if (![r, g, b].every((component) => typeof component === "number")) {
		throw new Error(`${context} background values must be numeric`);
	}
	return [r, g, b];
}

function parseBool(value: string) {
	const normalized = value.toLowerCase();
	if (["1", "true", "on", "yes"].includes(normalized)) {
		return true;
	}
	if (["0", "false", "off", "no"].includes(normalized)) {
		return false;
	}
	throw new Error("set-text-wrap expects on/off");
}

function boolLike(value: unknown) {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value !== 0;
	}
	if (typeof value === "string") {
		return parseBool(value);
	}
	throw new Error("Boolean argument expected");
}

function parseIntervalPayloadWidth(value: unknown): IntervalPayloadSize | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const num = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(num) || (num !== 2 && num !== 4)) {
		throw new Error("Payload bytes must be 2 or 4");
	}
	return num as IntervalPayloadSize;
}

function printUsage() {
	console.log(`Usage: tsx src/index.ts <command> [...args]

Commands: clear, set-color r g b, set-cursor x y, set-text-size size, set-text-wrap on|off,
fill-screen r g b, set-brightness level, set-font fontId, draw-line x0 y0 x1 y1, draw-rect x y w h,
fill-rect x y w h, text-block x y w h size text..., scroll-text-start x y w h size speed [bgR bgG bgB] text...,
scroll-text-stop, print text..., clock-start x y size [bgR bgG bgB], clock-stop,
progress-start x y w h intervalMs [payloadBytes], progress-stop, police-start intervalMs [payloadBytes],
police-stop, region-bitmap x y w h bitmap, region-bitmap-8bit x y w h pixels, invalid [bytes], batch <json|@file>, help.

Environment: HUB75_IP, HUB75_PORT`);
}

function shutdown() {
	// Give the TCP socket a moment to flush pending writes.
	setTimeout(() => api.close(), 50);
}
