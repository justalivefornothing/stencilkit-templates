import { Context } from "./context.js";
import { parse } from "./parser.js";
import type {
  Partials,
  PartialSource,
  PartialToken,
  SectionNode,
  Tree,
} from "./types.js";

type Lambda = (this: unknown, text?: string) => unknown;

/** Everything a single render call needs; created once per top-level call. */
export interface RenderState {
  readonly partials: Partials | undefined;
  readonly escape: (value: string) => string;
  /** Lazily created per render call: parsed trees of lambda output. */
  cache: Map<string, Tree> | undefined;
}

/** Mustache falsiness: JS falsy values plus empty arrays. */
const isFalsy = (value: unknown): boolean =>
  !value || (Array.isArray(value) && value.length === 0);

/** Start of every non-empty line (used to indent standalone partials). */
const LINE_START = /^(?=.)/gm;

function cachedTree(state: RenderState, key: string, build: () => Tree): Tree {
  const cache = (state.cache ??= new Map());
  let tree = cache.get(key);
  if (tree === undefined) {
    tree = build();
    cache.set(key, tree);
  }
  return tree;
}

export function renderTree(tree: Tree, ctx: Context, state: RenderState): string {
  let out = "";
  for (const node of tree) {
    switch (node.type) {
      case "text":
        out += node.value;
        break;
      case "variable":
        out += state.escape(interpolate(node.name, ctx, state));
        break;
      case "raw":
        out += interpolate(node.name, ctx, state);
        break;
      case "section":
        out += renderSection(node, ctx, state);
        break;
      case "partial":
        out += renderPartial(node, ctx, state);
        break;
    }
  }
  return out;
}

function interpolate(name: string, ctx: Context, state: RenderState): string {
  let value = ctx.lookup(name);
  if (typeof value === "function") {
    value = (value as Lambda).call(ctx.view);
    if (typeof value === "string") {
      // Lambda output is itself a template, parsed with the default delimiters.
      const source = value;
      const tree = cachedTree(state, "lambda:" + source, () => parse(source));
      return renderTree(tree, ctx, state);
    }
  }
  return value == null ? "" : String(value);
}

function renderSection(node: SectionNode, ctx: Context, state: RenderState): string {
  const value = ctx.lookup(node.name);

  if (node.inverted) {
    return isFalsy(value) ? renderTree(node.children, ctx, state) : "";
  }
  if (isFalsy(value)) return "";

  if (Array.isArray(value)) {
    let out = "";
    for (const item of value) out += renderTree(node.children, ctx.push(item), state);
    return out;
  }

  if (typeof value === "function") {
    // Section lambdas receive the raw inner text; their result is rendered
    // with whatever delimiters were active where the section was opened.
    const result = (value as Lambda).call(ctx.view, node.inner);
    if (result == null) return "";
    const text = String(result);
    const key = "section:" + JSON.stringify([node.delimiters, text]);
    const tree = cachedTree(state, key, () => parse(text, node.delimiters));
    return renderTree(tree, ctx, state);
  }

  // `true` has nothing to look up, so keep the current scope; anything else
  // (objects, strings, numbers) becomes the innermost scope.
  return renderTree(node.children, value === true ? ctx : ctx.push(value), state);
}

function resolvePartial(name: string, partials: Partials | undefined): PartialSource | undefined {
  if (partials === undefined) return undefined;
  if (typeof partials === "function") return partials(name);
  return Object.prototype.hasOwnProperty.call(partials, name) ? partials[name] : undefined;
}

const PARTIAL_CACHE_LIMIT = 512;
/** source text -> indent -> tree. Content-keyed, so it can never go stale. */
const partialTrees = new Map<string, Map<string, Tree>>();

function partialTree(text: string, indent: string): Tree {
  let byIndent = partialTrees.get(text);
  if (byIndent === undefined) {
    if (partialTrees.size >= PARTIAL_CACHE_LIMIT) partialTrees.clear();
    byIndent = new Map();
    partialTrees.set(text, byIndent);
  }
  let tree = byIndent.get(indent);
  if (tree === undefined) {
    // A standalone partial re-indents every non-empty line of its *template*
    // (not its output), so newlines inside interpolated values stay put.
    tree = parse(indent === "" ? text : text.replace(LINE_START, indent));
    byIndent.set(indent, tree);
  }
  return tree;
}

function renderPartial(node: PartialToken, ctx: Context, state: RenderState): string {
  const source = resolvePartial(node.name, state.partials);
  if (source === undefined) return "";

  const { indent } = node;
  const tree =
    typeof source === "string"
      ? partialTree(source, indent)
      : indent === ""
        ? source.tree
        : partialTree(source.source, indent);
  return renderTree(tree, ctx, state);
}

/** Render a parsed tree against `view` from the top of a fresh context. */
export function renderRoot(
  tree: Tree,
  view: unknown,
  partials: Partials | undefined,
  escape: (value: string) => string,
): string {
  return renderTree(tree, new Context(view), { partials, escape, cache: undefined });
}
