import { escapeHtml } from "./escape.js";
import { parse } from "./parser.js";
import { renderRoot } from "./render.js";
import type { CompiledTemplate, CompileOptions, Partials } from "./types.js";

export { escapeHtml } from "./escape.js";
export { nest, parse } from "./parser.js";
export { DEFAULT_DELIMITERS, tokenize } from "./scanner.js";
export { TemplateError } from "./types.js";
export type {
  CommentToken,
  CompiledTemplate,
  CompileOptions,
  InvertedOpenToken,
  Node,
  Partials,
  PartialSource,
  PartialToken,
  RawToken,
  SectionCloseToken,
  SectionNode,
  SectionOpenToken,
  SetDelimiterToken,
  Span,
  TextToken,
  Token,
  Tokens,
  Tree,
  VariableToken,
} from "./types.js";

/**
 * Parse `template` once and return a function that renders it against any
 * view. The parsed tree is exposed as `.tree` for inspection.
 *
 * @throws {TemplateError} for unclosed tags or mismatched sections.
 */
export function compile(template: string, options: CompileOptions = {}): CompiledTemplate {
  if (typeof template !== "string") {
    throw new TypeError(`compile() expects a string template, got ${typeof template}`);
  }
  const tree = parse(template, options.delimiters);
  const escape = options.escape ?? escapeHtml;
  const render = (view?: unknown, partials?: Partials): string =>
    renderRoot(tree, view, partials, escape);
  return Object.assign(render, { source: template, tree });
}

const CACHE_LIMIT = 256;
const compiled = new Map<string, CompiledTemplate>();

/**
 * One-shot convenience: compile (memoised for the last few hundred distinct
 * templates) and render. Prefer {@link compile} when you hold on to a template.
 */
export function render(template: string, view?: unknown, partials?: Partials): string {
  let fn = compiled.get(template);
  if (fn === undefined) {
    fn = compile(template);
    if (compiled.size >= CACHE_LIMIT) compiled.clear();
    compiled.set(template, fn);
  }
  return fn(view, partials);
}

/** Drop every template memoised by {@link render}. */
export function clearCache(): void {
  compiled.clear();
}
