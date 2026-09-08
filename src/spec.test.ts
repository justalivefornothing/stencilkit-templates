/**
 * Runs the official mustache spec (https://github.com/mustache/spec, MIT) from
 * the JSON fixtures vendored under __fixtures__/spec. Every required module is
 * exercised plus the optional ~lambdas module.
 */
import { describe, expect, it } from "vitest";
import { compile } from "./index.js";
import comments from "./__fixtures__/spec/comments.json";
import delimiters from "./__fixtures__/spec/delimiters.json";
import interpolation from "./__fixtures__/spec/interpolation.json";
import inverted from "./__fixtures__/spec/inverted.json";
import lambdas from "./__fixtures__/spec/~lambdas.json";
import partials from "./__fixtures__/spec/partials.json";
import sections from "./__fixtures__/spec/sections.json";

interface SpecTest {
  name: string;
  desc: string;
  /** Usually an object, but the implicit-iterator tests use bare strings/arrays. */
  data: unknown;
  template: string;
  partials?: Record<string, string>;
  expected: string;
}

interface SpecModule {
  overview: string;
  tests: SpecTest[];
}

const modules: Record<string, SpecModule> = {
  comments,
  delimiters,
  interpolation,
  inverted,
  partials,
  sections,
  "~lambdas": lambdas,
};

/** Lambdas are shipped as per-language source strings; use the JS flavour. */
function hydrate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hydrate);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record["__tag__"] === "code" && typeof record["js"] === "string") {
      return new Function(`return (${record["js"]})`)();
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) out[k] = hydrate(v);
    return out;
  }
  return value;
}

for (const [name, mod] of Object.entries(modules)) {
  describe(`mustache spec: ${name}`, () => {
    for (const test of mod.tests) {
      it(`${test.name} — ${test.desc}`, () => {
        const render = compile(test.template);
        expect(render(hydrate(test.data), test.partials)).toBe(test.expected);
      });
    }
  });
}
