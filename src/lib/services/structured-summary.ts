/**
 * Build a canonical human-readable summary from Reducto's structured data.
 * Used when LLM fails or in Basic mode, and to augment alerts with concrete facts.
 */

import type { VendorStructuredData } from "./rule-engine";

const FIELD_LABELS: Record<string, string> = {
  pricing_terms: "Pricing",
  fee_structures: "Fee structures",
  liability_clauses: "Liability",
  indemnification_terms: "Indemnification",
  termination_terms: "Termination",
  renewal_terms: "Renewal",
  data_retention_policies: "Data retention",
  data_residency_locations: "Data residency",
  encryption_practices: "Encryption",
  compliance_references: "Compliance",
  sla_uptime_commitments: "SLA & uptime",
  support_response_times: "Support",
  data_export_rights: "Data export",
};

function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}

function formatValue(arr: string[]): string {
  if (arr.length === 0) return "";
  if (arr.length === 1) return arr[0];
  return arr.map((s, i) => `${i + 1}. ${s}`).join(" ");
}

/**
 * Build a structured summary from VendorStructuredData.
 * Returns concrete bullet points for each populated field.
 */
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

/**
 * Build a concise single-paragraph summary for emails/alerts.
 */
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
