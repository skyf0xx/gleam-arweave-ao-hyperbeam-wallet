// A `storage.set(K, …)` in a file that also reads `storage.get(K)` is a
// read-modify-write, whichever function does the read: another write to K
// between the two is lost. Such a write goes through `updateStored`
// (`runtime/src/storage-update.ts`), which runs one update per key at a
// time. A key is named by its constant: `${PREFIX}${id}` by PREFIX,
// `keyFor(id)` by keyFor, and a local `const key = …` by what it holds. A
// read through a helper's parameter (`load(key)`) reads every key, and a
// write through one writes every key. A whole-value write that doesn't
// depend on the read takes an eslint-disable with the reason.
export const noStorageReadModifyWrite = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const source = context.sourceCode;
    const gets = [];
    const sets = [];
    const isStorage = (node) => {
      const name = node.type === "MemberExpression" ? node.property.name : node.type === "Identifier" ? node.name : null;
      return typeof name === "string" && /storage$/i.test(name);
    };
    const ANY = "*";
    const keyOf = (node, seen = new Set()) => {
      if (node.type === "TemplateLiteral") {
        const first = node.expressions[0];
        return first && node.quasis[0].value.raw === "" ? keyOf(first, seen) : source.getText(node);
      }
      if (node.type === "CallExpression") return source.getText(node.callee);
      if (node.type === "Identifier") {
        if (/^[A-Z][A-Z0-9_]*$/.test(node.name) || seen.has(node.name)) return node.name;
        seen.add(node.name);
        let scope = source.getScope(node);
        while (scope) {
          const variable = scope.set.get(node.name);
          if (variable) {
            const def = variable.defs[0];
            if (def?.type === "Parameter") return ANY;
            if (def?.type === "Variable" && def.node.init) return keyOf(def.node.init, seen);
            return node.name;
          }
          scope = scope.upper;
        }
        return node.name;
      }
      return source.getText(node);
    };
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        if (!isStorage(callee.object) || node.arguments.length === 0) return;
        if (callee.property.name === "get") gets.push(keyOf(node.arguments[0]));
        else if (callee.property.name === "set") sets.push({ key: keyOf(node.arguments[0]), node });
      },
      "Program:exit"() {
        for (const set of sets) {
          if (gets.includes(set.key) || gets.includes(ANY) || (set.key === ANY && gets.length > 0)) {
            context.report({
              node: set.node,
              message: `${set.key} is written in a file that reads it. Use updateStored (runtime/src/storage-update.ts), which runs one update per key at a time.`,
            });
          }
        }
      },
    };
  },
};
