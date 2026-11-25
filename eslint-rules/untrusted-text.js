// Strings from a site, a token process, a tag or a device render through
// `<UntrustedText>` (bidi controls, zero-width characters), never as bare
// JSX text. Checks JSX children only; an attribute value is a prop for
// something else to render. The user's own labels are named in OWN_LABELS.
const UNTRUSTED_ALWAYS = new Set(["ticker", "tokenTicker", "decodedData"]);
const UNTRUSTED_ON_TAG = new Set(["name", "value", "walletName"]);
const UNTRUSTED_PATHS = new Set(["appInfo.name", "summary.text"]);
const OWN_LABELS = new Set(["wallet", "from", "contact"]);
export const untrustedText = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const nameOf = (node) =>
      node.type === "Identifier" ? node.name : node.type === "MemberExpression" && !node.computed ? node.property.name : null;
    const untrusted = (expr) => {
      const node = expr.type === "ChainExpression" ? expr.expression : expr;
      if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier") return false;
      const prop = node.property.name;
      const object = nameOf(node.object);
      if (object === null || OWN_LABELS.has(object)) return false;
      if (UNTRUSTED_PATHS.has(`${object}.${prop}`)) return true;
      if (UNTRUSTED_ALWAYS.has(prop)) return true;
      return UNTRUSTED_ON_TAG.has(prop) && /tag/i.test(object);
    };
    return {
      JSXExpressionContainer(node) {
        if (node.parent.type !== "JSXElement" && node.parent.type !== "JSXFragment") return;
        if (node.expression.type === "JSXEmptyExpression" || !untrusted(node.expression)) return;
        const wrapped = context.sourceCode
          .getAncestors(node)
          .some((a) => a.type === "JSXElement" && a.openingElement.name.type === "JSXIdentifier" && a.openingElement.name.name === "UntrustedText");
        if (wrapped) return;
        context.report({
          node,
          message: `${context.sourceCode.getText(node.expression)} comes from a site, token or tag. Render it through <UntrustedText>, never as bare JSX text.`,
        });
      },
    };
  },
};
