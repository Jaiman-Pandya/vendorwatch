import type { VendorStructuredData } from "./rule-engine";

const LEGAL_KEYWORDS = [
  "liability",
  "indemnif",
  "terms of service",
  "terms and conditions",
  "agreement",
  "privacy policy",
  "subscription",
  "governing law",
  "arbitration",
  "limitation of liability",
  "data retention",
  "sla",
  "uptime",
  "gdpr",
  "soc 2",
  "iso 27001",
];

function isHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "") || "/";
    return path === "/";
  } catch {
    return false;
  }
}

/**
 * detect likely hallucination when reducto returns rich output from a page
 * that has no legal/terms content (e.g. marketing homepage).
 */
export function looksHallucinated(
  data: VendorStructuredData,
  sourceUrl: string,
  extractedText: string
): boolean {
  if (!data || typeof data !== "object") return false;
  const skipKeys = new Set(["summary", "rawText", "extractedText"]);
  const fieldCount = Object.keys(data).filter((k) => !skipKeys.has(k)).length;
  if (fieldCount < 4) return false;

  if (!isHomepage(sourceUrl)) return false;

  const text = extractedText.slice(0, 12000).toLowerCase();
  const hasLegalContent = LEGAL_KEYWORDS.some((kw) => text.includes(kw));
  if (hasLegalContent) return false;

  return true;
}
