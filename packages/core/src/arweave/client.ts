import ArweaveImport from "arweave";

type ArweaveClass = typeof ArweaveImport;

/**
 * `arweave` 1.x shipped CommonJS with the class on `module.exports.default`.
 * Vite 8 (Rolldown) imports CommonJS from a `"type": "module"` package
 * like this one in Node mode, where a default import is the whole
 * `module.exports`, so `import Arweave from "arweave"` yielded
 * `{ default: Arweave }` in the built extension. 2.x exports the class
 * itself (ESM `web/`, `module.exports = Arweave` in `node/`), but any
 * bundler or version change can reintroduce the wrapped shape, so accept
 * either.
 */
export function resolveArweaveClass(mod: ArweaveClass | { default: ArweaveClass }): ArweaveClass {
  return "init" in mod ? mod : mod.default;
}

/** Import `Arweave` from here, never from `"arweave"` directly. */
export const Arweave: ArweaveClass = resolveArweaveClass(ArweaveImport);
export type Arweave = InstanceType<ArweaveClass>;
