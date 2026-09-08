import { describe, expect, it } from "vitest";
import { tokenize } from "./scanner.js";
import type { Token } from "./types.js";

const shapes = (
  template: string,
  delimiters?: readonly [string, string],
): Array<[Token["type"], string]> =>
  tokenize(template, delimiters).map((t) => {
    switch (t.type) {
      case "text":
      case "comment":
        return [t.type, t.value];
      case "setDelimiter":
        return [t.type, `${t.open} ${t.close}`];
      default:
        return [t.type, t.name];
    }
  });

describe("tokenize", () => {
  it("emits one token per tag kind", () => {
    const tpl = "a{{b}}{{{c}}}{{& d}}{{#e}}{{^f}}{{/f}}{{/e}}{{! g }}{{> h}}{{=<% %>=}}<%i%>";
    expect(shapes(tpl)).toEqual([
      ["text", "a"],
      ["variable", "b"],
      ["raw", "c"],
      ["raw", "d"],
      ["sectionOpen", "e"],
      ["invertedOpen", "f"],
      ["sectionClose", "f"],
      ["sectionClose", "e"],
      ["comment", "g"],
      ["partial", "h"],
      ["setDelimiter", "<% %>"],
      ["variable", "i"],
    ]);
  });

  it("records source spans and 1-based lines", () => {
    const tpl = "line one\n  {{x}} {{! c }}\n{{y}}";
    const [text, x, , comment, , y] = tokenize(tpl);
    expect(text).toMatchObject({ type: "text", start: 0, end: 11, line: 1 });
    expect(x).toMatchObject({ type: "variable", name: "x", start: 11, end: 16, line: 2 });
    expect(comment).toMatchObject({ type: "comment", start: 17, end: 25, line: 2 });
    expect(y).toMatchObject({ type: "variable", name: "y", line: 3 });
  });

  it("keeps counting lines through multi-line comments", () => {
    const tokens = tokenize("{{!\n\n}}{{x}}");
    expect(tokens.at(-1)).toMatchObject({ type: "variable", name: "x", line: 3 });
  });

  it("records the delimiters active at each section opener", () => {
    const [, open] = tokenize("{{=| |=}}|#s||/s|");
    expect(open).toMatchObject({ type: "sectionOpen", name: "s", delimiters: ["|", "|"] });
  });

  describe("standalone lines", () => {
    it("removes the whole line for a lone section tag", () => {
      expect(shapes("a\n  {{#s}}  \nb\n{{/s}}\nc")).toEqual([
        ["text", "a\n"],
        ["sectionOpen", "s"],
        ["text", "b\n"],
        ["sectionClose", "s"],
        ["text", "c"],
      ]);
    });

    it("treats CRLF and end-of-input as line ends", () => {
      expect(shapes("|\r\n{{#b}}\r\n{{/b}}\r\n|")).toEqual([
        ["text", "|\r\n"],
        ["sectionOpen", "b"],
        ["sectionClose", "b"],
        ["text", "|"],
      ]);
      expect(shapes("x\n  {{! last }}")).toEqual([
        ["text", "x\n"],
        ["comment", "last"],
      ]);
    });

    it("never treats interpolation tags as standalone", () => {
      expect(shapes("  {{x}}\n")).toEqual([
        ["text", "  "],
        ["variable", "x"],
        ["text", "\n"],
      ]);
    });

    it("requires the tag to be alone on its line", () => {
      expect(shapes("{{#a}}{{/a}}\n")).toEqual([
        ["sectionOpen", "a"],
        ["sectionClose", "a"],
        ["text", "\n"],
      ]);
      expect(shapes(" {{#a}} x {{/a}}\n")).toEqual([
        ["text", " "],
        ["sectionOpen", "a"],
        ["text", " x "],
        ["sectionClose", "a"],
        ["text", "\n"],
      ]);
    });

    it("captures the indentation of standalone partials only", () => {
      const [standalone] = tokenize("\t  {{>p}}\n");
      const [, inline] = tokenize("x {{>p}}\n");
      expect(standalone).toMatchObject({ type: "partial", indent: "\t  " });
      expect(inline).toMatchObject({ type: "partial", indent: "" });
    });
  });

  describe("delimiter changes", () => {
    it("switches delimiters for the rest of the template", () => {
      expect(shapes("{{a}}{{=<% %>=}}{{b}}<%c%><%={{ }}=%>{{d}}")).toEqual([
        ["variable", "a"],
        ["setDelimiter", "<% %>"],
        ["text", "{{b}}"],
        ["variable", "c"],
        ["setDelimiter", "{{ }}"],
        ["variable", "d"],
      ]);
    });

    it("accepts an initial delimiter pair", () => {
      expect(shapes("{{x}} <%y%>", ["<%", "%>"])).toEqual([
        ["text", "{{x}} "],
        ["variable", "y"],
      ]);
    });

    it("rejects malformed changes", () => {
      expect(() => tokenize("{{=<%=}}")).toThrow("Invalid delimiter change");
      expect(() => tokenize("{{=a b c=}}")).toThrow("Invalid delimiter change");
    });
  });

  it("reports unclosed tags with their line", () => {
    expect(() => tokenize("a\nb {{{x}}")).toThrow("Unclosed tag at line 2");
  });
});
