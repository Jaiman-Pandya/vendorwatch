import { debugLog } from "../debug-log";

export type AlertSeverity = "low" | "medium" | "high";

const SEVERITIES: AlertSeverity[] = ["low", "medium", "high"];

function parseEnvSeverities(): AlertSeverity[] {
  const raw = process.env.ALERT_SEVERITIES?.trim().toLowerCase();
  if (!raw) return ["medium", "high"];
  const parts = raw.split(/[,\s]+/).filter(Boolean);
  const out: AlertSeverity[] = [];
  for (const p of parts) {
    if (SEVERITIES.includes(p as AlertSeverity)) out.push(p as AlertSeverity);
  }
  return out.length > 0 ? out : ["medium", "high"];
}

let override: AlertSeverity[] | null = null;

export function setAlertSeverities(severities: AlertSeverity[]): void {
  override = severities;
}

export function getAlertSeverities(): AlertSeverity[] {
  const result = override === null ? parseEnvSeverities() : override;
  debugLog("alert-preferences.ts:getAlertSeverities", "getAlertSeverities", { overrideIsNull: override === null, result, resultLength: result.length }, "H3");
  return result;
}

export function shouldSendAlert(severity: AlertSeverity): boolean {
  return getAlertSeverities().includes(severity);
}
