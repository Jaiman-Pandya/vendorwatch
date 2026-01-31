import Reducto from "reductoai";
import type { VendorStructuredData } from "./rule-engine";

const apiKey = process.env.REDUCTO_API_KEY;
const reducto = apiKey ? new Reducto({ apiKey }) : null;

/** Alias for rule-engine schema; Reducto may return a subset. */
export type StructuredDocData = Partial<VendorStructuredData> & { summary?: string; [key: string]: unknown };

/** Normalize Reducto output to VendorStructuredData (strings or arrays). */
function normalizeToStructured(raw: Record<string, unknown>): VendorStructuredData {
  const out: VendorStructuredData = {};
  const keys = [
    "pricing_terms",
    "fee_structures",
    "liability_clauses",
    "indemnification_terms",
    "termination_terms",
    "renewal_terms",
    "data_retention_policies",
    "data_residency_locations",
    "encryption_practices",
    "compliance_references",
    "sla_uptime_commitments",
    "support_response_times",
    "data_export_rights",
  ];
  for (const key of keys) {
    const val = raw[key];
    if (val == null) continue;
    if (Array.isArray(val)) {
      const strs = val.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
      if (strs.length > 0) out[key] = strs;
    } else if (typeof val === "string" && val.trim()) {
      out[key] = val.trim();
    }
  }
  return out;
}

const VENDOR_DOC_SCHEMA = {
  type: "object",
  properties: {
    pricing_terms: {
      type: "array",
      items: { type: "string" },
      description: "Concrete pricing facts: amounts, tiers, payment terms, refund policy. Extract specific numbers, percentages, and named plans.",
    },
    fee_structures: {
      type: "array",
      items: { type: "string" },
      description: "Fee structures: setup fees, recurring fees, overage charges. Include specific dollar amounts or percentages.",
    },
    liability_clauses: {
      type: "array",
      items: { type: "string" },
      description: "Liability caps, limitations of liability, exclusions. Extract dollar caps, liability carve-outs, and named exclusions.",
    },
    indemnification_terms: {
      type: "array",
      items: { type: "string" },
      description: "Indemnification obligations: who indemnifies whom, scope, carve-outs, IP indemnification.",
    },
    termination_terms: {
      type: "array",
      items: { type: "string" },
      description: "Termination rights, notice periods (e.g. 30 days), termination for cause, data return obligations.",
    },
    renewal_terms: {
      type: "array",
      items: { type: "string" },
      description: "Auto-renewal, renewal notice periods, price escalation on renewal.",
    },
    data_retention_policies: {
      type: "array",
      items: { type: "string" },
      description: "How long data is retained, deletion timelines, retention by data type. Include specific timeframes.",
    },
    data_residency_locations: {
      type: "array",
      items: { type: "string" },
      description: "Where data is stored: regions (EU, US), countries, cloud providers. Include geographic specifics.",
    },
    encryption_practices: {
      type: "array",
      items: { type: "string" },
      description: "Encryption at rest/transit, key management, algorithm names (e.g. AES-256).",
    },
    compliance_references: {
      type: "array",
      items: { type: "string" },
      description: "Certifications and compliance: SOC 2, ISO 27001, GDPR, HIPAA, PCI-DSS. List each certification explicitly.",
    },
    sla_uptime_commitments: {
      type: "array",
      items: { type: "string" },
      description: "Uptime guarantees (e.g. 99.9%), SLA percentages, service credits, exclusions.",
    },
    support_response_times: {
      type: "array",
      items: { type: "string" },
      description: "Response time commitments: P1/P2 definitions, response SLAs, support tiers.",
    },
    data_export_rights: {
      type: "array",
      items: { type: "string" },
      description: "Data portability, export formats, export timelines, GDPR Article 20.",
    },
  },
};

