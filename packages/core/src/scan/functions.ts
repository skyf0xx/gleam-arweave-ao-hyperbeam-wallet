import { lex, type LexedFile, type Token } from "./lexer";

/**
 * A function a challenge can name. Recognised forms, each with a block body:
 *
 * - `function name(…) {` with any of `export`, `default`, `async`, `*`
 * - `const|let|var name = (async)? (…) => {`, `= x => {`, `= function (…) {`
 * - class and object methods `name(…) {` with `async`, `static`, `get`,
 *   `set`, access modifiers or `*`
 * - class fields and object properties `name = (…) => {`, `name: (…) => {`
 *
 * Expression-bodied arrows, overload signatures and anonymous functions
 * have no line to cite or no name to give, so they aren't listed.
 */
export interface FunctionSpan {
  /** Unique within the file; what a challenge and an answer name. */
  symbol: string;
  name: string;
  /** First line of the declaration, modifiers included. */
  startLine: number;
  /** Line of the body's opening `{`. */
  bodyStartLine: number;
  /** Line of the body's closing `}`. */
  endLine: number;
}

export interface ScannedFile {
  /** Over `MAX_SCAN_FILE_BYTES`, so not scanned and holding no functions. */
  tooLarge: boolean;
  lexed: LexedFile;
  functions: FunctionSpan[];
  /**
   * Symbols of the functions that make a check: their own body has an
   * `if`, `throw` or `switch` keyword token. Strings, comments and template
   * text hold no tokens, and nested function bodies (named, anonymous,
   * computed- or string-keyed methods) are skipped, so a guard in a nested
   * arrow counts only for that arrow. Only tokens on a citable body line
   * count (after the line of the body's `{`, before the line of its `}`),
   * so a guard in a default parameter doesn't qualify a function.
   */
  checking: ReadonlySet<string>;
}

/** `.tsx` files are lexed with JSX; everything else as plain TypeScript. */
export function isJsxPath(path: string): boolean {
  return path.endsWith(".tsx");
}

/**
 * Lists the functions in a file, in source order.
 *
 * Symbols are unique per file so a challenge is unambiguous. A class
 * member is always `Class.member`. Any other function is its bare name,
 * or `container.name` (the enclosing function, class or `const` object)
 * when the bare name repeats. Names that still repeat, such as a getter
 * and setter pair, are left out. So is a function with no body line that
 * an answer could cite.
 */
export function listFunctions(text: string, options: { jsx: boolean }): FunctionSpan[] {
  return scanFile(text, options).functions;
}

/** Looks a symbol up the way `checkAnswer` does. */
export function findFunction(text: string, symbol: string, options: { jsx: boolean }): FunctionSpan | undefined {
  return listFunctions(text, options).find((fn) => fn.symbol === symbol);
}

const CONTROL_KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "with",
  "function",
  "return",
  "typeof",
  "new",
  "await",
  "yield",
  "super",
  "import",
  "do",
  "else",
  "try",
  "throw",
  "delete",
  "void",
  "in",
  "of",
  "instanceof",
  "case",
]);

const MEMBER_MODIFIERS = new Set([
  "async",
  "static",
  "public",
  "private",
  "protected",
  "readonly",
  "override",
  "abstract",
  "declare",
  "get",
  "set",
  "accessor",
]);

const DECLARATION_PREFIXES = new Set([...MEMBER_MODIFIERS, "export", "default", "const", "let", "var"]);

/** A type can't end on these, so a `{` after one opens a type literal. */
const TYPE_OPERATOR_WORDS = new Set(["keyof", "typeof", "infer", "is", "asserts", "extends", "readonly", "unique", "new"]);

const CHECK_KEYWORDS = new Set(["if", "throw", "switch"]);

/** How far a type annotation or generic list is followed before giving up, so no input goes quadratic. */
const LOOKAHEAD = 512;

/**
 * Files over this many UTF-8 bytes aren't scanned; `checkAnswer` reports
 * them and `listSurfaceFunctions` lists nothing from them. Shared so the
 * server and `pnpm scan finish` refuse the same files.
 */
export const MAX_SCAN_FILE_BYTES = 1_000_000;

