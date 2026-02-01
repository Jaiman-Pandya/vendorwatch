import type { VendorStructuredData } from "./rule-engine";

const KEEP_KEYWORDS = [
  "price",
  "pricing",
  "fee",
  "charge",
  "billing",
  "subscription",
  "cost",
  "rate",
  "liability",
  "indemnify",
  "indemnification",
  "damages",
  "governing law",
  "arbitration",
  "termination",
  "renewal",
  "notice",
  "data",
  "encryption",
  "security",
  "retention",
  "breach",
  "incident",
  "residency",
  "subprocessors",
  "compliance",
  "gdpr",
  "soc",
  "iso",
  "sla",
  "uptime",
  "availability",
  "downtime",
  "support",
  "response time",
  "resolution time",
  "service level",
  "export",
  "portability",
  "termination fee",
  "cancellation",
  "contract length",
];

const REMOVE_KEYWORDS = [
  "budget",
  "expenditure",
  "income statement",
  "internal report",
  "staffing",
  "payroll",
  "audit expense",
  "accounting summary",
  "government report",
  "annual financials",
];

function toArray(val: string | string[] | undefined): string[] {
  if (val == null) return [];
  if (Array.isArray(val)) return val.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return [val.trim()].filter(Boolean);
}

function isRelevant(entry: string): boolean {
  const lower = entry.toLowerCase();
  for (const kw of REMOVE_KEYWORDS) {
    if (lower.includes(kw)) return false;
  }
  for (const kw of KEEP_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * filter vendor risk-relevant entries from reducto output.
 * keeps customer-impacting vendor risk info, removes internal/gov-style noise.
 */
export function filterStructuredData(data: VendorStructuredData | null | undefined): VendorStructuredData {
  if (!data || typeof data !== "object") return {};

  const skipKeys = new Set(["summary", "rawText", "extractedText"]);
  const result: VendorStructuredData = {};

  for (const key of Object.keys(data)) {
    if (skipKeys.has(key)) continue;

    const raw = data[key];
    const arr = toArray(raw);
    if (arr.length === 0) continue;

    const filtered = arr.filter(isRelevant);
    if (filtered.length > 0) {
      result[key] = filtered.length === 1 ? filtered[0] : filtered;
    } else {
      result[key] = [];
    }
  }

  return result;
}
