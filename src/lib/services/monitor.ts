import { getVendorsCollection, getSnapshotsCollection, getRiskEventsCollection } from "../db/models";
import type { RiskEvent, ExternalSource } from "../db/models";
import { hashContent } from "./hashing";
import { crawlVendor, crawlVendorSite, searchVendorNews } from "./firecrawl";
import { extractStructuredData } from "./reducto";
import { extractDocumentLinks } from "../utils/document-links";
import { analyzeContentChange, analyzeInitialContent } from "./llm-analysis";
import { sendRiskAlert } from "./alert";

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
 */
export async function runMonitorCycle(onProgress?: ProgressCallback): Promise<MonitorResult[]> {
  resetCancellation();
  const vendorsCol = await getVendorsCollection();
  const snapshotsCol = await getSnapshotsCollection();
  const riskEventsCol = await getRiskEventsCollection();

  const vendors = await vendorsCol.find({}).toArray();
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

      if (!lastSnapshot) {
        // First snapshot - store it and run initial risk analysis
        await snapshotsCol.insertOne({
          vendorId: vendor._id,
          contentHash,
          extractedText,
          createdAt: new Date(),
        });

        const analysis = await analyzeInitialContent(vendorName, extractedText);

        const alertSent =
          analysis.severity !== "low" &&
          (await sendRiskAlert({
            vendorName,
            vendorWebsite: url,
            severity: analysis.severity,
            type: analysis.type,
            summary: analysis.summary,
            recommendedAction: analysis.recommendedAction,
          }));

        await riskEventsCol.insertOne({
          vendorId: vendor._id,
          severity: analysis.severity,
          type: analysis.type,
          summary: analysis.summary,
          recommendedAction: analysis.recommendedAction,
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

      // Content changed - store new snapshot
      await snapshotsCol.insertOne({
        vendorId: vendor._id,
        contentHash,
        extractedText,
        createdAt: new Date(),
      });

      // Extract linked documents (PDFs, terms, policy) via Reducto
      let structuredData: Record<string, unknown> | null = null;
      try {
        const docLinks = extractDocumentLinks(extractedText, url);
        for (const docUrl of docLinks) {
          const data = await extractStructuredData(docUrl);
          if (data) {
            structuredData = { ...(structuredData ?? {}), ...data };
            break; // Use first successful extraction to limit cost
          }
        }
      } catch {
        // Continue without structured data — don't block monitoring
      }

      // LLM risk analysis (with optional Reducto structured data)
      const analysis = await analyzeContentChange(
        vendorName,
        lastSnapshot.extractedText,
        extractedText,
        structuredData
      );

      // Send Resend alert for medium/high severity (if configured)
      const alertSent =
        analysis.severity !== "low" &&
        (await sendRiskAlert({
          vendorName,
          vendorWebsite: url,
          severity: analysis.severity,
          type: analysis.type,
          summary: analysis.summary,
          recommendedAction: analysis.recommendedAction,
        }));

      const riskEvent: Omit<RiskEvent, "_id"> = {
        vendorId: vendor._id,
        severity: analysis.severity,
        type: analysis.type,
        summary: analysis.summary,
        recommendedAction: analysis.recommendedAction,
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
