// @vitest-environment node
import { describe, expect, it } from "vitest";
import { changelogSection, readChangelogSection } from "./changelog.mjs";
import { readVersion } from "./release-gate.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

const TEXT = [
  "# Changelog",
  "",
  "## v1.2.10 (2026-01-03)",
  "",
  "- Not this one.",
  "",
  "## v1.2.1 (2026-01-02)",
  "",
  "### Fixed",
  "",
  "- A fix.",
  "",
  "## v1.2.0 (2026-01-01)",
  "",
  "### Added",
  "",
  "## v1.1.0",
  "- Last one.",
  "",
].join("\n");

describe("changelogSection", () => {
  it("returns the section up to the next release heading", () => {
    expect(changelogSection(TEXT, "1.2.1")).toBe("### Fixed\n\n- A fix.");
  });

  it("matches the exact version, not a prefix of a longer one", () => {
    expect(changelogSection(TEXT, "1.2.1")).not.toContain("Not this one");
  });

  it("reads the last section to the end of the file and a heading with no date", () => {
    expect(changelogSection(TEXT, "1.1.0")).toBe("- Last one.");
  });

  it("returns null for a missing section", () => {
    expect(changelogSection(TEXT, "9.9.9")).toBeNull();
  });

  it("returns null for a section with only sub-headings", () => {
    expect(changelogSection(TEXT, "1.2.0")).toBeNull();
  });

  it("reads CRLF line endings", () => {
    expect(changelogSection(TEXT.replace(/\n/g, "\r\n"), "1.2.1")).toBe("### Fixed\n\n- A fix.");
  });
});

describe("CHANGELOG.md", () => {
  // The bump PR fails CI until it carries the new version's notes.
  it("has notes for the current version", () => {
    expect(() => readChangelogSection(ROOT, readVersion(ROOT))).not.toThrow();
  });
});
