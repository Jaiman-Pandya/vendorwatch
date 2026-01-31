import { createHash } from "crypto";

/**
 * Normalize text for consistent hashing:
 * - Trim whitespace
 * - Collapse multiple spaces/newlines
 * - Lowercase for case-insensitive comparison (optional - we keep case for now)
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\n+/g, "\n");
}

/**
 * Generate SHA-256 hash of normalized content for change detection.
 */
export function hashContent(text: string): string {
  const normalized = normalizeText(text);
  return createHash("sha256").update(normalized).digest("hex");
}
