import { ObjectId } from "mongodb";
import { getVendorsCollection, getSnapshotsCollection, getRiskEventsCollection } from "../db/models";
import type { RiskEvent, ExternalSource, SnapshotStructuredData, ContextSource } from "../db/models";
import { hashContent } from "./hashing";
import { crawlVendor, crawlVendorSite, searchVendorNews } from "./firecrawl";
import { extractFromUrls, getExtractionUrls } from "./reducto";
import { filterStructuredData } from "./relevanceFilter";
import { looksHallucinated } from "./extraction-validation";
import { isRelevantVendorUrl, isOnVendorDomain } from "./urlFilter";
import { extractDocumentLinks } from "../utils/document-links";
import { getDomain } from "../utils/url";
import { buildCanonicalSummary, buildConciseSummary } from "./structured-summary";
import { extractRiskFindings, buildRecommendedActionsFromFindings } from "./risk-insights";
import { runRuleEngine, ruleResultToRiskEvent, type VendorStructuredData } from "./rule-engine";
import { getResearchMode } from "../config/research-mode";
import { analyzeContentChange, analyzeInitialContent } from "./llm-analysis";
import { sendRiskAlert } from "./alert";
import { debugLog } from "../debug-log";

export interface MonitorResult {
  vendorId: string;
  vendorName: string;
  status: "unchanged" | "changed" | "error" | "first_snapshot";
  error?: string;
  riskEventCreated?: boolean;
  pagesCrawled?: number;
  externalSourcesFound?: number;
}

export interface MonitorProgress {
  type: "progress" | "result" | "complete" | "error";
  current?: number;
  total?: number;
  vendorName?: string;
  result?: MonitorResult;
  results?: MonitorResult[];
  error?: string;
}

export type ProgressCallback = (progress: MonitorProgress) => void;

let cancelRequested = false;

function inferContextType(url: string): "news" | "status" | "blog" {
  try {
    const lower = url.toLowerCase();
    const host = new URL(url).hostname.toLowerCase();
    if (/\/status|\/status\/|status\./.test(lower) || /status\./.test(host)) return "status";
    if (/\/blog|\/blog\/|blog\./.test(lower)) return "blog";
  } catch {
    // ignore
  }
  return "blog";
}

function buildContextSources(
  vendorDomain: string,
  externalSources: ExternalSource[],
  crawledPages?: { url: string; title?: string }[]
): ContextSource[] {
  const seen = new Set<string>();
  const out: ContextSource[] = [];
  for (const s of externalSources) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    out.push({ url: s.url, title: s.title, type: s.source === "news" ? "news" : "blog" });
  }
  if (crawledPages) {
    for (const p of crawledPages) {
      if (!p.url || seen.has(p.url)) continue;
      if (!isOnVendorDomain(vendorDomain, p.url)) continue;
      if (isRelevantVendorUrl(vendorDomain, p.url)) continue;
      seen.add(p.url);
      out.push({ url: p.url, title: p.title, type: inferContextType(p.url) });
    }
  }
  return out;
}

export function requestCancellation() {
  cancelRequested = true;
}

export function resetCancellation() {
  cancelRequested = false;
}

