/**
 * A small TypeScript/TSX tokenizer, just enough to match braces and find
 * function declarations. The extension bundles this module, so it can't
 * pull in the TypeScript compiler.
 *
 * It knows strings, template literals (with nested `${}`), comments, regex
 * literals and JSX, so a brace inside any of them never counts. Two parts
 * are heuristics:
 *
 * - A `/` starts a regex unless the previous token ends an expression (an
 *   identifier that isn't a keyword like `return`, a literal, `)`, `]`,
 *   `}`, or a postfix `++`/`--`). So `if (x) /re/.test(y)` reads as
 *   division; Prettier-formatted code doesn't write that.
 * - In TSX, a `<` starts an element when it is in expression position and
 *   isn't a generic arrow's `<T,>` or `<T extends …>`.
 *
 * Lines are numbered by `\n` only, as editors and `git blame` show them to
 * the agent citing them; CRLF is one break. A `//` comment still ends at
 * `\r`, U+2028 and U+2029 as it does in TypeScript, so code after one of
 * those on the same numbered line is read as code, not hidden as comment.
 *
 * It keeps an explicit stack of modes instead of recursing, so deeply
 * nested templates or JSX can't overflow the call stack.
 */

export type TokenType = "ident" | "punct" | "string" | "template" | "number" | "regex" | "jsx" | "boundary";

export interface Token {
  type: TokenType;
  value: string;
  /** 1-based line of the token's first character. */
  line: number;
}

export interface LexedFile {
  tokens: Token[];
  /** For each `(`, `[` or `{` token index, the index of its closer, and back; -1 if unmatched. */
  match: Int32Array;
  lineCount: number;
  /** Indexed by 1-based line: holds code other than bare punctuation. */
  content: boolean[];
  /** Indexed by 1-based line: holds punctuation such as `}` or `});`. */
  punctuation: boolean[];
  /** Indexed by 1-based line: holds any part of a comment. */
  comment: boolean[];
}

/** Lines made only of these tokens hold no check. */
const BARE_PUNCTUATION = new Set(["{", "}", "(", ")", "[", "]", ";", ",", "=>"]);

/** Keywords after which an expression starts, so `/` is a regex and `<` may be JSX. */
const EXPRESSION_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

const OPENERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

