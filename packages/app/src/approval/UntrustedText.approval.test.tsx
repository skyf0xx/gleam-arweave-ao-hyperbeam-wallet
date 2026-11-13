import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { SigningApprovalPreview } from "@gleam/core";
import { SigningApprovalScreen } from "./SigningApprovalScreen";
import { UntrustedText, escapeHiddenCharacters } from "./UntrustedText";

afterEach(() => {
  cleanup();
});

const HIDDEN = /[\p{Cf}\u2028\u2029]/u;

const MESSAGE = "const amount = /*\u202e*/100.0/*\u202c*/;";

const SIGN_MESSAGE_PREVIEW: SigningApprovalPreview = {
  kind: "signMessage",
  recipient: null,
  amount: null,
  fee: null,
  token: null,
  tokenDenomination: null,
  tokenTicker: null,
  decodedData: MESSAGE,
  tags: [],
  payloadHash: "1a9d4f7c2e5b8a0f3c6d9b2e5a8f1c4d7b0e3a6c9f2b5d8e1a4c7f0b3d6e9a2c",
  items: null,
};

describe("escapeHiddenCharacters", () => {
  it("splits out bidi, zero-width and line-separator characters as code points", () => {
    expect(escapeHiddenCharacters("a\u202eb\u200bc\u2028d\u{e0041}")).toEqual([
      "a",
      { codePoint: "U+202E" },
      "b",
      { codePoint: "U+200B" },
      "c",
      { codePoint: "U+2028" },
      "d",
      { codePoint: "U+E0041" },
    ]);
  });

  it("splits out invisible Hangul fillers, the grapheme joiner, Khmer invisibles and variation selectors", () => {
    expect(escapeHiddenCharacters("A\u115fO")).toEqual(["A", { codePoint: "U+115F" }, "O"]);
    expect(escapeHiddenCharacters("A\u1160O")).toEqual(["A", { codePoint: "U+1160" }, "O"]);
    expect(escapeHiddenCharacters("A\u3164O")).toEqual(["A", { codePoint: "U+3164" }, "O"]);
    expect(escapeHiddenCharacters("A\uffa0O")).toEqual(["A", { codePoint: "U+FFA0" }, "O"]);
    expect(escapeHiddenCharacters("A\u034fO")).toEqual(["A", { codePoint: "U+034F" }, "O"]);
    expect(escapeHiddenCharacters("A\u17b4O")).toEqual(["A", { codePoint: "U+17B4" }, "O"]);
    expect(escapeHiddenCharacters("A\u17b5O")).toEqual(["A", { codePoint: "U+17B5" }, "O"]);
    expect(escapeHiddenCharacters("A\ufe00O")).toEqual(["A", { codePoint: "U+FE00" }, "O"]);
    expect(escapeHiddenCharacters("A\ufe0fO")).toEqual(["A", { codePoint: "U+FE0F" }, "O"]);
  });

  it("splits out the Mongolian and supplementary variation selectors", () => {
    expect(escapeHiddenCharacters("A\u180bO")).toEqual(["A", { codePoint: "U+180B" }, "O"]);
    expect(escapeHiddenCharacters("A\u180dO")).toEqual(["A", { codePoint: "U+180D" }, "O"]);
    expect(escapeHiddenCharacters("A\u{e0100}O")).toEqual(["A", { codePoint: "U+E0100" }, "O"]);
    expect(escapeHiddenCharacters("A\u{e01ef}O")).toEqual(["A", { codePoint: "U+E01EF" }, "O"]);
  });

  it("leaves ordinary text, newlines, tabs and right-to-left letters alone", () => {
    expect(escapeHiddenCharacters("שלום 100\n\tok")).toEqual(["שלום 100\n\tok"]);
  });
});

describe("UntrustedText", () => {
  it("renders hidden characters as visible code points in an isolated left-to-right run", () => {
    const { container } = render(<UntrustedText text={MESSAGE} />);
    const run = container.firstElementChild!;
    expect(run.tagName).toBe("BDI");
    expect(run.getAttribute("dir")).toBe("ltr");
    expect(run.textContent).toBe("const amount = /*<U+202E>*/100.0/*<U+202C>*/;");
  });
});

describe("SigningApprovalScreen hidden characters", () => {
  it("shows bidi controls in a message as code points instead of letting them reorder it", () => {
    const { container } = render(
      <SigningApprovalScreen origin="https://example.com" preview={SIGN_MESSAGE_PREVIEW} onReject={vi.fn()} onSign={vi.fn()} />,
    );
    expect(HIDDEN.test(container.textContent!)).toBe(false);
    expect(container.textContent).toContain("/*<U+202E>*/100.0/*<U+202C>*/");
  });

  it("shows hidden characters in tag names and values, and in batch items", () => {
    const { container } = render(
      <SigningApprovalScreen
        origin="https://example.com"
        preview={{
          ...SIGN_MESSAGE_PREVIEW,
          kind: "batchSignDataItem",
          items: [
            {
              decodedData: MESSAGE,
              tags: [{ name: "Quan\u200btity", value: "\u2067100\u2069" }],
              target: null,
              payloadHash: SIGN_MESSAGE_PREVIEW.payloadHash,
              transfer: null,
            },
          ],
        }}
        onReject={vi.fn()}
        onSign={vi.fn()}
      />,
    );
    expect(HIDDEN.test(container.textContent!)).toBe(false);
    expect(container.textContent).toContain("Quan<U+200B>tity");
    expect(container.textContent).toContain("<U+2067>100<U+2069>");
  });

  it("shows hidden characters in a single item's tags", () => {
    const { container } = render(
      <SigningApprovalScreen
        origin="https://example.com"
        preview={{ ...SIGN_MESSAGE_PREVIEW, kind: "signDataItem", decodedData: "x", tags: [{ name: "Action", value: "Trans\u202efer" }] }}
        onReject={vi.fn()}
        onSign={vi.fn()}
      />,
    );
    expect(HIDDEN.test(container.textContent!)).toBe(false);
    expect(container.textContent).toContain("Trans<U+202E>fer");
  });

  it("breaks long unbroken tag values in the generic screen's tag chips", () => {
    const { container } = render(
      <SigningApprovalScreen
        origin="https://example.com"
        preview={{ ...SIGN_MESSAGE_PREVIEW, kind: "signDataItem", decodedData: "x", tags: [{ name: "Action", value: "a".repeat(2000) }] }}
        onReject={vi.fn()}
        onSign={vi.fn()}
      />,
    );
    const chip = Array.from(container.querySelectorAll("span")).find((element) => element.textContent?.startsWith("Action:"));
    expect(chip?.className).toContain("break-all");
  });

  it("breaks long unbroken tag values in batch item cards", () => {
    const { container } = render(
      <SigningApprovalScreen
        origin="https://example.com"
        preview={{
          ...SIGN_MESSAGE_PREVIEW,
          kind: "batchSignDataItem",
          items: [
            {
              decodedData: "",
              tags: [{ name: "Action", value: "a".repeat(2000) }],
              target: null,
              payloadHash: SIGN_MESSAGE_PREVIEW.payloadHash,
              transfer: null,
            },
          ],
        }}
        onReject={vi.fn()}
        onSign={vi.fn()}
      />,
    );
    const chip = Array.from(container.querySelectorAll("span")).find((element) => element.textContent?.startsWith("Action:"));
    expect(chip?.className).toContain("break-all");
  });
});
