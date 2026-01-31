import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";

const LOG_PATH = process.cwd() + "/.cursor/debug.log";

function writeLine(payload: Record<string, unknown>) {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    appendFileSync(LOG_PATH, JSON.stringify(payload) + "\n");
  } catch {
    // ignore
  }
}

export function debugLog(location: string, message: string, data: Record<string, unknown>, hypothesisId: string) {
  writeLine({ location, message, data, timestamp: Date.now(), sessionId: "debug-session", hypothesisId });
}
