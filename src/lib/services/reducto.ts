import Reducto from "reductoai";
import type { VendorStructuredData } from "./rule-engine";

const apiKey = process.env.REDUCTO_API_KEY;
const reducto = apiKey ? new Reducto({ apiKey }) : null;

/** Alias for rule-engine schema; Reducto may return a subset. */
export type StructuredDocData = Partial<VendorStructuredData> & { summary?: string; [key: string]: unknown };

const VENDOR_DOC_SCHEMA = {
  type: "object",
  properties: {
    pricing_terms: { type: "string", description: "Pricing terms and conditions" },
    fee_structures: { type: "string", description: "Fee structures and payment terms" },
    liability_clauses: { type: "string", description: "Liability or limitation of liability clauses" },
    indemnification_terms: { type: "string", description: "Indemnification language" },
    termination_terms: { type: "string", description: "Termination and notice period terms" },
    renewal_terms: { type: "string", description: "Renewal and auto-renewal terms" },
    data_retention_policies: { type: "string", description: "Data retention and deletion policies" },
    data_residency_locations: { type: "string", description: "Data residency or storage locations" },
    encryption_practices: { type: "string", description: "Encryption and security practices" },
    compliance_references: { type: "string", description: "Compliance or certification references" },
    sla_uptime_commitments: { type: "string", description: "SLA and uptime commitments" },
    support_response_times: { type: "string", description: "Support and response time commitments" },
    data_export_rights: { type: "string", description: "Data export or portability rights" },
    summary: { type: "string", description: "Brief summary of key terms" },
  },
};

/**
 * Extract structured data from a vendor document (PDF, Terms, Policy, etc.).
 * Returns structured JSON for liability, data handling, SLA, pricing.
 * Logs errors without throwing — monitoring continues on failure.
 */
export async function extractStructuredData(
  fileUrl: string
): Promise<StructuredDocData | null> {
  if (!reducto) {
    console.warn("Reducto API key not configured — skipping document extraction");
    return null;
  }

  try {
    const result = await reducto.extract.run({
      input: fileUrl,
      instructions: {
        schema: VENDOR_DOC_SCHEMA,
        system_prompt:
          "Extract vendor risk terms: pricing_terms, fee_structures, liability_clauses, indemnification_terms, termination_terms, renewal_terms, data_retention_policies, data_residency_locations, encryption_practices, compliance_references, sla_uptime_commitments, support_response_times, data_export_rights. Use exact field names.",
      },
    });

    const res = result as { result?: unknown[] };
    if (Array.isArray(res.result) && res.result.length > 0) {
      const first = res.result[0];
      if (first && typeof first === "object") {
        return first as StructuredDocData;
      }
    }

    return null;
  } catch (err) {
    console.warn("Reducto extract failed for", fileUrl, err);
    return null;
  }
}
