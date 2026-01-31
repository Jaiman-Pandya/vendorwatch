import { ObjectId } from "mongodb";
import { getVendorsCollection, getSnapshotsCollection, getRiskEventsCollection } from "../db/models";
import type { RiskEvent, ExternalSource, SnapshotStructuredData } from "../db/models";
import { hashContent } from "./hashing";
import { crawlVendor, crawlVendorSite, searchVendorNews } from "./firecrawl";
import { extractFromUrls, getExtractionUrls } from "./reducto";
import { extractDocumentLinks } from "../utils/document-links";
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

export function requestCancellation() {
  cancelRequested = true;
}

export function resetCancellation() {
  cancelRequested = false;
}

/**
 * Run one monitoring cycle: for each vendor, scrape, compare hash, store snapshot, create risk event if changed.
 * Supports real-time progress callbacks and cancellation.
 * @param onProgress - optional callback for progress/result events
 * @param vendorIds - optional list of vendor IDs to monitor; if omitted, all vendors are monitored
 */
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
      // Ensure URL has protocol
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

      // Fetch last snapshot for this vendor
      const lastSnapshot = await snapshotsCol.findOne(
        { vendorId: vendor._id },
        { sort: { createdAt: -1 } }
      );

      // Multi-page crawl of vendor site (only on first snapshot to speed up monitoring)
      let pagesCrawled = 0;
      if (!lastSnapshot) {
        try {
          const crawlResult = await crawlVendorSite(url);
          if (crawlResult.success && crawlResult.markdown) {
            extractedText += `\n\n--- CRAWLED PAGES (${crawlResult.pagesCount}) ---\n${crawlResult.markdown}`;
            pagesCrawled = crawlResult.pagesCount;
          }
        } catch {
          // Continue without crawl — don't block monitoring
        }
      }

      // Search web/news for external risk signals (every cycle)
      let externalSources: ExternalSource[] = [];
      try {
        const searchResult = await searchVendorNews(vendorName);
        if (searchResult.success && searchResult.markdown) {
          extractedText += `\n\n--- EXTERNAL SEARCH (news/web) ---\n${searchResult.markdown}`;
          externalSources = searchResult.sources;
        }
      } catch {
        // Continue without search — don't block monitoring
      }

      const contentHash = hashContent(extractedText);
      const isDeep = getResearchMode() === "deep";

      if (!lastSnapshot) {
        // Extract structured data from linked docs and common legal paths
        let firstStructured: SnapshotStructuredData | undefined;
        try {
          const docLinks = extractDocumentLinks(extractedText, url);
          const urlsToTry = getExtractionUrls(docLinks, url);
          const data = await extractFromUrls(urlsToTry);
          if (data && Object.keys(data).length > 0) {
            firstStructured = data as SnapshotStructuredData;
          }
        } catch {
          // continue without structured
        }

        await snapshotsCol.insertOne({
          vendorId: vendor._id,
          contentHash,
          extractedText,
          structuredData: firstStructured,
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

        // #region agent log
        debugLog("monitor.ts:first_snapshot:beforeAlert", "first_snapshot before sendRiskAlert", { vendorName, severity }, "H4");
        // #endregion
        // Let sendRiskAlert check user's selected severities (low/medium/high)
        const alertSent = await sendRiskAlert({
          vendorName,
          vendorWebsite: url,
          severity,
          type,
          summary,
          recommendedAction,
        });

        // #region agent log
        debugLog("monitor.ts:first_snapshot:afterAlert", "first_snapshot after sendRiskAlert", { vendorName, alertSent }, "H4");
        // #endregion
        await riskEventsCol.insertOne({
          vendorId: vendor._id,
          severity,
          type,
          summary,
          recommendedAction,
          structuredInsights,
          riskFindings: riskFindings.length > 0 ? riskFindings : undefined,
          source,
          alertSent,
          externalSources: externalSources.length > 0 ? externalSources : undefined,
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

      // Extract structured data via Reducto
      let newStructured: SnapshotStructuredData | undefined;
      try {
        const docLinks = extractDocumentLinks(extractedText, url);
        const urlsToTry = getExtractionUrls(docLinks, url);
        const data = await extractFromUrls(urlsToTry);
        if (data && Object.keys(data).length > 0) {
          newStructured = data as SnapshotStructuredData;
        }
      } catch {
        // continue without structured
      }

      await snapshotsCol.insertOne({
        vendorId: vendor._id,
        contentHash,
        extractedText,
        structuredData: newStructured,
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

      // Let sendRiskAlert check user's selected severities (low/medium/high)
      // #region agent log
      debugLog("monitor.ts:changed:beforeAlert", "changed before sendRiskAlert", { vendorName, severity }, "H4");
      // #endregion
      const alertSent = await sendRiskAlert({
        vendorName,
        vendorWebsite: url,
        severity,
        type,
        summary,
        recommendedAction,
      });

      // #region agent log
      debugLog("monitor.ts:changed:afterAlert", "changed after sendRiskAlert", { vendorName, alertSent }, "H4");
      // #endregion
      const riskEvent: Omit<RiskEvent, "_id"> = {
        vendorId: vendor._id,
        severity,
        type,
        summary,
        recommendedAction,
        structuredInsights,
        riskFindings: riskFindings.length > 0 ? riskFindings : undefined,
        source,
        alertSent,
        externalSources: externalSources.length > 0 ? externalSources : undefined,
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