/** run one monitoring cycle, scrape and compare per vendor, optional progress callback and vendor filter */
export async function runMonitorCycle(
  onProgress?: ProgressCallback,
  vendorIds?: string[]
): Promise<MonitorResult[]> {
  resetCancellation();
  const vendorsCol = await getVendorsCollection();
  const snapshotsCol = await getSnapshotsCollection();
  const riskEventsCol = await getRiskEventsCollection();

  let vendors = await vendorsCol.find({}).toArray();
  if (vendorIds && vendorIds.length > 0) {
    const validIds = vendorIds
      .filter((id) => id && /^[a-f0-9A-F]{24}$/.test(id))
      .map((id) => new ObjectId(id));
    vendors = vendors.filter((v) => v._id && validIds.some((oid) => oid.equals(v._id!)));
  }
  const results: MonitorResult[] = [];
  const total = vendors.length;

  for (let i = 0; i < vendors.length; i++) {
    if (cancelRequested) {
      onProgress?.({
        type: "complete",
        results,
      });
      return results;
    }

    const vendor = vendors[i];
    const vendorId = vendor._id!.toString();
    const vendorName = vendor.name;

    onProgress?.({
      type: "progress",
      current: i,
      total,
      vendorName,
    });

    try {
      // ensure url has protocol
      let url = vendor.website.trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        url = `https://${url}`;
      }

      const scrapeResult = await crawlVendor(url);

      if (!scrapeResult.success) {
        results.push({
          vendorId,
          vendorName,
          status: "error",
          error: scrapeResult.error,
        });
        onProgress?.({
          type: "result",
          current: i + 1,
          total,
          result: results[results.length - 1],
        });
        continue;
      }

      let extractedText = scrapeResult.markdown ?? "";

      // fetch last snapshot for this vendor
      const lastSnapshot = await snapshotsCol.findOne(
        { vendorId: vendor._id },
        { sort: { createdAt: -1 } }
      );

      // multi-page crawl on first snapshot only
      let pagesCrawled = 0;
      let crawledPages: { url: string; title?: string }[] = [];
      if (!lastSnapshot) {
        try {
          const crawlResult = await crawlVendorSite(url);
          if (crawlResult.success && crawlResult.markdown) {
            extractedText += `\n\n--- CRAWLED PAGES (${crawlResult.pagesCount}) ---\n${crawlResult.markdown}`;
            pagesCrawled = crawlResult.pagesCount;
            crawledPages = crawlResult.crawledPages ?? [];
          }
        } catch {
          // continue without crawl
        }
      }

      // search web and news for external risk signals (context only, not for structured extraction)
      let externalSources: ExternalSource[] = [];
      try {
        const searchResult = await searchVendorNews(vendorName);
        if (searchResult.success && searchResult.markdown) {
          extractedText += `\n\n--- EXTERNAL SEARCH (news/web) ---\n${searchResult.markdown}`;
          externalSources = searchResult.sources;
        }
      } catch {
        // continue without search
      }

      const contentHash = hashContent(extractedText);
      const isDeep = getResearchMode() === "deep";
      const vendorDomain = getDomain(url);
      const contextSources = buildContextSources(vendorDomain, externalSources, crawledPages);

      if (!lastSnapshot) {
        let firstStructured: SnapshotStructuredData | undefined;
        let extractionSourceUrl: string | undefined;
        try {
          const docLinks = extractDocumentLinks(extractedText, url);
          const urlsToTry = getExtractionUrls(docLinks, url);
          const vendorDomain = getDomain(url);
          const relevantUrls = urlsToTry.filter((u) => isRelevantVendorUrl(vendorDomain, u));
          if (relevantUrls.length === 0 && urlsToTry.length > 0) {
            console.warn(`No official policy or pricing URLs found for ${vendorName}`);
          }
          const result = await extractFromUrls(relevantUrls);
          if (result && Object.keys(result.data).length > 0) {
            if (!looksHallucinated(result.data, result.sourceUrl, extractedText)) {
              firstStructured = filterStructuredData(result.data) as SnapshotStructuredData;
              extractionSourceUrl = result.sourceUrl;
            }
          }
        } catch {
          // skip if extraction fails
        }

        await snapshotsCol.insertOne({
          vendorId: vendor._id,
          contentHash,
          extractedText,
          structuredData: firstStructured,
          sourceType: firstStructured ? "policy" : undefined,
          sourceUrl: extractionSourceUrl,
          contextSources: contextSources.length > 0 ? contextSources : undefined,
          createdAt: new Date(),
        });

        let severity: "low" | "medium" | "high";
        let type: string;
        let summary: string;
        let recommendedAction: string;
        let source: "rules" | "ai" = "ai";

        const canonicalSummary = buildCanonicalSummary(firstStructured);
        const conciseSummary = buildConciseSummary(firstStructured);

        if (isDeep) {
          const analysis = await analyzeInitialContent(
            vendorName,
            extractedText,
            firstStructured ?? undefined
          );
          severity = analysis.severity;
          type = analysis.type;
          summary = canonicalSummary
            ? `${analysis.summary}\n\n${canonicalSummary}`
            : analysis.summary;
          recommendedAction = analysis.recommendedAction;
          source = "ai";
        } else {
          const ruleResults = runRuleEngine(null, firstStructured ?? null);
          const ruleEvent = ruleResultToRiskEvent(
            ruleResults,
            canonicalSummary || "Initial baseline established. Content stored for future comparison.",
            "1) Run the monitor periodically to detect changes. 2) Review vendor terms and structured data in the dashboard."
          );
          severity = ruleEvent.severity;
          type = ruleEvent.type;
          summary = canonicalSummary || ruleEvent.summary;
          recommendedAction = ruleEvent.recommendedAction;
          source = "rules";
        }

        const structuredInsights = conciseSummary || (canonicalSummary ? canonicalSummary.slice(0, 500) : undefined);
        const riskFindings = extractRiskFindings(firstStructured).map((f) => ({
          category: f.category,
          finding: f.finding,
        }));
        const findingsBasedActions = buildRecommendedActionsFromFindings(
          riskFindings.map((f) => ({ category: f.category, finding: f.finding, concern: undefined }))
        );
        if (findingsBasedActions) recommendedAction = findingsBasedActions;

        debugLog("monitor.ts:first_snapshot:beforeAlert", "first_snapshot before sendRiskAlert", { vendorName, severity }, "H4");
        // send alert based on user severity prefs
        const alertSent = await sendRiskAlert({
          vendorName,
          vendorWebsite: url,
          severity,
          type,
          summary,
          recommendedAction,
        });

        debugLog("monitor.ts:first_snapshot:afterAlert", "first_snapshot after sendRiskAlert", { vendorName, alertSent }, "H4");
        await riskEventsCol.insertOne({
          vendorId: vendor._id,
          severity,
          type,
          summary,
          recommendedAction,
          structuredInsights,
          riskFindings: riskFindings.length > 0 ? riskFindings : undefined,
          structuredFindings: firstStructured ?? undefined,
          source,
          alertSent,
          externalSources: externalSources.length > 0 ? externalSources : undefined,
          contextSources: contextSources.length > 0 ? contextSources : undefined,
          createdAt: new Date(),
        });

        results.push({
          vendorId,
          vendorName,
          status: "first_snapshot",
          riskEventCreated: true,
          pagesCrawled: pagesCrawled > 0 ? pagesCrawled : undefined,
          externalSourcesFound: externalSources.length > 0 ? externalSources.length : undefined,
        });
        onProgress?.({
          type: "result",
          current: i + 1,
          total,
          result: results[results.length - 1],
        });
        continue;
      }

      if (lastSnapshot.contentHash === contentHash) {
        results.push({
          vendorId,
          vendorName,
          status: "unchanged",
          pagesCrawled: pagesCrawled > 0 ? pagesCrawled : undefined,
          externalSourcesFound: externalSources.length > 0 ? externalSources.length : undefined,
        });
        onProgress?.({
          type: "result",
          current: i + 1,
          total,
          result: results[results.length - 1],
        });
        continue;
      }

      let newStructured: SnapshotStructuredData | undefined;
      let extractionSourceUrl: string | undefined;
      try {
        const docLinks = extractDocumentLinks(extractedText, url);
        const urlsToTry = getExtractionUrls(docLinks, url);
        const relevantUrls = urlsToTry.filter((u) => isRelevantVendorUrl(vendorDomain, u));
        if (relevantUrls.length === 0 && urlsToTry.length > 0) {
          console.warn(`No official policy or pricing URLs found for ${vendorName}`);
        }
        const result = await extractFromUrls(relevantUrls);
        if (result && Object.keys(result.data).length > 0) {
          if (!looksHallucinated(result.data, result.sourceUrl, extractedText)) {
            newStructured = filterStructuredData(result.data) as SnapshotStructuredData;
            extractionSourceUrl = result.sourceUrl;
          }
        }
      } catch {
        // skip if extraction fails
      }

      await snapshotsCol.insertOne({
        vendorId: vendor._id,
        contentHash,
        extractedText,
        structuredData: newStructured,
        sourceType: newStructured ? "policy" : undefined,
        sourceUrl: extractionSourceUrl,
        contextSources: contextSources.length > 0 ? contextSources : undefined,
        createdAt: new Date(),
      });

      const prevStructured = (lastSnapshot as { structuredData?: VendorStructuredData }).structuredData ?? null;
      const ruleResults = runRuleEngine(prevStructured, (newStructured ?? null) as VendorStructuredData);

      const canonicalSummary = buildCanonicalSummary(newStructured);
      const conciseSummary = buildConciseSummary(newStructured);

      let severity: "low" | "medium" | "high";
      let type: string;
      let summary: string;
      let recommendedAction: string;
      let source: "rules" | "ai" = "ai";

      if (isDeep) {
        const analysis = await analyzeContentChange(
          vendorName,
          lastSnapshot.extractedText,
          extractedText,
          newStructured ?? null
        );
        severity = analysis.severity;
        type = analysis.type;
        summary = canonicalSummary
          ? `${analysis.summary}\n\n${canonicalSummary}`
          : analysis.summary;
        recommendedAction = analysis.recommendedAction;
        source = "ai";
      } else {
        const ruleEvent = ruleResultToRiskEvent(
          ruleResults,
          canonicalSummary || "Vendor content changed. No structured field changes detected by rules; review extracted content.",
          "1) Review the extracted content and structured data in the dashboard. 2) Run monitor again after vendor updates documents."
        );
        severity = ruleEvent.severity;
        type = ruleEvent.type;
        summary = canonicalSummary || ruleEvent.summary;
        recommendedAction = ruleEvent.recommendedAction;
        source = "rules";
      }

      const structuredInsights = conciseSummary || (canonicalSummary ? canonicalSummary.slice(0, 500) : undefined);
      const riskFindings = extractRiskFindings(newStructured).map((f) => ({
        category: f.category,
        finding: f.finding,
      }));
      const findingsBasedActions = buildRecommendedActionsFromFindings(
        riskFindings.map((f) => ({ category: f.category, finding: f.finding, concern: undefined }))
      );
      if (findingsBasedActions) recommendedAction = findingsBasedActions;

      debugLog("monitor.ts:changed:beforeAlert", "changed before sendRiskAlert", { vendorName, severity }, "H4");
      const alertSent = await sendRiskAlert({
        vendorName,
        vendorWebsite: url,
        severity,
        type,
        summary,
        recommendedAction,
      });

      debugLog("monitor.ts:changed:afterAlert", "changed after sendRiskAlert", { vendorName, alertSent }, "H4");
      const riskEvent: Omit<RiskEvent, "_id"> = {
        vendorId: vendor._id,
        severity,
        type,
        summary,
        recommendedAction,
        structuredInsights,
        riskFindings: riskFindings.length > 0 ? riskFindings : undefined,
        structuredFindings: newStructured ?? undefined,
        source,
        alertSent,
        externalSources: externalSources.length > 0 ? externalSources : undefined,
        contextSources: contextSources.length > 0 ? contextSources : undefined,
        createdAt: new Date(),
      };

      await riskEventsCol.insertOne(riskEvent);

      results.push({
        vendorId,
        vendorName,
        status: "changed",
        riskEventCreated: true,
        pagesCrawled: pagesCrawled > 0 ? pagesCrawled : undefined,
        externalSourcesFound: externalSources.length > 0 ? externalSources.length : undefined,
      });
      onProgress?.({
        type: "result",
        current: i + 1,
        total,
        result: results[results.length - 1],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      results.push({
        vendorId,
        vendorName,
        status: "error",
        error: message,
      });
      onProgress?.({
        type: "result",
        current: i + 1,
        total,
        result: results[results.length - 1],
      });
    }
  }

  onProgress?.({
    type: "complete",
    results,
  });
  return results;
}
