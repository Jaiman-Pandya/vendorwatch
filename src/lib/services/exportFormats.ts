/**
 * Format conversion utilities for vendor snapshot exports.
 */

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

export interface SnapshotExportPayload {
  vendor: string;
  vendorWebsite?: string;
  snapshotDate?: string;
  contentHash?: string;
  structuredData?: Record<string, unknown>;
}

/**
 * Convert snapshot payload to CSV.
 * Includes vendor metadata, then structuredData as field,label,value rows.
 */
export function toCSV(data: SnapshotExportPayload): string {
  const lines: string[] = ["field,label,value"];
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

  lines.push(`${esc("metadata")},${esc("Vendor")},${esc(data.vendor ?? "")}`);
  lines.push(`${esc("metadata")},${esc("Website")},${esc(data.vendorWebsite ?? "")}`);
  lines.push(`${esc("metadata")},${esc("Snapshot date")},${esc(data.snapshotDate ?? "")}`);
  lines.push(`${esc("metadata")},${esc("Content hash")},${esc(data.contentHash ?? "")}`);

  const structured = data.structuredData ?? {};
  for (const key of Object.keys(structured)) {
    const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
    const raw = structured[key];
    const arr = toArray(raw);
    if (arr.length === 0) {
      lines.push(`${esc(key)},${esc(label)},`);
    } else {
      arr.forEach((val) => {
        lines.push(`${esc(key)},${esc(label)},${esc(val)}`);
      });
    }
  }
  return lines.join("\n");
}

/**
 * Convert snapshot payload to Markdown report.
 */
export function toMarkdown(data: SnapshotExportPayload): string {
  const lines: string[] = [
    `# VendorWatch: ${data.vendor}`,
    "",
    `- **Website:** ${data.vendorWebsite ?? "—"}`,
    `- **Snapshot date:** ${data.snapshotDate ?? "—"}`,
    `- **Content hash:** ${data.contentHash ?? "—"}`,
    "",
    "## Structured Data",
    "",
  ];

  const structured = data.structuredData ?? {};
  const keys = Object.keys(structured).filter((k) => !["summary", "rawText", "extractedText"].includes(k));

  if (keys.length === 0) {
    lines.push("*No structured data extracted.*");
  } else {
    for (const key of keys) {
      const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");
      const raw = structured[key];
      const arr = toArray(raw);
      if (arr.length === 0) continue;
      lines.push(`### ${label}`);
      lines.push("");
      for (const val of arr) {
        lines.push(`- ${val}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim();
}
