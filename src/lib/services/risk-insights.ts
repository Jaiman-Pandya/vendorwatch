/** parse reducto structured data into actionable risk findings */

import type { VendorStructuredData } from "./rule-engine";

function toArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (typeof val === "string" && val.trim()) return [val.trim()];
  return [];
}

export interface RiskFinding {
  category: "Legal" | "Data & Security" | "Financial" | "Operational";
  finding: string;
  /** helps ui style high-concern items */
  concern?: "high" | "medium" | "low";
}

const CATEGORY_LABELS: Record<string, RiskFinding["category"]> = {
  liability_clauses: "Legal",
  indemnification_terms: "Legal",
  termination_terms: "Legal",
  renewal_terms: "Legal",
  pricing_terms: "Financial",
  fee_structures: "Financial",
  data_retention_policies: "Data & Security",
  data_residency_locations: "Data & Security",
  encryption_practices: "Data & Security",
  compliance_references: "Data & Security",
  data_export_rights: "Data & Security",
  sla_uptime_commitments: "Operational",
  support_response_times: "Operational",
};

/** fields that indicate high concern when missing */
const HIGH_CONCERN_KEYS = new Set([
  "liability_clauses",
  "data_residency_locations",
  "compliance_references",
  "indemnification_terms",
]);

/** convert raw text to a clear actionable finding */
function toFinding(key: string, raw: string): string {
  const s = raw.trim();
  if (!s || s.length < 3) return "";
    // capitalize first letter
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** extract risk findings from structured data, grouped by category */
export function extractRiskFindings(
  data: VendorStructuredData | Record<string, unknown> | null | undefined
): RiskFinding[] {
  if (!data || typeof data !== "object") return [];

  const findings: RiskFinding[] = [];
  const skipKeys = new Set(["summary", "rawText", "extractedText"]);

  for (const key of Object.keys(CATEGORY_LABELS)) {
    if (skipKeys.has(key)) continue;
    const raw = data[key];
    const arr = toArray(raw);
    const category = CATEGORY_LABELS[key];
    const concern: RiskFinding["concern"] = HIGH_CONCERN_KEYS.has(key) ? "high" : "medium";

    if (arr.length === 0) {
      // flag gap when critical field not found
      if (HIGH_CONCERN_KEYS.has(key)) {
        const gapLabel =
          key === "liability_clauses"
            ? "Liability cap or limitation"
            : key === "data_residency_locations"
              ? "Data residency or storage location"
              : key === "compliance_references"
                ? "Compliance or certification"
                : key === "indemnification_terms"
                  ? "Indemnification scope"
                  : key.replace(/_/g, " ");
        findings.push({
          category,
          finding: `${gapLabel} not specified in vendor terms`,
          concern: "high",
        });
      }
      continue;
    }

    for (const val of arr) {
      const finding = toFinding(key, val);
      if (finding) {
        findings.push({ category, finding, concern });
      }
    }
  }

  return findings;
}

/** minimal shape for grouping */
export interface RiskFindingInput {
  category: string;
  finding: string;
}

/** actions by risk category when findings exist */
const CATEGORY_ACTIONS: Record<string, string> = {
  Legal: "Review liability and indemnification terms with legal. Assess if cap and scope align with risk tolerance.",
  "Data & Security": "Confirm data residency and compliance certifications. Update DPA or risk register if needed.",
  Financial: "Compare pricing and fee structures against budget. Notify procurement or finance if material.",
  Operational: "Review SLA and support commitments. Update escalation playbooks.",
};

/** build recommended actions from risk findings */
export function buildRecommendedActionsFromFindings(
  findings: RiskFinding[]
): string {
  if (findings.length === 0) return "";

  const byCat = new Map<string, string[]>();
  for (const f of findings) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category)!.push(f.finding);
  }

  const parts: string[] = ["Risks/Liabilities identified:"];
  const order = ["Legal", "Data & Security", "Financial", "Operational"];

  for (const cat of order) {
    const catFindings = byCat.get(cat);
    if (!catFindings || catFindings.length === 0) continue;
    parts.push(`• ${cat}: ${catFindings.join("; ")}`);
  }

  parts.push("");
  parts.push("Recommended actions:");
  let n = 1;
  for (const cat of order) {
    if (byCat.has(cat)) {
      parts.push(`${n}) ${cat}: ${CATEGORY_ACTIONS[cat] ?? "Review and document."}`);
      n++;
    }
  }
  parts.push(`${n}) Run the monitor periodically to detect future changes.`);

  return parts.join("\n");
}

/** format findings grouped by category for display */
export function groupFindingsByCategory(
  findings: RiskFindingInput[]
): Array<{ category: string; findings: string[] }> {
  const byCat = new Map<string, string[]>();
  for (const f of findings) {
    if (!byCat.has(f.category)) byCat.set(f.category, []);
    byCat.get(f.category)!.push(f.finding);
  }
  const order = ["Legal", "Data & Security", "Financial", "Operational"];
  return order
    .filter((c) => byCat.has(c))
    .map((category) => ({
      category,
      findings: byCat.get(category)!,
    }));
}
