// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageJson from "./package.json";

// `cap sync` writes the installed Capacitor version into these files. A
// dependency bump without a sync leaves them pointing at paths that no
// longer exist, and the release build regenerates them into a dirty tree.
const NATIVE_FILES = [
  "ios/App/CapApp-SPM/Package.swift",
  "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved",
  "android/capacitor.settings.gradle",
];

describe("native projects", () => {
  const core = packageJson.dependencies["@capacitor/core"];

  it.each(NATIVE_FILES)("%s matches the installed @capacitor/core (run `cap sync` and resolve packages)", (file) => {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    const pinned = [
      ...text.matchAll(/@capacitor\+core@([\d.]+)/g),
      ...text.matchAll(/capacitor-swift-pm\.git", exact: "([\d.]+)"/g),
      ...text.matchAll(/capacitor-swift-pm\.git",\s*"state" : \{\s*"revision" : "[0-9a-f]+",\s*"version" : "([\d.]+)"/g),
    ].map((match) => match[1]);
    expect(pinned.length).toBeGreaterThan(0);
    expect(new Set(pinned)).toEqual(new Set([core]));
  });

  it.each(["ios/App/CapApp-SPM/Package.swift", "android/capacitor.settings.gradle"])(
    "%s points every plugin at its installed version (run `cap sync`)",
    (file) => {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      const dependencies: Record<string, string> = packageJson.dependencies;
      const paths = [...text.matchAll(/node_modules\/\.pnpm\/(@[^+/]+)\+([^@/]+)@([\d.]+)_/g)].map(
        ([, scope, name, version]) => ({ name: `${scope}/${name}`, version }),
      );
      expect(paths.length).toBeGreaterThan(0);
      expect(paths.filter(({ name, version }) => dependencies[name] !== version)).toEqual([]);
    },
  );
});