/** UTF-8 length is at least the UTF-16 length and at most three times it. */
function exceedsScanLimit(text: string): boolean {
  if (text.length > MAX_SCAN_FILE_BYTES) return true;
  if (text.length * 3 <= MAX_SCAN_FILE_BYTES) return false;
  return new TextEncoder().encode(text).byteLength > MAX_SCAN_FILE_BYTES;
}

interface Container {
  kind: "class" | "function" | "object";
  name: string | null;
  open: number;
  close: number;
}

interface Found {
  name: string;
  nameIndex: number;
  startIndex: number;
  bodyOpen: number;
  bodyClose: number;
}

export function scanFile(text: string, options: { jsx: boolean }): ScannedFile {
  if (exceedsScanLimit(text)) {
    return { tooLarge: true, lexed: lex("", options), functions: [], checking: new Set() };
  }
  const lexed = lex(text, options);
  const { tokens, match } = lexed;
  const containers: Container[] = [];
  const found: Found[] = [];
  const claimedBodies = new Set<number>();
  const anonymousBodies = new Set<number>();

  const isPunct = (index: number, value: string) => {
    const token = tokens[index];
    return token !== undefined && token.type === "punct" && token.value === value;
  };
  const isIdent = (index: number) => tokens[index]?.type === "ident";

  function skipAngles(start: number): number {
    let depth = 0;
    const stop = Math.min(tokens.length, start + LOOKAHEAD);
    for (let j = start; j < stop; j++) {
      const token = tokens[j]!;
      if (token.type !== "punct") continue;
      if (token.value === "<") depth++;
      else if (token.value === ">") {
        depth--;
        if (depth === 0) return j + 1;
      } else if (token.value === "(" || token.value === "[" || token.value === "{") {
        if (match[j]! < 0) return -1;
        j = match[j]!;
      } else if (token.value === ";") return -1;
    }
    return -1;
  }

  function endsType(token: Token | undefined): boolean {
    if (!token) return false;
    if (token.type === "ident") return !TYPE_OPERATOR_WORDS.has(token.value);
    if (token.type === "punct") return [")", "]", ">", "}"].includes(token.value);
    return token.type === "string" || token.type === "number" || token.type === "template";
  }

  /** From a parameter list's `)`, the index of the body's `{`, or -1. */
  function bodyAfterParams(close: number, arrow: boolean): number {
    let j = close + 1;
    if (!arrow && isPunct(j, "{")) return j;
    if (arrow && isPunct(j, "=>")) return isPunct(j + 1, "{") ? j + 1 : -1;
    if (!isPunct(j, ":")) return -1;
    const typeStart = ++j;
    let angle = 0;
    const stop = Math.min(tokens.length, j + LOOKAHEAD);
    for (; j < stop; j++) {
      const token = tokens[j]!;
      if (token.type !== "punct") continue;
      const value = token.value;
      if (value === "(" || value === "[") {
        if (match[j]! < 0) return -1;
        j = match[j]!;
      } else if (value === "<") angle++;
      else if (value === ">") angle = Math.max(0, angle - 1);
      else if (value === "{") {
        if (!arrow && angle === 0 && j > typeStart && endsType(tokens[j - 1])) return j;
        if (match[j]! < 0) return -1;
        j = match[j]!;
      } else if (value === "=>") {
        if (arrow && angle === 0) return isPunct(j + 1, "{") ? j + 1 : -1;
      } else if (angle === 0 && [";", "=", ",", "}", ")"].includes(value)) return -1;
    }
    return -1;
  }

  /** At the start of a value: the body `{` of a function expression or block arrow, or -1. */
  function functionValueBody(start: number): number {
    let k = start;
    if (tokens[k]?.type === "ident" && tokens[k]!.value === "async" && !isPunct(k + 1, "=>")) k++;
    if (tokens[k]?.type === "ident" && tokens[k]!.value === "function") {
      k++;
      if (isPunct(k, "*")) k++;
      if (isIdent(k)) k++;
      if (isPunct(k, "<")) k = skipAngles(k);
      return k >= 0 && isPunct(k, "(") && match[k]! >= 0 ? bodyAfterParams(match[k]!, false) : -1;
    }
    if (isPunct(k, "<")) k = skipAngles(k);
    if (k < 0) return -1;
    if (isPunct(k, "(")) return match[k]! >= 0 ? bodyAfterParams(match[k]!, true) : -1;
    if (isIdent(k) && isPunct(k + 1, "=>") && isPunct(k + 2, "{")) return k + 2;
    return -1;
  }

  function declarationStart(index: number): number {
    let start = index;
    while (start > 0) {
      const previous = tokens[start - 1]!;
      const isPrefix =
        (previous.type === "ident" && DECLARATION_PREFIXES.has(previous.value)) ||
        (previous.type === "punct" && previous.value === "*");
      if (!isPrefix) break;
      start--;
    }
    return start;
  }

  function record(name: string, nameIndex: number, bodyOpen: number): void {
    if (bodyOpen < 0 || claimedBodies.has(bodyOpen) || !isPunct(bodyOpen, "{")) return;
    const bodyClose = match[bodyOpen]!;
    if (bodyClose < 0) return;
    claimedBodies.add(bodyOpen);
    found.push({ name, nameIndex, startIndex: declarationStart(nameIndex), bodyOpen, bodyClose });
    containers.push({ kind: "function", name, open: bodyOpen, close: bodyClose });
  }

  /** May a method or field name follow this token? */
  function startsMember(index: number): boolean {
    const previous = tokens[index - 1];
    if (!previous) return true;
    if (previous.type === "punct") return ["{", "}", ";", ",", "*"].includes(previous.value);
    return previous.type === "ident" && MEMBER_MODIFIERS.has(previous.value);
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if ((isPunct(i, "[") || token.type === "string") && startsMember(i)) {
      // A computed or string-keyed method has no symbol to give, but its body
      // is still a function, so its guards don't count for the outer one.
      const k = isPunct(i, "[") ? match[i]! + 1 : i + 1;
      if (k > 0 && isPunct(k, "(") && match[k]! >= 0) {
        const body = bodyAfterParams(match[k]!, false);
        if (body >= 0) anonymousBodies.add(body);
      }
      continue;
    }
    if (token.type !== "ident") continue;
    if (isPunct(i - 1, ".") || isPunct(i - 1, "?.")) continue;

    if (token.value === "class") {
      const name = isIdent(i + 1) && !["extends", "implements"].includes(tokens[i + 1]!.value) ? tokens[i + 1]!.value : null;
      for (let k = i + 1; k >= 0 && k < Math.min(tokens.length, i + LOOKAHEAD); k++) {
        if (isPunct(k, "{")) {
          if (match[k]! >= 0) containers.push({ kind: "class", name, open: k, close: match[k]! });
          break;
        }
        if (isPunct(k, "<")) k = skipAngles(k) - 1;
        else if (isPunct(k, "(") && match[k]! >= 0) k = match[k]!;
        else if (isPunct(k, ";") || isPunct(k, "=")) break;
      }
      continue;
    }

    if (token.value === "function") {
      let k = i + 1;
      if (isPunct(k, "*")) k++;
      if (!isIdent(k)) {
        if (isPunct(k, "<")) k = skipAngles(k);
        if (k >= 0 && isPunct(k, "(") && match[k]! >= 0) {
          const body = bodyAfterParams(match[k]!, false);
          if (body >= 0) anonymousBodies.add(body);
        }
        continue;
      }
      const nameIndex = k++;
      if (isPunct(k, "<")) k = skipAngles(k);
      if (k >= 0 && isPunct(k, "(") && match[k]! >= 0) {
        record(tokens[nameIndex]!.value, nameIndex, bodyAfterParams(match[k]!, false));
      }
      continue;
    }

    if (token.value === "const" || token.value === "let" || token.value === "var") {
      if (!isIdent(i + 1)) continue;
      const nameIndex = i + 1;
      let k = i + 2;
      if (isPunct(k, ":")) {
        let angle = 0;
        const stop = Math.min(tokens.length, k + LOOKAHEAD);
        for (k++; k < stop; k++) {
          if (isPunct(k, "<")) angle++;
          else if (isPunct(k, ">")) angle = Math.max(0, angle - 1);
          else if ((isPunct(k, "(") || isPunct(k, "[") || isPunct(k, "{")) && match[k]! >= 0) k = match[k]!;
          else if (angle === 0 && (isPunct(k, "=") || isPunct(k, ";") || isPunct(k, ","))) break;
        }
      }
      if (!isPunct(k, "=")) continue;
      if (isPunct(k + 1, "{") && match[k + 1]! >= 0) {
        containers.push({ kind: "object", name: tokens[nameIndex]!.value, open: k + 1, close: match[k + 1]! });
        continue;
      }
      record(tokens[nameIndex]!.value, nameIndex, functionValueBody(k + 1));
      continue;
    }

    if (CONTROL_KEYWORDS.has(token.value) || !startsMember(i)) continue;
    if (isPunct(i + 1, "(") || isPunct(i + 1, "<")) {
      let k = i + 1;
      if (isPunct(k, "<")) k = skipAngles(k);
      if (k >= 0 && isPunct(k, "(") && match[k]! >= 0) record(token.value, i, bodyAfterParams(match[k]!, false));
    } else if (isPunct(i + 1, "=") || (isPunct(i + 1, ":") && (isPunct(i - 1, "{") || isPunct(i - 1, ",")))) {
      record(token.value, i, functionValueBody(i + 2));
    }
  }

  // Brace-matched containers nest, so one sweep with a stack gives each
  // name token its innermost container.
  const opening = new Map(containers.map((container) => [container.open, container]));
  const nameIndexes = new Set(found.map((fn) => fn.nameIndex));
  const enclosing = new Map<number, Container | undefined>();
  const open: Container[] = [];
  for (let j = 0; j < tokens.length; j++) {
    while (open.length > 0 && open[open.length - 1]!.close <= j) open.pop();
    if (nameIndexes.has(j)) enclosing.set(j, open[open.length - 1]);
    const container = opening.get(j);
    if (container) open.push(container);
  }
  const innermost = (index: number) => enclosing.get(index);

  const spans = found
    .map((fn) => {
      const container = innermost(fn.nameIndex);
      const bodyStartLine = tokens[fn.bodyOpen]!.line;
      const endLine = tokens[fn.bodyClose]!.line;
      let answerable = false;
      for (let line = bodyStartLine + 1; line < endLine && !answerable; line++) answerable = lexed.content[line]!;
      return {
        fn,
        container,
        answerable,
        symbol: container?.kind === "class" && container.name ? `${container.name}.${fn.name}` : fn.name,
        span: { startLine: tokens[fn.startIndex]!.line, bodyStartLine, endLine },
      };
    })
    .filter((entry) => entry.answerable);

  const countBy = (symbols: string[]) => {
    const counts = new Map<string, number>();
    for (const symbol of symbols) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    return counts;
  };
  const bare = countBy(spans.map((entry) => entry.symbol));
  for (const entry of spans) {
    if (bare.get(entry.symbol)! > 1 && entry.container?.name && entry.container.kind !== "class") {
      entry.symbol = `${entry.container.name}.${entry.fn.name}`;
    }
  }
  const qualified = countBy(spans.map((entry) => entry.symbol));

  tokens.forEach((token, index) => {
    if (token.type === "punct" && token.value === "=>" && isPunct(index + 1, "{")) anonymousBodies.add(index + 1);
  });
  const functionBodies = new Set([...claimedBodies, ...anonymousBodies]);
  const makesCheck = (fn: Found): boolean => {
    const bodyStartLine = tokens[fn.bodyOpen]!.line;
    const endLine = tokens[fn.bodyClose]!.line;
    for (let j = fn.bodyOpen + 1; j < fn.bodyClose; j++) {
      const token = tokens[j]!;
      if (functionBodies.has(j) && match[j]! > j) j = match[j]!;
      else if (
        token.line > bodyStartLine &&
        token.line < endLine &&
        token.type === "ident" &&
        CHECK_KEYWORDS.has(token.value) &&
        !isPunct(j - 1, ".") &&
        !isPunct(j - 1, "?.")
      ) {
        return true;
      }
    }
    return false;
  };

  const kept = spans
    .filter((entry) => qualified.get(entry.symbol) === 1)
    .sort((a, b) => a.fn.nameIndex - b.fn.nameIndex);
  const functions = kept.map((entry) => ({ symbol: entry.symbol, name: entry.fn.name, ...entry.span }));
  const checking = new Set(kept.filter((entry) => makesCheck(entry.fn)).map((entry) => entry.symbol));
  return { tooLarge: false, lexed, functions, checking };
}