const REDUCTO_SYSTEM_PROMPT = `You are extracting vendor risk terms from legal documents, Terms of Service, Privacy Policy, or SLA documents. Focus on LIABILITIES and RISK FACTORS that matter to a company evaluating a vendor.

PRIORITY: Extract concrete liabilities and problems. For each field:
- LIABILITY_CLAUSES: Liability cap (e.g. "Liability capped at $50,000" or "Limited to fees paid"), exclusions, carve-outs. If unlimited or uncapped, state that explicitly.
- DATA_RESIDENCY_LOCATIONS: Where data is stored (e.g. "EU only", "US-East", "Multi-region"). If unspecified, note "Data location not specified".
- INDEMNIFICATION_TERMS: Who indemnifies whom (mutual vs one-way), scope (IP, third-party claims), carve-outs.
- TERMINATION_TERMS: Notice period (e.g. "30 days written notice"), termination for cause, data return obligations, survival clauses.
- COMPLIANCE_REFERENCES: Certifications (SOC 2, ISO 27001, GDPR, HIPAA, PCI-DSS). If none, omit or state "No certifications listed".
- SLA_UPTIME_COMMITMENTS: Uptime percentage (e.g. 99.9%), service credits, exclusions. If no SLA, state "No uptime guarantee".
- DATA_RETENTION_POLICIES: Retention period, deletion timelines, export rights.
- PRICING_TERMS / FEE_STRUCTURES: Fee amounts, escalation, refund policy.

RULES:
- One fact per array element. Be specific: include dollar amounts, percentages, timeframes, locations.
- Do NOT infer. Extract only what is explicitly stated.
- If a critical term (liability, data location, indemnification) is absent, omit that field (we will flag the gap).
- Use plain language. Avoid marketing fluff.`;

/**
 * Extract structured data from a vendor document (PDF, Terms URL, Policy URL).
 * Returns canonical VendorStructuredData with arrays of concrete facts.
 */
export async function extractStructuredData(fileUrl: string): Promise<StructuredDocData | null> {
  if (!reducto) {
    console.warn("Reducto API key not configured — skipping document extraction");
    return null;
  }

  try {
    const result = await reducto.extract.run({
      input: fileUrl,
      instructions: {
        schema: VENDOR_DOC_SCHEMA,
        system_prompt: REDUCTO_SYSTEM_PROMPT,
      },
    });

    const res = result as { result?: unknown[] };
    if (Array.isArray(res.result) && res.result.length > 0) {
      const first = res.result[0];
      if (first && typeof first === "object") {
        const raw = first as Record<string, unknown>;
        const normalized = normalizeToStructured(raw);
        if (Object.keys(normalized).length > 0) {
          return normalized as StructuredDocData;
        }
        return first as StructuredDocData;
      }
    }

    return null;
  } catch (err) {
    console.warn("Reducto extract failed for", fileUrl, err);
    return null;
  }
}

/** Common paths for terms/legal pages when no doc links found in content. */
const COMMON_LEGAL_PATHS = ["/legal", "/terms", "/terms-of-service", "/privacy", "/tos", "/terms.html", "/legal.html"];

/**
 * Get URLs to try for Reducto extraction: docLinks first, then base URL + common legal paths.
 */
export function getExtractionUrls(docLinks: string[], baseUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const u of docLinks) {
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }

  try {
    const base = new URL(baseUrl);
    const origin = base.origin;
    for (const path of COMMON_LEGAL_PATHS) {
      const full = `${origin}${path}`;
      if (!seen.has(full)) {
        seen.add(full);
        out.push(full);
      }
    }
    // Also try base URL (homepage may have terms excerpt)
    if (!seen.has(origin + "/")) {
      out.push(origin + "/");
    }
  } catch {
    // skip invalid base
  }

  return out.slice(0, 4); // Limit to 4 URLs per vendor
}

/**
 * Extract structured data from multiple URLs until one succeeds with data.
 */
export async function extractFromUrls(urls: string[]): Promise<StructuredDocData | null> {
  for (const u of urls) {
    const data = await extractStructuredData(u);
    if (data && Object.keys(data).length > 0) {
      return data;
    }
  }
  return null;
}