const isWhitespace = (char: string | undefined) => char !== undefined && /\s/.test(char);
const isDigit = (char: string | undefined) => char !== undefined && char >= "0" && char <= "9";
const isIdentStart = (char: string | undefined) =>
  char !== undefined && (/[A-Za-z_$#]/.test(char) || (char.charCodeAt(0) > 127 && !/\s/.test(char)));
const isIdentPart = (char: string | undefined) =>
  char !== undefined && (/[\w$]/.test(char) || (char.charCodeAt(0) > 127 && !/\s/.test(char)));
const endsLineComment = (char: string) => char === "\n" || char === "\r" || char === " " || char === " ";

type Frame =
  | { kind: "code"; nested: boolean; depth: number }
  | { kind: "template"; start: number; segment: number }
  | { kind: "jsxTag"; start: number; root: boolean }
  | { kind: "jsxChildren"; start: number; root: boolean };

export function lex(text: string, options: { jsx: boolean }): LexedFile {
  const n = text.length;
  const lineStarts = [0];
  for (let index = 0; index < n; index++) if (text[index] === "\n") lineStarts.push(index + 1);
  const lineCount = lineStarts.length;
  const content = new Array<boolean>(lineCount + 1).fill(false);
  const punctuation = new Array<boolean>(lineCount + 1).fill(false);
  const comment = new Array<boolean>(lineCount + 1).fill(false);
  const tokens: Token[] = [];
  const stack: Frame[] = [{ kind: "code", nested: false, depth: 0 }];
  let i = 0;

  function lineAt(offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  }

  function markSpan(lines: boolean[], start: number, end: number): void {
    const last = lineAt(Math.max(start, end - 1));
    for (let line = lineAt(start); line <= last; line++) lines[line] = true;
  }

  function markNonBlank(start: number, end: number): void {
    let line = lineAt(start);
    for (let offset = start; offset < end; offset++) {
      const char = text[offset]!;
      if (char === "\n") line++;
      else if (!isWhitespace(char)) content[line] = true;
    }
  }

  function push(type: TokenType, start: number, end: number): void {
    const value = text.slice(start, end);
    tokens.push({ type, value, line: lineAt(start) });
    if (type === "boundary" || type === "template" || type === "jsx") return;
    markSpan(type === "punct" && BARE_PUNCTUATION.has(value) ? punctuation : content, start, end);
  }

  function endsExpression(index: number): boolean {
    const token = tokens[index];
    if (!token) return false;
    switch (token.type) {
      case "ident":
        return !EXPRESSION_KEYWORDS.has(token.value);
      case "punct":
        if (token.value === "++" || token.value === "--") {
          // Postfix (`i++ / 2`) ends an expression; prefix (`x = ++ /re/`) doesn't occur.
          const before = tokens[index - 1];
          return (
            before !== undefined &&
            ((before.type === "ident" && !EXPRESSION_KEYWORDS.has(before.value)) ||
              (before.type === "punct" && (before.value === ")" || before.value === "]")))
          );
        }
        return token.value === ")" || token.value === "]" || token.value === "}";
      case "boundary":
        return false;
      default:
        return true;
    }
  }
  const previousEndsExpression = () => endsExpression(tokens.length - 1);

  function lexString(quote: string): void {
    const start = i++;
    while (i < n) {
      const char = text[i];
      if (char === "\\") i += 2;
      else if (char === quote) {
        i++;
        break;
      } else if (char === "\n" || char === "\r") break;
      else i++;
    }
    push("string", start, Math.min(i, n));
  }

  function lexRegex(): void {
    const start = i++;
    let inClass = false;
    while (i < n) {
      const char = text[i]!;
      if (char === "\\") {
        i += 2;
        continue;
      }
      if (endsLineComment(char)) break;
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) {
        i++;
        break;
      }
      i++;
    }
    while (i < n && /[a-z]/.test(text[i]!)) i++;
    push("regex", start, Math.min(i, n));
  }

  function lexNumber(): void {
    const start = i;
    while (i < n) {
      const char = text[i]!;
      if (/[0-9A-Za-z_.]/.test(char)) i++;
      else if ((char === "+" || char === "-") && /[eE]/.test(text[i - 1]!) && !/^0[xX]/.test(text.slice(start, i))) i++;
      else break;
    }
    push("number", start, i);
  }

  function looksLikeJsx(): boolean {
    let j = i + 1;
    if (text[j] === ">") return true;
    if (!isIdentStart(text[j]) || text[j] === "#") return false;
    while (j < n && (isIdentPart(text[j]) || text[j] === "." || text[j] === ":" || text[j] === "-")) j++;
    while (isWhitespace(text[j])) j++;
    if (text[j] === ",") return false;
    return !(text.startsWith("extends", j) && !isIdentPart(text[j + 7]));
  }

  function openContainer(): void {
    push("boundary", i, i + 1);
    i++;
    stack.push({ kind: "code", nested: true, depth: 0 });
  }

  function finishElement(frame: { start: number; root: boolean }): void {
    stack.pop();
    if (frame.root) push("jsx", frame.start, i);
  }

  function stepCode(frame: Extract<Frame, { kind: "code" }>): void {
    const char = text[i]!;
    const next = text[i + 1];
    if (isWhitespace(char)) {
      i++;
    } else if (char === "/" && next === "/") {
      const start = i;
      while (i < n && !endsLineComment(text[i]!)) i++;
      markSpan(comment, start, i);
    } else if (char === "/" && next === "*") {
      const start = i;
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      markSpan(comment, start, i);
    } else if (char === "/" && !previousEndsExpression()) {
      lexRegex();
    } else if (char === "'" || char === '"') {
      lexString(char);
    } else if (char === "`") {
      stack.push({ kind: "template", start: i, segment: i + 1 });
      i++;
    } else if (char === "{") {
      frame.depth++;
      push("punct", i, ++i);
    } else if (char === "}") {
      if (frame.depth === 0 && frame.nested) {
        stack.pop();
        push("boundary", i, ++i);
        const parent = stack[stack.length - 1];
        if (parent?.kind === "template") parent.segment = i;
        return;
      }
      frame.depth = Math.max(0, frame.depth - 1);
      push("punct", i, ++i);
    } else if (options.jsx && char === "<" && !previousEndsExpression() && looksLikeJsx()) {
      stack.push({ kind: "jsxTag", start: i, root: true });
      i++;
    } else if (isDigit(char) || (char === "." && isDigit(next))) {
      lexNumber();
    } else if (isIdentStart(char)) {
      const start = i++;
      while (isIdentPart(text[i])) i++;
      push("ident", start, i);
    } else if (text.startsWith("...", i)) {
      push("punct", i, (i += 3));
    } else if (
      (char === "=" && next === ">") ||
      (char === "+" && next === "+") ||
      (char === "-" && next === "-") ||
      (char === "?" && next === "." && !isDigit(text[i + 2]))
    ) {
      push("punct", i, (i += 2));
    } else {
      push("punct", i, ++i);
    }
  }

  function stepTemplate(frame: Extract<Frame, { kind: "template" }>): void {
    while (i < n) {
      const char = text[i];
      if (char === "\\") {
        i += 2;
      } else if (char === "`") {
        markNonBlank(frame.segment, i);
        i++;
        stack.pop();
        push("template", frame.start, i);
        return;
      } else if (char === "$" && text[i + 1] === "{") {
        markNonBlank(frame.segment, i);
        push("boundary", i, i + 2);
        i += 2;
        stack.push({ kind: "code", nested: true, depth: 0 });
        return;
      } else {
        i++;
      }
    }
  }

  function stepJsxTag(frame: Extract<Frame, { kind: "jsxTag" }>): void {
    const char = text[i]!;
    if (char === "{") {
      openContainer();
    } else if (char === '"' || char === "'") {
      const start = i;
      const end = text.indexOf(char, i + 1);
      i = end < 0 ? n : end + 1;
      markNonBlank(start, i);
    } else if (char === "/" && text[i + 1] === ">") {
      content[lineAt(i)] = true;
      i += 2;
      finishElement(frame);
    } else if (char === ">") {
      content[lineAt(i)] = true;
      i++;
      stack[stack.length - 1] = { kind: "jsxChildren", start: frame.start, root: frame.root };
    } else {
      if (!isWhitespace(char)) content[lineAt(i)] = true;
      i++;
    }
  }

  function stepJsxChildren(frame: Extract<Frame, { kind: "jsxChildren" }>): void {
    const char = text[i]!;
    if (char === "{") {
      openContainer();
    } else if (char === "<") {
      let j = i + 1;
      while (isWhitespace(text[j])) j++;
      if (text[j] === "/") {
        const end = text.indexOf(">", j);
        const stop = end < 0 ? n : end + 1;
        markNonBlank(i, stop);
        i = stop;
        finishElement(frame);
      } else {
        stack.push({ kind: "jsxTag", start: i, root: false });
        i++;
      }
    } else {
      if (!isWhitespace(char)) content[lineAt(i)] = true;
      i++;
    }
  }

  if (text.startsWith("#!")) {
    while (i < n && !endsLineComment(text[i]!)) i++;
    markSpan(comment, 0, i);
  }
  while (i < n) {
    const frame = stack[stack.length - 1]!;
    if (frame.kind === "code") stepCode(frame);
    else if (frame.kind === "template") stepTemplate(frame);
    else if (frame.kind === "jsxTag") stepJsxTag(frame);
    else stepJsxChildren(frame);
  }
  i = n;
  while (stack.length > 1) {
    const frame = stack.pop()!;
    if (frame.kind === "template") {
      markNonBlank(frame.segment, n);
      push("template", frame.start, n);
    } else if ((frame.kind === "jsxTag" || frame.kind === "jsxChildren") && frame.root) {
      push("jsx", frame.start, n);
    }
  }

  const match = new Int32Array(tokens.length).fill(-1);
  const stacks: Record<string, number[]> = { "(": [], "[": [], "{": [] };
  tokens.forEach((token, index) => {
    if (token.type !== "punct") return;
    const opener = OPENERS[token.value];
    if (stacks[token.value]) stacks[token.value]!.push(index);
    else if (opener) {
      const open = stacks[opener]!.pop();
      if (open !== undefined) {
        match[open] = index;
        match[index] = open;
      }
    }
  });

  return { tokens, match, lineCount, content, punctuation, comment };
}
