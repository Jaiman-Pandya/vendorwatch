/** formalize text for display: title case, years in brackets, consistent structure */

function toTitleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((word) => {
      if (/^[A-Z]{2,}$/.test(word)) return word;
      if (/^[\d$%]/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/** wrap standalone 4-digit years in brackets, e.g. 2024 -> (2024) */
function bracketYears(s: string): string {
  return s.replace(/\b(19\d{2}|20\d{2})\b/g, "($1)");
}

/** formalize a single value for display */
export function formalizeValue(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withYears = bracketYears(trimmed);
  return toTitleCase(withYears);
}

/** formalize multi-part value (e.g. joined with \n\n), returns array of formalized strings */
export function formalizeValueParts(raw: string): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/\n\n+/)
    .map((p) => formalizeValue(p))
    .filter(Boolean);
}

/** formalize and join parts for display */
export function formalizeValueMultiline(raw: string): string {
  const parts = formalizeValueParts(raw);
  return parts.join("\n\n");
}

/** parse value into segments for rendering with bold on $ amounts, %, (Year) */
export function parseForBold(text: string): Array<{ text: string; bold: boolean }> {
  if (!text || typeof text !== "string") return [];
  const parts: Array<{ text: string; bold: boolean }> = [];
  const re = /(\$[\d,]+(?:\.\d+)?(?:\s*%)?|[\d,]+(?:\.\d+)?%|\(\d{4}\)|\b(19\d{2}|20\d{2})\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push({ text: text.slice(last, m.index), bold: false });
    }
    const match = m[1];
    const display = match && match.length === 4 && /^\d{4}$/.test(match) ? `(${match})` : (match ?? m[0]);
    parts.push({ text: display, bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last), bold: false });
  }
  if (parts.length === 0 && text) parts.push({ text, bold: false });
  return parts;
}
