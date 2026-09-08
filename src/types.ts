/** Source span shared by every token: 0-based offsets and a 1-based line. */
export interface Span {
  /** Offset of the first character of the token in the template. */
  readonly start: number;
  /** Offset one past the last character of the token. */
  readonly end: number;
  /** 1-based line on which the token starts. */
  readonly line: number;
}

export interface TextToken extends Span {
  readonly type: "text";
  readonly value: string;
}

/** `{{name}}` — interpolated and HTML-escaped. */
export interface VariableToken extends Span {
  readonly type: "variable";
  readonly name: string;
}

/** `{{{name}}}` or `{{& name}}` — interpolated without escaping. */
export interface RawToken extends Span {
  readonly type: "raw";
  readonly name: string;
}

/** `{{#name}}` */
export interface SectionOpenToken extends Span {
  readonly type: "sectionOpen";
  readonly name: string;
  /** Delimiters in effect when the tag was scanned (needed for lambdas). */
  readonly delimiters: readonly [open: string, close: string];
}

/** `{{^name}}` */
export interface InvertedOpenToken extends Span {
  readonly type: "invertedOpen";
  readonly name: string;
  readonly delimiters: readonly [open: string, close: string];
}

/** `{{/name}}` */
export interface SectionCloseToken extends Span {
  readonly type: "sectionClose";
  readonly name: string;
}

/** `{{> name}}` */
export interface PartialToken extends Span {
  readonly type: "partial";
  readonly name: string;
  /** Leading whitespace of a standalone partial line; "" otherwise. */
  readonly indent: string;
}

/** `{{! anything }}` */
export interface CommentToken extends Span {
  readonly type: "comment";
  readonly value: string;
}

/** `{{=<% %>=}}` */
export interface SetDelimiterToken extends Span {
  readonly type: "setDelimiter";
  readonly open: string;
  readonly close: string;
}

/** A flat token as produced by {@link tokenize}. */
export type Token =
  | TextToken
  | VariableToken
  | RawToken
  | SectionOpenToken
  | InvertedOpenToken
  | SectionCloseToken
  | PartialToken
  | CommentToken
  | SetDelimiterToken;

export type Tokens = readonly Token[];

/** A `{{#name}}…{{/name}}` or `{{^name}}…{{/name}}` block in the nested tree. */
export interface SectionNode extends Span {
  readonly type: "section";
  readonly name: string;
  readonly inverted: boolean;
  readonly children: Tree;
  /** Raw template text between the open and close tags (handed to lambdas). */
  readonly inner: string;
  readonly delimiters: readonly [open: string, close: string];
}

/** A node of the nested tree produced by {@link parse}. */
export type Node = TextToken | VariableToken | RawToken | PartialToken | SectionNode;

export type Tree = readonly Node[];

/** A compiled template: call it to render. */
export interface CompiledTemplate {
  (view?: unknown, partials?: Partials): string;
  /** The original template text. */
  readonly source: string;
  /** The parsed token tree, for inspection or tooling. */
  readonly tree: Tree;
}

export type PartialSource = string | CompiledTemplate;

/** Partials may be a plain lookup object or a resolver function. */
export type Partials =
  | Readonly<Record<string, PartialSource>>
  | ((name: string) => PartialSource | undefined);

export interface CompileOptions {
  /** Replace the default HTML escaper used for `{{var}}` tags. */
  readonly escape?: (value: string) => string;
}

/** Thrown for malformed templates; always carries the offending line. */
export class TemplateError extends Error {
  override readonly name = "TemplateError";
  readonly line: number;

  constructor(message: string, line: number) {
    super(message);
    this.line = line;
  }
}
