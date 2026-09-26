import ArweaveImport from "arweave";

type ArweaveClass = typeof ArweaveImport;

/**
 * `arweave` ships CommonJS with the class on `module.exports.default`.
 * Vite 8 (Rolldown) imports CommonJS from a `"type": "module"` package
 * like this one in Node mode, where a default import is the whole
 * `module.exports`, so `import Arweave from "arweave"` yields
 * `{ default: Arweave }` in the built extension. Vitest and older
 * bundlers yield the class itself. Accept either shape.
 */
export function resolveArweaveClass(mod: ArweaveClass | { default: ArweaveClass }): ArweaveClass {
  return "init" in mod ? mod : mod.default;
}

/** Import `Arweave` from here, never from `"arweave"` directly. */
export const Arweave: ArweaveClass = resolveArweaveClass(ArweaveImport);
export type Arweave = InstanceType<ArweaveClass>;
