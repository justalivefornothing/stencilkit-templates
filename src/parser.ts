import { tokenize } from "./scanner.js";
import {
  TemplateError,
  type InvertedOpenToken,
  type Node,
  type SectionNode,
  type SectionOpenToken,
  type Tokens,
  type Tree,
} from "./types.js";

interface Frame {
  readonly open: SectionOpenToken | InvertedOpenToken;
  readonly children: Node[];
}

const closeTag = (open: SectionOpenToken | InvertedOpenToken): string =>
  `${open.delimiters[0]}/${open.name}${open.delimiters[1]}`;

/**
 * Second pass: nest a flat token list into a tree. Section openers push a
 * frame; closers pop it and must name the same section. Comments and
 * delimiter changes have done their job in the scanner and are dropped.
 */
export function nest(tokens: Tokens, source: string): Tree {
  const root: Node[] = [];
  const stack: Frame[] = [];
  let children = root;

  const pushLeaf = (node: Node): void => {
    const last = children[children.length - 1];
    if (node.type === "text" && last?.type === "text") {
      // Adjacent text can appear once a comment or delimiter tag between them
      // has been dropped; merging keeps the tree (and the render loop) tight.
      children[children.length - 1] = {
        ...last,
        value: last.value + node.value,
        end: node.end,
      };
    } else {
      children.push(node);
    }
  };

  for (const token of tokens) {
    switch (token.type) {
      case "text":
      case "variable":
      case "raw":
      case "partial":
        pushLeaf(token);
        break;
      case "comment":
      case "setDelimiter":
        break;
      case "sectionOpen":
      case "invertedOpen": {
        const frame: Frame = { open: token, children: [] };
        stack.push(frame);
        children = frame.children;
        break;
      }
      case "sectionClose": {
        const frame = stack.pop();
        if (!frame) {
          throw new TemplateError(
            `Unopened section "${token.name}" at line ${token.line}`,
            token.line,
          );
        }
        const { open } = frame;
        if (open.name !== token.name) {
          throw new TemplateError(
            `Unclosed section "${open.name}" at line ${open.line}: ` +
              `expected ${closeTag(open)} but found ${open.delimiters[0]}/${token.name}${open.delimiters[1]} on line ${token.line}`,
            open.line,
          );
        }
        const section: SectionNode = {
          type: "section",
          name: open.name,
          inverted: open.type === "invertedOpen",
          children: frame.children,
          inner: source.slice(open.end, token.start),
          delimiters: open.delimiters,
          start: open.start,
          end: token.end,
          line: open.line,
        };
        children = stack.length > 0 ? stack[stack.length - 1]!.children : root;
        children.push(section);
        break;
      }
    }
  }

  const dangling = stack[stack.length - 1];
  if (dangling) {
    const { open } = dangling;
    throw new TemplateError(
      `Unclosed section "${open.name}" at line ${open.line}: reached end of template without ${closeTag(open)}`,
      open.line,
    );
  }
  return root;
}

/** Tokenize and nest in one step. */
export function parse(
  template: string,
  delimiters?: readonly [open: string, close: string],
): Tree {
  return nest(tokenize(template, delimiters), template);
}
