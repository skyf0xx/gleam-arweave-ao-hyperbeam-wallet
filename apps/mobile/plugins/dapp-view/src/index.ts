import { registerPlugin } from "@capacitor/core";
import type { DappViewPlugin } from "./definitions";

export * from "./definitions";

// No web implementation: in the browser preview every call rejects as
// unimplemented.
export const DappView = registerPlugin<DappViewPlugin>("DappView");
