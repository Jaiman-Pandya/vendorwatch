import Anthropic from "@anthropic-ai/sdk";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

export interface RiskAnalysis {
  severity: "low" | "medium" | "high";
  type: string;
  summary: string;
  recommendedAction: string;
}

/** Explicit severity rubric used in LLM prompts for consistent risk classification. */
export const SEVERITY_GUIDE = `
SEVERITY DEFINITIONS (use these strictly):
- low: Cosmetic or routine only. No contract, security, or compliance impact. Examples: nav change, marketing copy, new blog post.
- medium: Worth review but not urgent. Examples: pricing clarification, SLA wording tweak, new FAQ, minor policy update.
- high: Significant impact on liability, security, pricing, or compliance. Examples: new liability cap, data handling change, price increase, breach notice.
`;

const MVP_FALLBACK: RiskAnalysis = {
  severity: "medium",
  type: "content_change",
  summary: "Vendor page content changed since last check. A change was detected but detailed analysis is unavailable.",
  recommendedAction: "1) Review the extracted content in the dashboard. 2) Run the monitor again to capture analysis.",
};

const INITIAL_FALLBACK: RiskAnalysis = {
  severity: "low",
  type: "initial_scan",
  summary: "Initial baseline established. Content has been stored for future comparison.",
  recommendedAction: "1) Run the monitor periodically to detect changes. 2) Review vendor terms and policies as needed.",
};

/**
 * Analyze extracted content on first scrape (no previous content to compare).
 */
export async function analyzeInitialContent(
  vendorName: string,
  content: string
): Promise<RiskAnalysis> {
  if (!anthropic) {
    return INITIAL_FALLBACK;
  }

  const preview = content.slice(0, 4000);

  const prompt = `You are a vendor risk analyst. A company is establishing a baseline for vendor "${vendorName}". This is the first time we've scraped their website.

EXTRACTED CONTENT (excerpt):
---
${preview}
---

Provide an initial risk assessment. Respond with JSON only (no markdown):
{
  "severity": "low" | "medium" | "high",
  "type": "pricing" | "legal" | "security" | "sla" | "compliance" | "initial_scan" | "other",
  "summary": "Detailed analysis (2-4 sentences): what's on the page, which risk areas matter (pricing, legal, security, compliance), why it matters to a company relying on this vendor",
  "recommendedAction": "Numbered action steps. Format: 1) [Step]. 2) [Step]. 3) [Step if needed]. Each step must be clear and actionable."
}
${SEVERITY_GUIDE}
Respond with valid JSON only.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1536,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    if (!text) return INITIAL_FALLBACK;

    const parsed = JSON.parse(text) as RiskAnalysis;
    if (!parsed.severity || !["low", "medium", "high"].includes(parsed.severity)) {
      return INITIAL_FALLBACK;
    }
    return {
      severity: parsed.severity,
      type: parsed.type ?? "initial_scan",
      summary: parsed.summary ?? INITIAL_FALLBACK.summary,
      recommendedAction: parsed.recommendedAction ?? INITIAL_FALLBACK.recommendedAction,
    };
  } catch {
    return INITIAL_FALLBACK;
  }
}

/**
 * Analyze vendor content change using Claude to determine risk severity and impact.
 * Optionally includes structured document data from Reducto for richer analysis.
 */
export async function analyzeContentChange(
  vendorName: string,
  oldContent: string,
  newContent: string,
  structuredData?: Record<string, unknown> | null
): Promise<RiskAnalysis> {
  if (!anthropic) {
    return MVP_FALLBACK;
  }

  const oldPreview = oldContent.slice(0, 3000);
  const newPreview = newContent.slice(0, 3000);
  const structuredSection = structuredData && Object.keys(structuredData).length > 0
    ? `\n\nADDITIONAL STRUCTURED DATA (from vendor Terms/Policy PDFs via Reducto):\n${JSON.stringify(structuredData, null, 2)}`
    : "";

  const prompt = `You are a vendor risk analyst. A company monitors vendor websites for changes. The following content change was detected for vendor "${vendorName}".

PREVIOUS CONTENT (excerpt):
---
${oldPreview}
---

NEW CONTENT (excerpt):
---
${newPreview}
---${structuredSection}

Analyze this change and respond with JSON only (no markdown, no explanation):
{
  "severity": "low" | "medium" | "high",
  "type": "pricing" | "legal" | "security" | "sla" | "compliance" | "content_change" | "other",
  "summary": "Detailed analysis (3-5 sentences): what specifically changed, where it appears, why it matters to vendor risk, which risk areas are affected (pricing/legal/security/compliance). Be specific.",
  "recommendedAction": "Numbered action steps. Format: 1) [Step]. 2) [Step]. 3) [Step if needed]. Each step must be clear, concrete, and actionable."
}
${SEVERITY_GUIDE}
Respond with valid JSON only.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1536,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const content = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    if (!content) return MVP_FALLBACK;

    const parsed = JSON.parse(content) as RiskAnalysis;
    if (
      !parsed.severity ||
      !["low", "medium", "high"].includes(parsed.severity)
    ) {
      return MVP_FALLBACK;
    }
    return {
      severity: parsed.severity,
      type: parsed.type ?? "content_change",
      summary: parsed.summary ?? MVP_FALLBACK.summary,
      recommendedAction: parsed.recommendedAction ?? MVP_FALLBACK.recommendedAction,
    };
  } catch {
    return MVP_FALLBACK;
  }
}
