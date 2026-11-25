// Structured logger for the backend, mirrored to /tmp/kimi-logs/app.log.
//
// Zero dependencies on purpose: this file is grafted into every user project,
// so pulling in pino/winston would add weight to the template's dependency
// surface for a feature whose whole job is "append one JSON line".
import fs from "fs";
import path from "path";
import { currentRequestId } from "./requestcontext";
import { scrubCtx, scrubValue } from "./scrub";

const LOG_DIR = process.env.KIMI_LOG_DIR ?? "/tmp/kimi-logs";
const LOG_FILE = process.env.KIMI_LOG_FILE ?? path.join(LOG_DIR, "app.log");
// 8 MiB is far more than a debugging session reads and small enough that even a
// hostile write rate cannot exhaust a sandbox disk.
const LOG_MAX_BYTES = 8 * 1024 * 1024;

let bytesWritten = 0;
let sizeKnown = false;

// enforceBudget truncates the file once it exceeds LOG_MAX_BYTES. Doing it here
// (on the write path) rather than with a timer keeps the bound independent of
// whether anything else in the process is still alive.
function enforceBudget(lineLength: number): void {
  if (!sizeKnown) {
    try {
      bytesWritten = fs.statSync(LOG_FILE).size;
    } catch {
      bytesWritten = 0;
    }
    sizeKnown = true;
  }
  if (bytesWritten + lineLength <= LOG_MAX_BYTES) return;
  try {
    fs.writeFileSync(
      LOG_FILE,
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        msg: "app.log exceeded its size budget; truncated",
        maxBytes: LOG_MAX_BYTES,
      }) + "\n"
    );
  } catch {
    return;
  }
  bytesWritten = 0;
}

let dirReady = false;
function ensureDir(): void {
  if (dirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    dirReady = true;
  } catch {
    // A read-only or missing /tmp must not crash the app; stdout still works.
  }
}

type Level = "debug" | "info" | "warn" | "error";

// Reserved fields the caller must not be able to override from ctx.
const RESERVED_KEYS = new Set(["ts", "level", "msg", "requestId"]);

function write(level: Level, msg: string, ctx?: Record<string, unknown>): void {
  let line: string;
  try {
    const requestId = currentRequestId();
    const extra = Object.fromEntries(
      Object.entries(scrubCtx(ctx) ?? {}).filter(([k]) => !RESERVED_KEYS.has(k))
    );
    line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      ...(requestId ? { requestId } : {}),
      msg: scrubValue(msg),
      ...extra,
    });
  } catch {
    return;
  }
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  ensureDir();
  try {
    enforceBudget(line.length + 1);
    fs.appendFileSync(LOG_FILE, line + "\n");
    bytesWritten += line.length + 1;
  } catch {
    // Best-effort sink; never let logging break a request.
  }
}

// appendLine is the sink the client-log endpoint writes through, so browser
// logs land in exactly the same file with the same shape as server logs.
export function appendLine(line: string): void {
  try {
    console.log(line);
  } catch {
    // stdout is best-effort too.
  }
  ensureDir();
  try {
    enforceBudget(line.length + 1);
    fs.appendFileSync(LOG_FILE, line + "\n");
    bytesWritten += line.length + 1;
  } catch {
    // Best-effort.
  }
}

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) =>
    write("error", msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
};

export const logFilePath = LOG_FILE;
