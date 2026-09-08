import { describe, expect, it } from "vitest";
import { clearCache, compile, escapeHtml, render, TemplateError } from "./index.js";

describe("spec-mandated behaviour", () => {
  it("escapes interpolated variables", () => {
    expect(render("Hi {{name}}!", { name: "<b>" })).toBe("Hi &lt;b&gt;!");
  });

  it("iterates array sections with the implicit iterator", () => {
    expect(render("{{#items}}[{{.}}]{{/items}}", { items: [1, 2, 3] })).toBe("[1][2][3]");
  });

  it("renders inverted sections for empty lists", () => {
    expect(render("{{^list}}empty{{/list}}", { list: [] })).toBe("empty");
  });

  it("resolves dotted names", () => {
    expect(render("{{a.b.c}}", { a: { b: { c: "deep" } } })).toBe("deep");
  });

  it("honours delimiter changes", () => {
    expect(render("{{=<% %>=}}<% x %>", { x: "y" })).toBe("y");
  });

  it("reports mismatched sections with the line of the open tag", () => {
    expect(() => compile("{{#a}}{{/b}}")).toThrow(/Unclosed section "a" at line 1/);
  });
});

describe("tags", () => {
  it("leaves raw tags unescaped via triple mustache and ampersand", () => {
    const view = { html: "<i>&</i>" };
    expect(render("{{{html}}}", view)).toBe("<i>&</i>");
    expect(render("{{& html}}", view)).toBe("<i>&</i>");
    expect(render("{{html}}", view)).toBe("&lt;i&gt;&amp;&lt;/i&gt;");
  });

  it("escapes all five HTML-significant characters exactly once", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
    expect(render("{{x}}", { x: "&amp;" })).toBe("&amp;amp;");
  });

  it("renders numbers and booleans, and nothing for null or undefined", () => {
    expect(render("{{n}}|{{z}}|{{t}}|{{u}}|{{nil}}", { n: 1.5, z: 0, t: true, nil: null })).toBe(
      "1.5|0|true||",
    );
  });

  it("drops comments, including multi-line ones", () => {
    expect(render("a{{! ignore\nme }}b", {})).toBe("ab");
  });

  it("tolerates padding inside tags", () => {
    expect(render("|{{ name }}|{{# on }}x{{/ on }}|", { name: "n", on: true })).toBe("|n|x|");
  });
});

describe("sections and scope", () => {
  it("pushes object scope and walks outward for misses", () => {
    const view = { user: { name: "Ada" }, site: "Lovelace.io" };
    expect(render("{{#user}}{{name}}@{{site}}{{/user}}", view)).toBe("Ada@Lovelace.io");
  });

  it("does not fall back to outer scopes once the first dotted segment hits", () => {
    expect(render("{{#a}}{{b.c}}{{/a}}", { a: { b: {} }, b: { c: "ERROR" } })).toBe("");
  });

  it("treats booleans as conditionals without changing scope", () => {
    expect(render("{{#ok}}{{name}}{{/ok}}{{^ok}}nope{{/ok}}", { ok: true, name: "yes" })).toBe("yes");
    expect(render("{{#ok}}yes{{/ok}}{{^ok}}nope{{/ok}}", { ok: false })).toBe("nope");
  });

  it("skips falsy values: 0, empty string, null, undefined, empty array", () => {
    const tpl = "{{#v}}shown{{/v}}{{^v}}hidden{{/v}}";
    for (const v of [0, "", null, undefined, []]) expect(render(tpl, { v })).toBe("hidden");
  });

  it("iterates nested arrays and reads properties of each item", () => {
    const view = { rows: [{ cells: ["a", "b"] }, { cells: ["c"] }] };
    expect(render("{{#rows}}<{{#cells}}{{.}}{{/cells}}>{{/rows}}", view)).toBe("<ab><c>");
  });

  it("uses a string value as both the scope and the iterator", () => {
    expect(render("{{#foo}}{{.}} is {{foo}}{{/foo}}", { foo: "bar" })).toBe("bar is bar");
  });

  it("reads getters and prototype properties", () => {
    class Person {
      constructor(readonly first: string, readonly last: string) {}
      get full(): string {
        return `${this.first} ${this.last}`;
      }
    }
    expect(render("{{full}} ({{first.length}})", new Person("Grace", "Hopper"))).toBe(
      "Grace Hopper (5)",
    );
  });
});

