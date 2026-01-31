import { createHash } from "crypto";

/** normalize text for consistent hashing */
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\n+/g, "\n");
}

/** sha-256 hash of normalized content for change detection */
export function hashContent(text: string): string {
  const normalized = normalizeText(text);
  return createHash("sha256").update(normalized).digest("hex");
}
