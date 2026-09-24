import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AddTokenApprovalPreview } from "@gleam/core";
import { AddTokenScreen } from "./AddTokenScreen";

afterEach(() => {
  cleanup();
});

const PROCESS_ID = "p".repeat(43);

const PREVIEW: AddTokenApprovalPreview = {
  kind: "addToken",
  processId: PROCESS_ID,
  ticker: "TKN",
  name: "Token Name",
  address: "a".repeat(43),
};

describe("AddTokenScreen", () => {
  it("shows the origin, ticker, name, the full process id and the wallet it joins", () => {
    render(<AddTokenScreen origin="https://bazar.arweave.net" preview={PREVIEW} onReject={vi.fn()} onAdd={vi.fn()} />);

    expect(screen.getByText("bazar.arweave.net")).toBeTruthy();
    expect(screen.getByText("TKN")).toBeTruthy();
    expect(screen.getByText("Token Name")).toBeTruthy();
    expect(screen.getByText(PROCESS_ID)).toBeTruthy();
    expect(screen.getByText("a".repeat(43))).toBeTruthy();
    expect(screen.getByText(/set by whoever created the token/)).toBeTruthy();
  });

  it("names an unresolved token plainly instead of inventing a ticker", () => {
    render(
      <AddTokenScreen
        origin="https://bazar.arweave.net"
        preview={{ ...PREVIEW, ticker: null, name: null }}
        onReject={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText("Unknown token")).toBeTruthy();
    expect(screen.getByText(PROCESS_ID)).toBeTruthy();
  });

  it("calls onAdd and onReject from their buttons", () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn();
    render(<AddTokenScreen origin="https://bazar.arweave.net" preview={PREVIEW} onReject={onReject} onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "Add token" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("shows a failure inline and lets the user try again", async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error("No HyperBEAM peer configured."));
    render(<AddTokenScreen origin="https://bazar.arweave.net" preview={PREVIEW} onReject={vi.fn()} onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "Add token" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/No HyperBEAM peer/));
    expect((screen.getByRole("button", { name: "Add token" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
