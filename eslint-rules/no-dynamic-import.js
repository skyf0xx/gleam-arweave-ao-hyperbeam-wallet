// `no-restricted-imports` reads only static `import`/`export … from`, so
// this catches `import("…")` with a literal path against the same regex.
export const noDynamicImport = {
  meta: {
    type: "problem",
    schema: { type: "array", items: { type: "object", properties: { regex: { type: "string" }, message: { type: "string" } } } },
  },
  create(context) {
    const fences = context.options.map(({ regex, message }) => ({ re: new RegExp(regex), message }));
    return {
      ImportExpression(node) {
        const src = node.source;
        const path =
          src.type === "Literal" && typeof src.value === "string"
            ? src.value
            : src.type === "TemplateLiteral" && src.expressions.length === 0
              ? src.quasis[0].value.cooked
              : null;
        if (path === null) return;
        for (const { re, message } of fences) {
          if (re.test(path)) context.report({ node, message: `'${path}' import is restricted. ${message}` });
        }
      },
    };
  },
};
