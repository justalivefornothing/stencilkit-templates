// Compile once, render many. Run with `npm run bench` (builds dist/ first).
import { performance } from "node:perf_hooks";
import { compile } from "../dist/index.js";

const template = `<article class="{{kind}}">
  <h2>{{title}}</h2>
  {{#author}}
  <p class="by">{{name}} &lt;{{email}}&gt;</p>
  {{/author}}
  <ul>
  {{#tags}}
    <li>{{.}}</li>
  {{/tags}}
  </ul>
  {{^tags}}
  <p class="empty">No tags</p>
  {{/tags}}
  {{> footer}}
</article>
`;

const partials = {
  footer: "<footer>{{stats.words}} words · {{stats.minutes}} min read</footer>\n",
};

const ITERATIONS = 100_000;
const views = Array.from({ length: 64 }, (_, i) => ({
  kind: i % 3 ? "post" : "note",
  title: `Entry #${i} <draft>`,
  author: i % 4 ? { name: `Author ${i}`, email: `a${i}@example.com` } : null,
  tags: Array.from({ length: i % 5 }, (_, t) => `tag-${t}`),
  stats: { words: 120 + i * 7, minutes: 1 + (i % 6) },
}));

const t0 = performance.now();
const render = compile(template);
const compileMs = performance.now() - t0;

let bytes = 0;
const t1 = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  bytes += render(views[i % views.length], partials).length;
}
const renderMs = performance.now() - t1;

console.log(render(views[1], partials));
console.log(`compile:  ${compileMs.toFixed(3)} ms (${render.tree.length} top-level nodes)`);
console.log(
  `render:   ${ITERATIONS.toLocaleString("en-US")} renders in ${renderMs.toFixed(0)} ms ` +
    `(${(renderMs / ITERATIONS * 1000).toFixed(2)} µs each, ${(bytes / 1e6).toFixed(1)} MB emitted)`,
);
