// DESIGN.md's type scale is a set of tokens; a raw `text-[13px]` in a class
// string is a size outside it.
const RAW_TEXT_SIZE = /(^|[\s:"'`])text-\[\d+(\.\d+)?(px|rem|em)\]/;
export const typeScale = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const check = (node, text) => {
      if (RAW_TEXT_SIZE.test(text)) {
        context.report({ node, message: "Use a DESIGN.md type-scale token (text-caption … text-display-lg, text-micro), not a raw size." });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, ` ${node.value}`);
      },
      TemplateElement(node) {
        check(node, ` ${node.value.cooked ?? ""}`);
      },
    };
  },
};
