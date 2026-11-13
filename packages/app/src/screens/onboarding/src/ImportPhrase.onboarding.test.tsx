import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform } from "../../../app-platform/testing";
import { ImportPhrase } from "./ImportPhrase";
import type { DerivePhraseKey } from "./phrase-key";

afterEach(cleanup);

const PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const JWK = { kty: "RSA", n: "n", e: "AQAB" };

function setup(derive: DerivePhraseKey = vi.fn(async () => JWK)) {
  const onValidJWK = vi.fn();
  renderWithPlatform(<ImportPhrase onBack={vi.fn()} onValidJWK={onValidJWK} derive={derive} />, fakeAppPlatform());
  const cell = (n: number) => screen.getByRole("textbox", { name: new RegExp(`^Word ${n} of`) }) as HTMLInputElement;
  const paste = (n: number, text: string) =>
    fireEvent.paste(cell(n), { clipboardData: { getData: () => text } });
  return { onValidJWK, derive, cell, paste };
}

describe("ImportPhrase", () => {
  it("spreads a phrase pasted into any cell across the grid", () => {
    const { cell, paste } = setup();
    paste(4, `1. legal\n2. winner\n${PHRASE.split(" ").slice(2).join(", ")}`);
    expect(cell(1).value).toBe("legal");
    expect(cell(12).value).toBe("yellow");
    expect(screen.getByText(/still on your clipboard/)).toBeTruthy();
  });

  it("switches to a 24-word grid for a 24-word paste", () => {
    const { cell, paste } = setup();
    paste(1, `${"abandon ".repeat(23)}art`);
    expect(cell(24).value).toBe("art");
    expect(screen.getByRole("button", { name: "24" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("says how many words an off-length paste had", () => {
    const { paste } = setup();
    paste(1, `${PHRASE} zoo`);
    expect(screen.getByRole("alert").textContent).toMatch(/13 words/);
  });

  it("blocks submit while an off-length paste is shown, and never derives", async () => {
    const { paste, derive } = setup();
    paste(1, `${"abandon ".repeat(23)}art abandon`);
    expect(screen.getByRole("alert").textContent).toMatch(/25 words/);
    const button = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // A disabled button can't be clicked, but Enter still submits the
    // form, so the handler itself has to refuse too.
    fireEvent.submit(document.querySelector("form")!);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(derive).not.toHaveBeenCalled();
  });

  it("lets an edited cell clear the off-length paste error", () => {
    const { paste, cell } = setup();
    paste(1, `${"abandon ".repeat(23)}art abandon`);
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(cell(24), { target: { value: "zoo" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the words out of password managers, autocorrect and view", () => {
    const { cell } = setup();
    const input = cell(1);
    expect(input.type).toBe("text");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.className).toContain("[-webkit-text-security:disc]");
    expect(input.dataset.masked).toBe("true");
    fireEvent.focus(input);
    expect(input.dataset.masked).toBe("false");
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Show words" }));
    expect(input.dataset.masked).toBe("false");
    expect(input.className).not.toContain("text-security");
  });

  it("moves to the next cell when a typed word ends with a space", () => {
    const { cell } = setup();
    fireEvent.change(cell(1), { target: { value: "legal " } });
    expect(cell(1).value).toBe("legal");
    expect(document.activeElement).toBe(cell(2));
  });

  it("suggests wordlist words for a partial word", () => {
    const { cell } = setup();
    fireEvent.focus(cell(1));
    fireEvent.change(cell(1), { target: { value: "leg" } });
    fireEvent.click(screen.getByRole("button", { name: "legal" }));
    expect(cell(1).value).toBe("legal");
  });

  it("flags a word that isn't on the list", () => {
    const { cell } = setup();
    fireEvent.focus(cell(3));
    fireEvent.change(cell(3), { target: { value: "bitcoin" } });
    fireEvent.blur(cell(3));
    expect(screen.getByRole("alert").textContent).toMatch(/Word 3/);
  });

  it("rejects a phrase whose checksum fails without deriving", async () => {
    const { paste, derive } = setup();
    paste(1, PHRASE.replace(/yellow$/, "legal"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/valid recovery phrase/));
    expect(derive).not.toHaveBeenCalled();
  });

  it("derives the key for a valid phrase and hands it on", async () => {
    const { paste, derive, onValidJWK } = setup();
    paste(1, PHRASE);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onValidJWK).toHaveBeenCalledWith(JWK));
    expect(vi.mocked(derive).mock.calls[0]![0]).toEqual(PHRASE.split(" "));
  });

  it("shows progress while deriving and stops the work on cancel", async () => {
    let signal: AbortSignal | undefined;
    const derive: DerivePhraseKey = (_words, abort) => {
      signal = abort;
      return new Promise(() => {});
    };
    const { paste, onValidJWK } = setup(derive);
    paste(1, PHRASE);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Recreating your wallet…");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(signal?.aborted).toBe(true);
    expect(onValidJWK).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: /^Word 1 of/ })).toBeTruthy();
  });

  it("says so when derivation fails", async () => {
    const { paste } = setup(async () => {
      throw new Error("boom");
    });
    paste(1, PHRASE);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/couldn't recreate/));
  });
});
