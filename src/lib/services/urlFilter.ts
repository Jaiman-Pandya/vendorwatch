/** rule-based url filtering for structured extraction. only official policy, pricing, legal, security, sla pages. */

const PATH_ALLOW = [
  "terms",
  "legal",
  "privacy",
  "security",
  "trust",
  "sla",
  "uptime",
  "compliance",
  "dpa",
  "data-processing",
  "subprocessor",
  "pricing",
  "fees",
  "billing",
  "support",
];

const PATH_BLOCK = [
  "blog",
  "news",
  "press",
  "media",
  "events",
  "community",
  "forum",
  "careers",
  "about",
  "investors",
  "stories",
  "case-study",
];

function getRootDomain(hostname: string): string {
  const stripped = hostname.replace(/^www\./i, "");
  const parts = stripped.split(".");
  if (parts.length >= 3) {
    const twoPartTlds = ["co.uk", "com.au", "co.nz", "co.jp", "com.br"];
    const lastTwo = parts.slice(-2).join(".");
    if (twoPartTlds.includes(lastTwo)) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  }
  return stripped;
}

function isOnVendorDomain(vendorDomain: string, url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const root = getRootDomain(vendorDomain.toLowerCase());
    const urlRoot = getRootDomain(host);
    if (urlRoot !== root) return false;
    return host === root || host === `www.${root}` || host.endsWith(`.${root}`);
  } catch {
    return false;
  }
}


function hasAllowedPathKeyword(url: string): boolean {
  const lower = url.toLowerCase();
  for (const kw of PATH_ALLOW) {
    if (lower.includes(`/${kw}`) || lower.includes(`/${kw}/`) || lower.includes(`-${kw}-`) || lower.includes(`-${kw}`) || lower.endsWith(`-${kw}`)) {
      return true;
    }
  }
  const path = new URL(url).pathname.toLowerCase();
  for (const kw of PATH_ALLOW) {
    if (path.includes(kw)) return true;
  }
  return false;
}

function hasBlockedPathKeyword(url: string): boolean {
  const lower = url.toLowerCase();
  for (const kw of PATH_BLOCK) {
    if (lower.includes(`/${kw}`) || lower.includes(`/${kw}/`) || lower.includes(`-${kw}-`) || lower.includes(`-${kw}`) || lower.includes(kw)) {
      return true;
    }
  }
  return false;
}

/** returns true only if url is on vendor domain (strict hostname), has an allowed path keyword, and lacks blocked keywords */
export function isRelevantVendorUrl(vendorDomain: string, url: string): boolean {
  if (!vendorDomain?.trim() || !url?.trim()) return false;
  try {
    new URL(url);
  } catch {
    return false;
  }
  if (!isOnVendorDomain(vendorDomain, url)) return false;
  if (hasBlockedPathKeyword(url)) return false;
  if (!hasAllowedPathKeyword(url)) return false;
  return true;
}
