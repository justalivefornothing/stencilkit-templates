import { TemplateError, type Token, type Tokens } from "./types.js";

export const DEFAULT_DELIMITERS: readonly [string, string] = ["{{", "}}"];

const SPACE = 0x20;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;

type Kind = Token["type"];

/** Tag kinds that may stand alone on a line and be trimmed away with it. */
const STANDALONE_KINDS: ReadonlySet<Kind> = new Set<Kind>([
  "sectionOpen",
  "invertedOpen",
  "sectionClose",
  "comment",
  "partial",
  "setDelimiter",
]);

const KIND_BY_SIGIL: Readonly<Record<string, Kind>> = {
  "#": "sectionOpen",
  "^": "invertedOpen",
  "/": "sectionClose",
  "!": "comment",
  ">": "partial",
  "&": "raw",
  "{": "raw",
  "=": "setDelimiter",
};

function isBlank(text: string, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (c !== SPACE && c !== TAB) return false;
  }
  return true;
}

function countNewlines(text: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (text.charCodeAt(i) === LF) n++;
  return n;
}

/**
 * First pass: walk the template with the current delimiters and produce a flat
 * token list. Standalone tag lines (whitespace + one non-interpolation tag +
 * newline) are detected here, because it needs the raw text neighbours: the
 * leading indentation is trimmed from the preceding text token and the
 * trailing whitespace plus newline are skipped.
 */
export function tokenize(
  template: string,
  delimiters: readonly [open: string, close: string] = DEFAULT_DELIMITERS,
): Tokens {
  const tokens: Token[] = [];
  const len = template.length;
  let [open, close] = delimiters;
  let pos = 0;
  let line = 1;
  // Per-line state used for standalone detection.
  let lineStart = 0;
  let lineHasContent = false;
  let lineTagCount = 0;

  const pushText = (from: number, to: number): void => {
    const value = template.slice(from, to);
    tokens.push({ type: "text", value, start: from, end: to, line });
    const lastNewline = value.lastIndexOf("\n");
    if (lastNewline === -1) {
      lineHasContent ||= !isBlank(value, 0, value.length);
    } else {
      line += countNewlines(value, 0, value.length);
      lineStart = from + lastNewline + 1;
      lineHasContent = !isBlank(value, lastNewline + 1, value.length);
      lineTagCount = 0;
    }
  };

  const trimTrailingText = (count: number): void => {
    const last = tokens[tokens.length - 1];
    if (!last || last.type !== "text") return;
    const value = last.value.slice(0, -count);
    if (value.length === 0) tokens.pop();
    else tokens[tokens.length - 1] = { ...last, value, end: last.end - count };
  };

  while (pos < len) {
    const tagStart = template.indexOf(open, pos);
    if (tagStart === -1) {
      pushText(pos, len);
      break;
    }
    if (tagStart > pos) pushText(pos, tagStart);

    let cursor = tagStart + open.length;
    const sigil = template.charAt(cursor);
    const kind: Kind = KIND_BY_SIGIL[sigil] ?? "variable";
    let closeSeq = close;
    if (kind !== "variable") {
      cursor++;
      if (sigil === "{") closeSeq = "}" + close;
      else if (sigil === "=") closeSeq = "=" + close;
    }

    const contentEnd = template.indexOf(closeSeq, cursor);
    if (contentEnd === -1) {
      throw new TemplateError(`Unclosed tag at line ${line}`, line);
    }
    const tagEnd = contentEnd + closeSeq.length;
    const content = template.slice(cursor, contentEnd).trim();
    const tagLine = line;

    // Standalone detection: nothing but whitespace before the tag on this line,
    // no other tag on the line, and only whitespace up to the newline (or EOF).
    let standalone = false;
    let consumedNewline = false;
    let nextPos = tagEnd;
    if (STANDALONE_KINDS.has(kind) && !lineHasContent && lineTagCount === 0) {
      let j = tagEnd;
      while (j < len && (template.charCodeAt(j) === SPACE || template.charCodeAt(j) === TAB)) j++;
      if (j === len) {
        standalone = true;
        nextPos = len;
      } else if (template.charCodeAt(j) === LF) {
        standalone = consumedNewline = true;
        nextPos = j + 1;
      } else if (template.charCodeAt(j) === CR && template.charCodeAt(j + 1) === LF) {
        standalone = consumedNewline = true;
        nextPos = j + 2;
      }
    }
    const indent = standalone ? template.slice(lineStart, tagStart) : "";
    if (indent.length > 0) trimTrailingText(indent.length);

    const span = { start: tagStart, end: tagEnd, line: tagLine } as const;
    switch (kind) {
      case "comment":
        tokens.push({ type: "comment", value: content, ...span });
        break;
      case "setDelimiter": {
        const parts = content.split(/\s+/);
        const [newOpen, newClose] = parts;
        if (parts.length !== 2 || !newOpen || !newClose) {
          throw new TemplateError(
            `Invalid delimiter change "${template.slice(tagStart, tagEnd)}" at line ${tagLine}`,
            tagLine,
          );
        }
        tokens.push({ type: "setDelimiter", open: newOpen, close: newClose, ...span });
        open = newOpen;
        close = newClose;
        break;
      }
      case "sectionOpen":
      case "invertedOpen":
        requireName(content, kind, tagLine);
        tokens.push({ type: kind, name: content, delimiters: [open, close], ...span });
        break;
      case "partial":
        requireName(content, kind, tagLine);
        tokens.push({ type: "partial", name: content, indent, ...span });
        break;
      case "sectionClose":
      case "variable":
      case "raw":
        requireName(content, kind, tagLine);
        tokens.push({ type: kind, name: content, ...span });
        break;
      default:
        // Text tokens are never produced by the tag branch.
        break;
    }

    line += countNewlines(template, tagStart, tagEnd);
    if (standalone) {
      if (consumedNewline) line++;
      pos = lineStart = nextPos;
      lineHasContent = false;
      lineTagCount = 0;
    } else {
      pos = tagEnd;
      lineTagCount++;
      if (kind === "variable" || kind === "raw") lineHasContent = true;
    }
  }

  return tokens;
}

const KIND_LABEL: Readonly<Record<string, string>> = {
  sectionOpen: "section",
  invertedOpen: "inverted section",
  sectionClose: "closing",
  partial: "partial",
  variable: "variable",
  raw: "unescaped variable",
};

function requireName(name: string, kind: Kind, line: number): void {
  if (name.length === 0) {
    throw new TemplateError(`Empty ${KIND_LABEL[kind] ?? kind} tag at line ${line}`, line);
  }
}
