/** build canonical summary from reducto structured data */

import type { VendorStructuredData } from "./rule-engine";
import { formalizeValueMultiline } from "@/lib/utils/format-display";

const FIELD_LABELS: Record<string, string> = {
  pricing_terms: "Pricing",
  fee_structures: "Fee Structures",
  liability_clauses: "Liability",
  indemnification_terms: "Indemnification",
  termination_terms: "Termination",
  renewal_terms: "Renewal",
  data_retention_policies: "Data Retention",
  data_residency_locations: "Data Residency",
  encryption_practices: "Encryption",
  compliance_references: "Compliance",
  sla_uptime_commitments: "SLA & Uptime",
  support_response_times: "Support",
  data_export_rights: "Data Export",
};

function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}

function formatValue(arr: string[]): string {
  if (arr.length === 0) return "";
  const formalized = arr.map((s) => formalizeValueMultiline(s.trim())).filter(Boolean);
  if (formalized.length === 1) return formalized[0];
  return formalized.map((s, i) => `${i + 1}. ${s}`).join(" ");
}

/** build structured summary from vendor data */
export function buildCanonicalSummary(
  data: VendorStructuredData | Record<string, unknown> | null | undefined
): string {
  if (!data || typeof data !== "object") return "";

  const sections: string[] = [];
  const skipKeys = new Set(["summary", "rawText", "extractedText"]);

  for (const key of Object.keys(FIELD_LABELS)) {
    if (skipKeys.has(key)) continue;
    const raw = data[key];
    const arr = toArray(raw);
    if (arr.length === 0) continue;
    const label = FIELD_LABELS[key] ?? key;
    const formatted = formatValue(arr);
    sections.push(`${label}: ${formatted}`);
  }

  if (sections.length === 0) return "";
  return sections.join("\n\n");
}

/** split run-on text into discrete items (split on sentence boundaries or concatenated clauses) */
function splitIntoItems(s: string): string[] {
  const trimmed = s.trim();
  if (!trimmed) return [];
  const bySentence = trimmed.split(/(?<=[.!?])\s+/).map((p) => p.trim()).filter(Boolean);
  if (bySentence.length > 1) return bySentence;
  const byConcat = trimmed.split(/(?<=[a-z])(?=[A-Z])|(?<=\d)(?=[A-Z])/).map((p) => p.trim()).filter((p) => p.length > 2);
  if (byConcat.length > 1) return byConcat;
  const byDoubleSpace = trimmed.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
  if (byDoubleSpace.length > 1) return byDoubleSpace;
  return [trimmed];
}

/** convert structured data to term/value table rows, one row per term with all values combined, bullet-separated */
export function structuredDataToTableRows(
  data: VendorStructuredData | Record<string, unknown> | null | undefined
): Array<{ term: string; value: string }> {
  if (!data || typeof data !== "object") return [];
  const rows: Array<{ term: string; value: string }> = [];
  const skipKeys = new Set(["summary", "rawText", "extractedText"]);
  for (const key of Object.keys(FIELD_LABELS)) {
    if (skipKeys.has(key)) continue;
    const raw = data[key];
    const arr = toArray(raw);
    if (arr.length === 0) continue;
    const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
    const items: string[] = [];
    for (const v of arr) {
      if (typeof v !== "string" || !v.trim()) continue;
      for (const part of splitIntoItems(v.trim())) {
        items.push(formalizeValueMultiline(part));
      }
    }
    const combined = [...new Set(items)].map((item) => `• ${item}`).join("\n\n");
    if (combined) rows.push({ term: label, value: combined });
  }
  return rows;
}

/** build concise summary for emails and alerts */
export function buildConciseSummary(
  data: VendorStructuredData | Record<string, unknown> | null | undefined,
  maxItems = 5
): string {
  if (!data || typeof data !== "object") return "";

  const items: string[] = [];
  const skipKeys = new Set(["summary", "rawText", "extractedText"]);

  for (const key of Object.keys(FIELD_LABELS)) {
    if (skipKeys.has(key) || items.length >= maxItems) break;
    const raw = data[key];
    const arr = toArray(raw);
    if (arr.length === 0) continue;
    const label = FIELD_LABELS[key] ?? key;
    const first = arr[0];
    if (first && first.length > 120) {
      items.push(`${label}: ${first.slice(0, 117)}...`);
    } else {
      items.push(`${label}: ${first}`);
    }
  }

  if (items.length === 0) return "";
  return items.join(" | ");
}
