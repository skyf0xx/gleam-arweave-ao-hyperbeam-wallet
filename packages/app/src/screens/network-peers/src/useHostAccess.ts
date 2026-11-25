import { usePlatform } from "../../../app-platform/context";
import { peerOriginPattern } from "./network-urls";

export function useHostAccess() {
  const { capabilities, hostPermissions } = usePlatform();
  // Without runtime host permissions every origin is already reachable.
  const hasHostAccess = async (url: string): Promise<boolean> => {
    if (!capabilities.hostPermissions) return true;
    try {
      return await hostPermissions.contains([peerOriginPattern(url)]);
    } catch {
      return false;
    }
  };
  const requestHostAccess = async (url: string): Promise<boolean> => {
    if (!capabilities.hostPermissions) return true;
    try {
      return await hostPermissions.request([peerOriginPattern(url)]);
    } catch {
      return false;
    }
  };
  return { hasHostAccess, requestHostAccess };
}