describe("lambdas", () => {
  it("calls interpolation lambdas with the view as `this` and re-renders the result", () => {
    const view = {
      planet: "world",
      greet(this: { planet: string }) {
        return `Hello, {{planet}} (${this.planet})`;
      },
    };
    expect(render("{{greet}}!", view)).toBe("Hello, world (world)!");
  });

  it("passes raw section text to section lambdas and parses their output", () => {
    const seen: string[] = [];
    const view = {
      x: "X",
      wrap: (text: string) => {
        seen.push(text);
        return `<${text}>`;
      },
    };
    expect(render("{{#wrap}} {{x}} {{/wrap}}", view)).toBe("< X >");
    expect(seen).toEqual([" {{x}} "]);
  });

  it("treats functions as truthy in inverted sections", () => {
    expect(render("{{^fn}}shown{{/fn}}", { fn: () => false })).toBe("");
  });
});

describe("partials", () => {
  it("renders named partials in the current scope and misses as empty", () => {
    const partials = { item: "<li>{{.}}</li>" };
    expect(render("<ul>{{#xs}}{{>item}}{{/xs}}</ul>{{>missing}}", { xs: [1, 2] }, partials)).toBe(
      "<ul><li>1</li><li>2</li></ul>",
    );
  });

  it("accepts a resolver function and precompiled templates", () => {
    const row = compile("{{k}}={{v}}\n");
    const out = compile("{{#pairs}}{{>row}}{{/pairs}}")(
      { pairs: [{ k: "a", v: 1 }, { k: "b", v: 2 }] },
      (name) => (name === "row" ? row : undefined),
    );
    expect(out).toBe("a=1\nb=2\n");
  });

  it("indents every line of a standalone partial", () => {
    const partials = { block: "{{a}}\n{{b}}\n" };
    expect(render("<\n  {{>block}}\n>", { a: 1, b: 2 }, partials)).toBe("<\n  1\n  2\n>");
  });

  it("supports recursive partials", () => {
    const partials = { node: "{{content}}<{{#nodes}}{{>node}}{{/nodes}}>" };
    const view = { content: "X", nodes: [{ content: "Y", nodes: [] }] };
    expect(render("{{>node}}", view, partials)).toBe("X<Y<>>");
  });
});

describe("compile()", () => {
  it("returns a reusable render function exposing source and tree", () => {
    const tpl = compile("Hello {{name}}{{! comment }}");
    expect(typeof tpl).toBe("function");
    expect(tpl.source).toBe("Hello {{name}}{{! comment }}");
    expect(tpl.tree.map((n) => n.type)).toEqual(["text", "variable"]);
    expect(tpl({ name: "A" })).toBe("Hello A");
    expect(tpl({ name: "B" })).toBe("Hello B");
    expect(tpl()).toBe("Hello ");
  });

  it("accepts a custom escape function", () => {
    const shout = compile("{{x}}", { escape: (s) => s.toUpperCase() });
    expect(shout({ x: "<hi>" })).toBe("<HI>");
  });

  it("accepts initial delimiters", () => {
    const erb = compile("{{literal}} <%= name %>", { delimiters: ["<%=", "%>"] });
    expect(erb({ name: "n" })).toBe("{{literal}} n");
  });

  it("rejects non-string templates", () => {
    expect(() => compile(42 as unknown as string)).toThrow(TypeError);
  });
});

describe("errors", () => {
  it("names the innermost unclosed section at end of input", () => {
    expect(() => compile("{{#a}}\n{{#b}}\n")).toThrow(
      'Unclosed section "b" at line 2: reached end of template without {{/b}}',
    );
  });

  it("reports unopened closing tags", () => {
    expect(() => compile("x\n{{/a}}")).toThrow('Unopened section "a" at line 2');
  });

  it("reports unclosed tags and empty names", () => {
    expect(() => compile("ok\n\n{{name")).toThrow("Unclosed tag at line 3");
    expect(() => compile("{{}}")).toThrow("Empty variable tag at line 1");
    expect(() => compile("{{#}}{{/}}")).toThrow("Empty section tag at line 1");
  });

  it("reports bad delimiter changes", () => {
    expect(() => compile("{{=<% =}}")).toThrow('Invalid delimiter change "{{=<% =}}" at line 1');
  });

  it("throws TemplateError instances carrying the line", () => {
    try {
      compile("{{#a}}");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TemplateError);
      expect((err as TemplateError).line).toBe(1);
      expect((err as TemplateError).name).toBe("TemplateError");
    }
  });
});

describe("render() cache", () => {
  it("returns identical output across cached and fresh compiles", () => {
    clearCache();
    expect(render("{{a}}", { a: 1 })).toBe("1");
    expect(render("{{a}}", { a: 2 })).toBe("2");
    clearCache();
    expect(render("{{a}}", { a: 3 })).toBe("3");
  });
});
