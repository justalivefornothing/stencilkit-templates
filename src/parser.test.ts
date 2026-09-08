import { describe, expect, it } from "vitest";
import { nest, parse } from "./parser.js";
import { tokenize } from "./scanner.js";
import type { Node, SectionNode } from "./types.js";

const outline = (nodes: readonly Node[]): unknown[] =>
  nodes.map((n) => {
    switch (n.type) {
      case "text":
        return n.value;
      case "section":
        return { [n.inverted ? "^" : "#"]: n.name, children: outline(n.children) };
      default:
        return `${n.type}:${n.name}`;
    }
  });

describe("parse", () => {
  it("nests sections and keeps leaves in order", () => {
    expect(outline(parse("a{{#s}}b{{^t}}c{{/t}}{{>p}}{{/s}}{{x}}"))).toEqual([
      "a",
      { "#": "s", children: ["b", { "^": "t", children: ["c"] }, "partial:p"] },
      "variable:x",
    ]);
  });

  it("drops comments and delimiter changes, merging the surrounding text", () => {
    const tree = parse("a{{! c }}b{{=< >=}}c<x>");
    expect(outline(tree)).toEqual(["abc", "variable:x"]);
    expect(tree[0]).toMatchObject({ start: 0, end: 20 });
  });

  it("records the raw inner text, span and delimiters of a section", () => {
    const [section] = parse("{{=| |=}}\n|#s| {{x}} |/s|") as [SectionNode];
    expect(section.inner).toBe(" {{x}} ");
    expect(section.delimiters).toEqual(["|", "|"]);
    expect(section).toMatchObject({ start: 10, end: 25, line: 2 });
  });

  it("returns an empty tree for an empty template", () => {
    expect(parse("")).toEqual([]);
  });

  it("is a thin wrapper over tokenize + nest", () => {
    const source = "{{#a}}{{b}}{{/a}}";
    expect(nest(tokenize(source), source)).toEqual(parse(source));
  });

  describe("errors", () => {
    it("reports the innermost unclosed section with its line", () => {
      expect(() => parse("{{#outer}}\n  {{#inner}}\n{{/outer}}")).toThrow(
        'Unclosed section "inner" at line 2: expected {{/inner}} but found {{/outer}} on line 3',
      );
    });

    it("mentions the active delimiters in the expected close tag", () => {
      expect(() => parse("{{=< >=}}<#a>")).toThrow(
        'Unclosed section "a" at line 1: reached end of template without </a>',
      );
    });

    it("reports a close tag with no matching open", () => {
      expect(() => parse("{{#a}}{{/a}}{{/a}}")).toThrow('Unopened section "a" at line 1');
    });
  });
});
