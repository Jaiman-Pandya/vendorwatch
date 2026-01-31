import Anthropic from "@anthropic-ai/sdk";
import { buildCanonicalSummary } from "./structured-summary";
import { extractRiskFindings, buildRecommendedActionsFromFindings } from "./risk-insights";

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

function getContentChangeFallback(structuredData?: Record<string, unknown> | null): RiskAnalysis {
  const canonical = structuredData && Object.keys(structuredData).length > 0
    ? buildCanonicalSummary(structuredData)
    : "";
  const findings = extractRiskFindings(structuredData);
  const actionsFromFindings = buildRecommendedActionsFromFindings(findings);
  const recommendedAction = actionsFromFindings
    ? actionsFromFindings
    : canonical
      ? "1) Review the structured data and findings above. 2) Address each risk category per the recommended actions. 3) Run the monitor periodically to detect future changes."
      : "1) Review the extracted content in the dashboard. 2) Run the monitor again after vendor updates documents.";
  return {
    severity: "medium",
    type: "content_change",
    summary: canonical
      ? `Vendor page content changed. Extracted terms:\n\n${canonical}`
      : "Vendor page content changed. No linked Terms/Privacy documents found; review extracted content in the dashboard.",
    recommendedAction,
  };
}

function getInitialFallback(structuredData?: Record<string, unknown> | null): RiskAnalysis {
  const canonical = structuredData && Object.keys(structuredData).length > 0
    ? buildCanonicalSummary(structuredData)
    : "";
  const findings = extractRiskFindings(structuredData);
  const actionsFromFindings = buildRecommendedActionsFromFindings(findings);
  const recommendedAction = actionsFromFindings || "1) Run the monitor periodically to detect changes. 2) Review vendor terms and policies as needed.";
  return {
    severity: "low",
    type: "initial_scan",
    summary: canonical
      ? `Initial baseline established. Extracted terms:\n\n${canonical}`
      : "Initial baseline established. Content has been stored for future comparison.",
    recommendedAction,
  };
}

/**
 * Analyze extracted content on first scrape (no previous content to compare).
 * Uses structured data from Reducto as ground truth when available.
 */
export async function analyzeInitialContent(
  vendorName: string,
  content: string,
  structuredData?: Record<string, unknown> | null
): Promise<RiskAnalysis> {
  const fallback = getInitialFallback(structuredData);
  if (!anthropic) return fallback;

  const preview = content.slice(0, 4000);
  const structuredSection =
    structuredData && Object.keys(structuredData).length > 0
      ? `\n\nSTRUCTURED DATA (from Terms/Policy/PDF via Reducto — use as ground truth):\n${JSON.stringify(structuredData, null, 2)}\n\nBase your summary on these concrete facts. Cite specific numbers, locations, certifications.`
      : "";

  const prompt = `You are a vendor risk analyst. A company is establishing a baseline for vendor "${vendorName}". This is the first time we've scraped their website.

EXTRACTED CONTENT (excerpt):
---
${preview}
---${structuredSection}

Provide an initial risk assessment. Respond with JSON only (no markdown):
{
  "severity": "low" | "medium" | "high",
  "type": "pricing" | "legal" | "security" | "sla" | "compliance" | "initial_scan" | "other",
  "summary": "Concrete analysis (3-5 sentences): cite specific terms from the structured data — liability caps, data locations, SLA numbers, certifications. Label each risk area (Legal, Data & Security, Financial, Operational) when relevant. Never say 'analysis unavailable'.",
  "recommendedAction": "Comprehensive numbered steps. First list risks/liabilities found (by category: Legal, Data & Security, Financial, Operational). Then list recommended actions tied to each risk. Format: 1) [Action]. 2) [Action]. 3) [Action]. 4) [Action]. Each step must be concrete and actionable. Include at least 4-6 steps when multiple risk areas exist."
}
${SEVERITY_GUIDE}
Respond with valid JSON only.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    if (!text) return fallback;

    const parsed = JSON.parse(text) as RiskAnalysis;
    if (!parsed.severity || !["low", "medium", "high"].includes(parsed.severity)) {
      return fallback;
    }
    const recommendedAction = parsed.recommendedAction?.trim();
    const isGeneric = !recommendedAction || recommendedAction.length < 80 || /analysis is unavailable|detailed analysis unavailable/i.test(recommendedAction);
    return {
      severity: parsed.severity,
      type: parsed.type ?? "initial_scan",
      summary: parsed.summary ?? fallback.summary,
      recommendedAction: (recommendedAction && !isGeneric) ? recommendedAction : fallback.recommendedAction,
    };
  } catch {
    return fallback;
  }
}

/**
 * Analyze vendor content change using Claude to determine risk severity and impact.
 * Uses structured data from Reducto as ground truth when available.
 */
export async function analyzeContentChange(
  vendorName: string,
  oldContent: string,
  newContent: string,
  structuredData?: Record<string, unknown> | null
): Promise<RiskAnalysis> {
  const fallback = getContentChangeFallback(structuredData);
  if (!anthropic) return fallback;

  const oldPreview = oldContent.slice(0, 3000);
  const newPreview = newContent.slice(0, 3000);
  const structuredSection =
    structuredData && Object.keys(structuredData).length > 0
      ? `\n\nSTRUCTURED DATA (from Terms/Policy/PDF via Reducto — use as ground truth for what changed):\n${JSON.stringify(structuredData, null, 2)}\n\nBase your summary on these concrete facts. Cite specific numbers, locations, certifications. Avoid generic phrases like "analysis unavailable".`
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
  "summary": "Concrete analysis (4-6 sentences): what specifically changed, cite exact terms from structured data — liability caps, data locations, SLA numbers, certifications. Label each risk area (Legal, Data & Security, Financial, Operational). Never say 'analysis unavailable' or 'detailed analysis unavailable'.",
  "recommendedAction": "Comprehensive numbered steps. First list risks/liabilities found by category. Then list recommended actions. Format: 1) [Action]. 2) [Action]. 3) [Action]. 4) [Action]. Include 4-6 concrete steps. Each step must reference specific risks when relevant."
}
${SEVERITY_GUIDE}
Respond with valid JSON only.`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const text = textBlock && "text" in textBlock ? textBlock.text.trim() : "";
    if (!text) return fallback;

    const parsed = JSON.parse(text) as RiskAnalysis;
    if (
      !parsed.severity ||
      !["low", "medium", "high"].includes(parsed.severity)
    ) {
      return fallback;
    }
    const recommendedAction = parsed.recommendedAction?.trim();
    const isGeneric = !recommendedAction || recommendedAction.length < 80 || /analysis is unavailable|detailed analysis unavailable/i.test(recommendedAction);
    return {
      severity: parsed.severity,
      type: parsed.type ?? "content_change",
      summary: parsed.summary ?? fallback.summary,
      recommendedAction: (recommendedAction && !isGeneric) ? recommendedAction : fallback.recommendedAction,
    };
  } catch {
    return fallback;
  }
}
