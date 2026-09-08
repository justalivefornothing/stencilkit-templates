# Stencilkit

A logic-less mustache-style template engine compiled to a token tree once and
rendered many times, with sections, inverted sections, partials, dotted lookups,
and HTML escaping.

Zero runtime dependencies, ESM, fully typed, ~750 lines of TypeScript. Passes
all 146 cases of the [official mustache spec](https://github.com/mustache/spec)
(the six required modules plus the optional `~lambdas` module).

```ts
import { compile } from "stencilkit-templates";

const card = compile(`<h2>{{title}}</h2>
{{#author}}
<p>by {{name}} &lt;{{email}}&gt;</p>
{{/author}}
<ul>
{{#tags}}
  <li>{{.}}</li>
{{/tags}}
</ul>
{{^tags}}
<p>No tags</p>
{{/tags}}
{{> footer}}
`);

card(
  { title: "Hello <world>", author: { name: "Ada", email: "ada@example.com" }, tags: ["a", "b"] },
  { footer: "<footer>{{title}}</footer>\n" },
);
// <h2>Hello &lt;world&gt;</h2>
// <p>by Ada &lt;ada@example.com&gt;</p>
// <ul>
//   <li>a</li>
//   <li>b</li>
// </ul>
// <footer>Hello &lt;world&gt;</footer>
```

Compile once, then call the returned function as often as you like: the bench
in `bench/render.mjs` renders the template above (sections, inversion, a
partial) 100,000 times in about 0.4 s on a laptop, roughly 4 µs per render.

## Install

```sh
npm install stencilkit-templates
```

Requires Node 18+. Ships ESM with `.d.ts` files.

## Features

- **Every tag type** — `{{var}}` escaped, `{{{var}}}` and `{{& var}}` raw,
  `{{#section}}`, `{{^inverted}}`, `{{/close}}`, `{{! comment}}`,
  `{{> partial}}`, and `{{=<% %>=}}` delimiter changes.
- **Dotted names** — `{{a.b.c}}` and `{{#a.b}}…{{/a.b}}`; `{{.}}` is the
  current item. Lookup walks outward through enclosing sections.
- **Sections that do the expected thing** — arrays iterate, objects push scope,
  `true` renders in place, falsy values and empty arrays skip, functions are
  called as lambdas (interpolation lambdas get `this = view`; section lambdas
  also receive the raw inner text).
- **Spec-exact whitespace** — a line holding only one non-interpolation tag is
  removed entirely, including its newline (`\n` or `\r\n`).
- **Partials** — plain strings, precompiled templates, or a resolver function.
  Standalone partial tags re-indent every line of the partial. Partials may
  recurse.
- **Compile once** — `compile()` returns a render function with its parsed
  tree attached; `render()` memoises recent templates for one-shot use.
- **Errors you can act on** — `Unclosed section "a" at line 1: expected {{/a}}
  but found {{/b}} on line 1`, `Unopened section "b" at line 3`,
  `Unclosed tag at line 2`, all as `TemplateError` with a `.line` field.
- **Inspectable** — `tokenize()` and `parse()` expose the flat token list and
  nested tree with source spans, fully typed.

## API

```ts
import { compile, render, tokenize, parse, escapeHtml, TemplateError } from "stencilkit-templates";
import type { CompiledTemplate, Token, Tree } from "stencilkit-templates";
```

| Export | Signature | Notes |
| --- | --- | --- |
| `compile` | `(template, options?) => CompiledTemplate` | Parses once. Throws `TemplateError` on malformed input. |
| `CompiledTemplate` | `(view?, partials?) => string` plus `.source` and `.tree` | The function returned by `compile`. |
| `render` | `(template, view?, partials?) => string` | Convenience wrapper; memoises the last 256 distinct templates. |
| `clearCache` | `() => void` | Drops templates memoised by `render`. |
| `tokenize` | `(template, delimiters?) => Tokens` | First pass: flat tokens with `start`, `end`, `line`. |
| `parse` | `(template, delimiters?) => Tree` | Both passes: nested tree of text, variable, raw, partial and section nodes. |
| `nest` | `(tokens, source) => Tree` | Second pass alone, if you already have tokens. |
| `escapeHtml` | `(value) => string` | Escapes `& < > " '`. |
| `DEFAULT_DELIMITERS` | `["{{", "}}"]` | |
| `TemplateError` | `class extends Error { line: number }` | |

`CompileOptions`:

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `escape` | `(value: string) => string` | `escapeHtml` | Replace the escaper used by `{{var}}`. |
| `delimiters` | `[open, close]` | `["{{", "}}"]` | Delimiters in effect at the start of the template. |

`Partials` is either `Record<string, string | CompiledTemplate>` or
`(name: string) => string | CompiledTemplate | undefined`. A missing partial
renders as an empty string, per the spec.

### Inspecting the tree

```ts
import { parse } from "stencilkit-templates";

parse("Hi {{#users}}{{name}}{{/users}}");
// [
//   { type: "text", value: "Hi ", start: 0, end: 3, line: 1 },
//   {
//     type: "section", name: "users", inverted: false, line: 1, start: 3, end: 31,
//     inner: "{{name}}", delimiters: ["{{", "}}"],
//     children: [{ type: "variable", name: "name", start: 13, end: 21, line: 1 }],
//   },
// ]
```

## How it works

```
template ──▶ tokenize ──▶ [text, sectionOpen, variable, sectionClose, …]
                               │
                               ▼  nest (stack)
                          [text, section{ children: [variable] }]
                               │
                               ▼  renderTree (context stack)
                              string
```

**Scanning.** `tokenize` is a hand-written cursor loop, not a regex. It finds
the next open delimiter, emits the preceding text, reads one sigil character
(`# ^ / ! > & { =`) to decide the tag kind, then reads up to the matching close
sequence (`}}}` for triple mustache, `=}}` for delimiter changes). Every token
carries its offsets and 1-based line. A `{{=<% %>=}}` tag simply swaps the two
strings the loop searches for, so custom delimiters cost nothing. Standalone
detection lives here too because it needs raw neighbours: the scanner tracks
whether the current line has seen any non-whitespace text or another tag; when
a non-interpolation tag arrives on a clean line and only spaces or tabs follow
it up to the newline (or end of input), the indentation is trimmed off the
previous text token and the trailing whitespace plus newline are skipped. For
partials that indentation is recorded on the token instead of thrown away.

**Nesting.** `nest` walks the flat list with a stack of open sections.
`sectionOpen`/`invertedOpen` push a frame, `sectionClose` pops one and checks
the name — a mismatch throws `Unclosed section "a" at line 1: expected {{/a}}
but found {{/b}} on line 1`, and anything still open at the end throws
`Unclosed section … reached end of template`. Comments and delimiter tokens are
dropped, and text on either side of them is merged so the render loop touches
as few nodes as possible. Each section node also remembers the raw text between
its tags and the delimiters that were active, which is what lambdas need.

**Rendering.** `renderTree` walks the tree with an immutable linked-list
`Context`. Entering a section pushes a scope in O(1); leaving it is just
dropping the reference. Lookup of `a.b.c` searches outward for the *first*
scope that has key `a`, then descends `b` and `c` from there without falling
back further out (mustache semantics, so `{{#a}}{{b.c}}{{/a}}` cannot leak a
top-level `b`). Values are stringified and passed through a single
`replace(/[&<>"']/g, …)` unless the tag was raw. Partials are parsed on first
use and cached by source text and indentation, so calling a compiled template
100k times with the same partials parses each partial once.

## Develop

```sh
npm install
npm test          # vitest: 202 tests incl. the 146-case official spec suite
npm run build     # tsc -> dist/ (ESM + .d.ts)
npm run bench     # build, then compile-once / render-100k timing
```

The spec fixtures under `src/__fixtures__/spec/` are the JSON files published
by [mustache/spec](https://github.com/mustache/spec) (MIT). They are test-only
and not shipped in the package.

## Tech

TypeScript 7 (strict, `noUncheckedIndexedAccess`), Vitest 5, ESM output.
No runtime dependencies.

## License

MIT © 2026 Jafn
