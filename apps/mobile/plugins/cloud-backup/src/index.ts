import { registerPlugin } from "@capacitor/core";
import type { GoogleDriveAuthPlugin, ICloudFilePlugin } from "./definitions";

export * from "./definitions";

// Each is native on one platform only, and neither has a web
// implementation: elsewhere every call rejects as unimplemented.
export const GoogleDriveAuth = registerPlugin<GoogleDriveAuthPlugin>("GoogleDriveAuth");
export const ICloudFile = registerPlugin<ICloudFilePlugin>("ICloudFile");
