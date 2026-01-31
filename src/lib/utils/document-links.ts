/** extract document urls from markdown for reducto */
export function extractDocumentLinks(
  markdown: string,
  baseUrl: string
): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  try {
    const base = new URL(baseUrl);
    const baseOrigin = base.origin;

    // match markdown links
    const mdLinkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdLinkRegex.exec(markdown)) !== null) {
      const url = m[1]?.trim();
      if (!url || url.length < 5 || url.startsWith("#") || url.startsWith("mailto:")) continue;

      try {
        const resolved = url.startsWith("http") ? new URL(url) : new URL(url, baseOrigin);
        const href = resolved.href;
        const isDoc =
          href.endsWith(".pdf") ||
          /\/terms|\/privacy|\/policy|\/tos|\/legal|\/compliance/i.test(href);
        if (isDoc && !seen.has(href)) {
          seen.add(href);
          links.push(href);
        }
      } catch {
        // skip invalid urls
      }
    }

    // plain pdf urls
    const pdfRegex = /https?:\/\/[^\s\)\]"'<>]+\.pdf/gi;
    while ((m = pdfRegex.exec(markdown)) !== null) {
      const url = m[0];
      if (!seen.has(url)) {
        seen.add(url);
        links.push(url);
      }
    }

    return links.slice(0, 3);
  } catch {
    return [];
  }
}
