import { createContext, useContext, type ReactNode } from "react";
import type { AppPlatform } from "./types";

const PlatformContext = createContext<AppPlatform | null>(null);

export function PlatformProvider({ platform, children }: { platform: AppPlatform; children: ReactNode }) {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): AppPlatform {
  const platform = useContext(PlatformContext);
  if (platform === null) throw new Error("usePlatform needs a PlatformProvider above it");
  return platform;
}
