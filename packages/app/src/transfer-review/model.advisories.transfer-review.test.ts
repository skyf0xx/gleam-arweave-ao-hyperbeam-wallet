import { describe, expect, it } from "vitest";
import { otherTags } from "@gleam/core/src/ao/other-tags.ts";
import { ADVISORY_FIXTURES } from "./advisories.fixtures";
import { transferRequestFromPreview } from "./model";

// Every past advisory where an unmodelled shape previewed as a clean
// transfer has a fixture in `advisories.fixtures.ts`. A new advisory in
// this class adds its fixture there, not a one-off test here.
describe("past transfer-preview advisories", () => {
  it.each(ADVISORY_FIXTURES.map((fixture) => [`${fixture.advisory}: ${fixture.shape}`, fixture] as const))("%s", (_, fixture) => {
    const request = transferRequestFromPreview(fixture.preview);
    const headline = request?.transfers[0] ?? null;
    expect(headline && { recipient: headline.recipient, amount: headline.amount }).toEqual(fixture.headline);

    const { outcome } = fixture;
    if (outcome.kind === "unreadable") {
      if (request === null) {
        // The generic screen still warns when a signed item looks like a transfer it can't read.
        if (fixture.preview.items) expect(fixture.preview.items.some((item) => item.unreadableTokenTransfer === true)).toBe(true);
      } else {
        expect(request.unreadableTokenTransfer).toBe(true);
        if (request.others.length > 0) expect(request.others.some((item) => item.unreadableTokenTransfer === true)).toBe(true);
      }
    } else if (outcome.kind === "otherTags") {
      expect(request).not.toBeNull();
      expect(request!.unreadableTokenTransfer).toBeUndefined();
      expect(headline!.otherTags).toBeGreaterThan(0);
      const reader = fixture.preview.items ? "ao" : "l1";
      expect(otherTags(headline!.part.tags, reader).map((tag) => tag.name)).toContain(outcome.tag);
    } else {
      expect(request).not.toBeNull();
      expect(request!.unreadableTokenTransfer).toBeUndefined();
      expect(headline!.token).toBe(outcome.token);
      expect(Boolean(headline!.collectible)).toBe(outcome.collectible ?? false);
    }
  });

  it("covers every advisory in the class", () => {
    expect(new Set(ADVISORY_FIXTURES.map((fixture) => fixture.advisory))).toEqual(
      new Set(["v1.41.0 F-1", "v1.41.0 F-2", "v1.41.0 F-6", "v1.42.0 F-1", "v1.42.0 F-5", "v1.43.1 F-1", "v1.44.0 F-2", "v1.44.0 F-3", "R2-W3-1"]),
    );
  });
});
