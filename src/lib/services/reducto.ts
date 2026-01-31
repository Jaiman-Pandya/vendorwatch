import Reducto from "reductoai";

const apiKey = process.env.REDUCTO_API_KEY;
const reducto = apiKey ? new Reducto({ apiKey }) : null;

export interface StructuredDocData {
  liabilityTerms?: string;
  dataHandling?: string;
  slaGuarantees?: string;
  pricingClauses?: string;
  summary?: string;
  [key: string]: unknown;
}

const VENDOR_DOC_SCHEMA = {
  type: "object",
  properties: {
    liabilityTerms: {
      type: "string",
      description: "Key liability or limitation of liability clauses",
    },
    dataHandling: {
      type: "string",
      description: "Data handling, storage, or privacy commitments",
    },
    slaGuarantees: {
      type: "string",
      description: "SLA, uptime, or service level guarantees",
    },
    pricingClauses: {
      type: "string",
      description: "Pricing, fees, or payment terms",
    },
    summary: {
      type: "string",
      description: "Brief summary of the document's key terms",
    },
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
          "Extract key vendor risk terms from this document: liability limits, data handling rules, SLA guarantees, and pricing terms.",
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
