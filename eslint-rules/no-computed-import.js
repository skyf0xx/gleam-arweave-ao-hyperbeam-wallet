// `.dependency-cruiser.cjs` checks the fences on resolved files, and a
// computed `import()` path can't be resolved, so it would pass unseen.
export const noComputedImport = {
  meta: { type: "problem", schema: [] },
  create(context) {
    return {
      ImportExpression(node) {
        const src = node.source;
        const literal = src.type === "Literal" || (src.type === "TemplateLiteral" && src.expressions.length === 0);
        if (!literal) {
          context.report({ node, message: "import() takes a literal path, so the import fences can check it." });
        }
      },
    };
  },
};
