# Stencilkit — plan

## Goal

A logic-less, mustache-style template engine for Node/TypeScript with zero
runtime dependencies. A template is compiled to a token tree exactly once and
the resulting `render(data, partials?)` function can be called many thousands
of times against different data. The engine is written from scratch: no regex
mega-matchers, no eval, no code generation.

## Features

- Tags: `{{var}}` (escaped), `{{{var}}}` / `{{& var}}` (raw), `{{#section}}`,
  `{{^inverted}}`, `{{/close}}`, `{{! comment}}`, `{{> partial}}`,
  `{{=<% %>=}}` delimiter changes.
- Dotted names `{{a.b.c}}` and a context stack whose lookup walks outward
  through enclosing sections; `{{.}}` refers to the current scope.
- Sections over arrays iterate, over objects push scope, over falsy or empty
  values skip; functions are invoked as lambdas.
- Standalone tag lines (a line that is only whitespace plus a non-variable
  tag) are removed entirely so output whitespace matches the mustache spec.
- Partials: compiled lazily, cached per render call, and standalone partial
  tags re-indent every line of the partial's output.
- Descriptive parse errors (`Unclosed section "a" at line 1`,
  `Unopened section "b" at line 3`, mismatched names) with line numbers.
- Tiny API: `compile`, `render`, `escapeHtml`, `tokenize`, `parse`, and a
  `Token` type union for inspecting the parsed tree.

## Architecture

```
src/
  index.ts       public surface: compile, render, tokenize, parse, escapeHtml, types
  types.ts       Token union, Tokens/Tree types, TemplateError
  scanner.ts     template string -> flat token list (honours delimiter changes,
                 records line numbers, marks standalone tags and strips them)
  parser.ts      flat tokens -> nested tree (stack-based, validates matching)
  context.ts     Context stack: push/lookup with dotted-name descent
  render.ts      tree walker: sections, inversion, lambdas, partials, escaping
  escape.ts      single-pass HTML escaper for & < > " '
```

Pipeline: `scan(template) -> tokens[] -> nest(tokens) -> tree -> walk(tree, ctx)`.

The scanner is a hand-written cursor loop: find the next open delimiter,
emit preceding text, read the sigil (`# ^ / ! > & { =`), read to the matching
close delimiter, emit a tag token with its 1-based line. Standalone detection
happens in the scanner because it needs raw text neighbours: a tag whose
preceding text on its line is whitespace-only and whose following text up to
the newline is whitespace-only has both trimmed (the newline is consumed too).

The parser is a single loop with a stack of open sections. `sectionOpen` and
`invertedOpen` push; `sectionClose` pops and verifies the name matches, else
throws with the line of the offending token. Anything left on the stack at
end-of-input is an unclosed-section error naming the innermost open section.

Rendering uses a `Context` object with a scopes array. Lookup of `a.b.c`
searches scopes from the top for the first scope that *has* key `a`
(mustache semantics: a hit on the first segment stops the outward walk even if
the deeper path is missing), then descends `b`, `c`. Values that are functions
are called with the current view (and, for sections, the raw section text).

## Milestones

1. Plan, license, gitignore, git init.
2. Scaffold: package.json, tsconfig(s), vitest, empty `src/index.ts`.
3. Core: scanner + parser + renderer with the spec's tests passing.
4. Standalone-line trimming and delimiter changes across the whole spec suite.
5. Partials with indentation, lambdas, error messages with line numbers.
6. Benchmark script (compile once, render 100k times) and README.
7. Publish to a private GitHub repo.
