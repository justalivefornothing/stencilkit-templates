const ESCAPE_RE = /[&<>"']/g;

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeChar = (ch: string): string => ESCAPES[ch] ?? ch;

/** Escape the five characters that matter in HTML text and attributes. */
export function escapeHtml(value: string): string {
  return value.replace(ESCAPE_RE, escapeChar);
}
