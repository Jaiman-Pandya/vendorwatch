import Firecrawl from "@mendable/firecrawl-js";

const apiKey = process.env.FIRECRAWL_API_KEY;
const firecrawl = apiKey
  ? new Firecrawl({ apiKey, timeoutMs: 60000, maxRetries: 2 })
  : null;

export interface ScrapeResult {
  markdown?: string;
  html?: string;
  success: boolean;
  error?: string;
}

export interface ExternalSource {
  url: string;
  title?: string;
  snippet?: string;
  source: "news" | "web";
}

export interface CrawlResult {
  success: boolean;
  markdown: string;
  pagesCount: number;
  error?: string;
}

export interface SearchResult {
  success: boolean;
  sources: ExternalSource[];
  markdown: string;
  error?: string;
}

/**
 * Crawl vendor website — scrapes main URL. Handles retries and timeouts.
 * Used for homepage, pricing, and policy page content.
 */
export async function crawlVendor(url: string): Promise<ScrapeResult> {
  return scrapeUrl(url);
}

/**
 * Multi-page crawl of vendor site. Follows links to terms, privacy, pricing, legal.
 * Limit 3 pages to control cost. Use for richer baseline and change detection.
 */
export async function crawlVendorSite(url: string): Promise<CrawlResult> {
  if (!firecrawl) {
    return { success: false, markdown: "", pagesCount: 0, error: "Firecrawl API key not configured" };
  }

  try {
    const job = await firecrawl.crawl(url, {
      limit: 3,
      maxDiscoveryDepth: 2,
      scrapeOptions: { formats: ["markdown"], timeout: 25000 },
      crawlEntireDomain: true,
      pollInterval: 3,
      timeout: 120,
    });

    if (job.status !== "completed") {
      return {
        success: false,
        markdown: "",
        pagesCount: 0,
        error: `Crawl ${job.status}`,
      };
    }

    const pages = job.data ?? [];
    const markdownParts = pages
      .filter((d) => d.markdown?.trim())
      .map((d) => {
        const meta = d.metadata as { sourceURL?: string } | undefined;
        const src = meta?.sourceURL ?? "unknown";
        return `--- Page: ${src} ---\n${d.markdown}`;
      });
    const markdown = markdownParts.join("\n\n");

    return {
      success: true,
      markdown,
      pagesCount: pages.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Crawl failed";
    return { success: false, markdown: "", pagesCount: 0, error: message };
  }
}

/**
 * Search the web for vendor + risk keywords (breach, security, layoffs, etc.).
 * Returns news and web results for external risk intelligence.
 */
export async function searchVendorNews(vendorName: string): Promise<SearchResult> {
  if (!firecrawl) {
    return { success: false, sources: [], markdown: "", error: "Firecrawl API key not configured" };
  }

  const query = `"${vendorName}" (breach OR security OR layoffs OR incident OR outage OR lawsuit)`;
  try {
    const data = await firecrawl.search(query, {
      limit: 5,
      sources: ["web", "news"],
      tbs: "qdr:w",
      scrapeOptions: { formats: ["markdown"], timeout: 15000 },
    });

    const sources: ExternalSource[] = [];
    const markdownParts: string[] = [];

    const newsItems = (data?.news ?? []) as Array<{ title?: string; url?: string; snippet?: string; markdown?: string }>;
    for (const n of newsItems) {
      if (n.url) {
        sources.push({ url: n.url, title: n.title, snippet: n.snippet, source: "news" });
        const text = n.markdown ?? n.snippet ?? n.title ?? "";
        if (text) markdownParts.push(`[NEWS] ${n.title ?? "Untitled"}\n${text}`);
      }
    }

    const webItems = (data?.web ?? []) as Array<{ title?: string; url?: string; description?: string; markdown?: string }>;
    for (const w of webItems) {
      if (w.url && !sources.some((s) => s.url === w.url)) {
        sources.push({ url: w.url, title: w.title, snippet: w.description, source: "web" });
        const text = w.markdown ?? w.description ?? w.title ?? "";
        if (text) markdownParts.push(`[WEB] ${w.title ?? "Untitled"}\n${text}`);
      }
    }

    const markdown = markdownParts.join("\n\n---\n\n");
    return { success: true, sources, markdown };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return { success: false, sources: [], markdown: "", error: message };
  }
}

/**
 * Scrape a single URL and return markdown/text content.
 * Uses Firecrawl with retries and timeout per the backend plan.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  if (!firecrawl) {
    return {
      success: false,
      error: "Firecrawl API key not configured",
    };
  }

  try {
    const doc = await firecrawl.scrape(url, {
      formats: ["markdown"],
      timeout: 30000,
    });

    const markdown = doc?.markdown ?? "";
    return {
      markdown,
      html: doc?.html,
      success: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed";
    return {
      success: false,
      error: message,
    };
  }
}
