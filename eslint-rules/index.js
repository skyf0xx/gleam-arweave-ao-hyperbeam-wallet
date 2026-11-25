import { noComputedImport } from "./no-computed-import.js";
import { noDynamicImport } from "./no-dynamic-import.js";
import { noStorageReadModifyWrite } from "./no-storage-read-modify-write.js";
import { typeScale } from "./type-scale.js";
import { untrustedText } from "./untrusted-text.js";

export const gleam = {
  rules: {
    "untrusted-text": untrustedText,
    "type-scale": typeScale,
    "no-dynamic-import": noDynamicImport,
    "no-computed-import": noComputedImport,
    "no-storage-read-modify-write": noStorageReadModifyWrite,
  },
};
