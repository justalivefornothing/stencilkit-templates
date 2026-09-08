const hasOwn = Object.prototype.hasOwnProperty;

/** Does `view` expose `key`? Objects use `in` so getters and prototypes work. */
function hasKey(view: unknown, key: string): boolean {
  if (view == null) return false;
  const kind = typeof view;
  if (kind === "object" || kind === "function") return key in (view as object);
  // Primitives are autoboxed: lets `{{name.length}}` work on a string.
  return hasOwn.call(view, key);
}

/**
 * An immutable linked list of scopes. Each section pushes a new scope; lookups
 * walk outward from the innermost one. Sharing the parent chain instead of
 * copying an array keeps `push` O(1) inside tight iteration loops.
 */
export class Context {
  readonly view: unknown;
  readonly parent: Context | undefined;

  constructor(view: unknown, parent?: Context) {
    this.view = view;
    this.parent = parent;
  }

  push(view: unknown): Context {
    return new Context(view, this);
  }

  /**
   * Resolve a (possibly dotted) name. `.` is the current scope. For `a.b.c`
   * the *first* segment is searched outward through the scope chain; the
   * first scope that has it wins, and the remaining segments descend from
   * there without ever falling back to an outer scope (mustache semantics).
   */
  lookup(name: string): unknown {
    if (name === ".") return this.view;

    const dot = name.indexOf(".");
    const head = dot === -1 ? name : name.slice(0, dot);

    let scope: Context | undefined = this;
    while (scope !== undefined && !hasKey(scope.view, head)) scope = scope.parent;
    if (scope === undefined) return undefined;

    let value: unknown = (scope.view as Record<string, unknown>)[head];
    if (dot === -1) return value;

    let from = dot + 1;
    while (value != null) {
      const next = name.indexOf(".", from);
      const segment = next === -1 ? name.slice(from) : name.slice(from, next);
      value = (value as Record<string, unknown>)[segment];
      if (next === -1) break;
      from = next + 1;
    }
    return value;
  }
}
