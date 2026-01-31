/** normalize url for duplicate detection */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
}

/** get comparable key for duplicate detection */
export function getWebsiteKey(url: string): string {
  const u = normalizeUrl(url);
  if (!u) return "";
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`.toLowerCase().replace(/\/$/, "") || parsed.origin.toLowerCase();
  } catch {
    return u.toLowerCase();
  }
}

/** extract domain for grouping */
export function getDomain(url: string): string {
  const u = normalizeUrl(url);
  if (!u) return "";
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}
