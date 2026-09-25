import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { NetworkSettings, RuntimePort, UploadReview, WalletSummary } from "@gleam/core";
import { UploadView } from "./UploadView";

afterEach(() => {
  cleanup();
});

const NETWORK_SETTINGS: NetworkSettings = {
  gatewayUrl: "https://arweave.net",
  peers: [],
  activePeerUrl: null,
};

function fakeRuntime(overrides: Partial<RuntimePort> = {}): RuntimePort {
  return {
    send: vi.fn(async (message: { type: string }) => {
      if (message.type === "getNetworkSettings") return NETWORK_SETTINGS;
      throw new Error(`unexpected message type ${message.type}`);
    }) as RuntimePort["send"],
    onMessage: vi.fn(() => () => {}),
    ...overrides,
  };
}

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const WALLET: WalletSummary = {
  id: "wallet-1",
  address: "abcDEF1234567890abcDEF1234567890abcDEF1234",
  name: "Test wallet",
  method: "jwk",
  publicKey: "pubkey",
  createdAt: 0,
  updatedAt: 0,
  backupConfirmedAt: null,
};

async function typeText(value: string) {
  fireEvent.click(screen.getByRole("button", { name: "Text" }));
  fireEvent.change(screen.getByPlaceholderText("Write or paste text to publish…"), {
    target: { value },
  });
}

describe("UploadView", () => {
  it("disables Continue until content is present", async () => {
    const runtime = fakeRuntime();
    renderWithClient(<UploadView runtime={runtime} wallet={WALLET} onBack={vi.fn()} onDone={vi.fn()} />);

    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    await typeText("Notes from the field trip.");
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a live byte-count warning once tags exceed the cap", async () => {
    const runtime = fakeRuntime();
    renderWithClient(<UploadView runtime={runtime} wallet={WALLET} onBack={vi.fn()} onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
    const nameInputs = screen.getAllByPlaceholderText("Name");
    const valueInputs = screen.getAllByPlaceholderText("Value");
    fireEvent.change(nameInputs[nameInputs.length - 1]!, { target: { value: "Description" } });
    fireEvent.change(valueInputs[valueInputs.length - 1]!, { target: { value: "a".repeat(4090) } });

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/the limit is 4,096/));
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls reviewUpload on Continue and shows the secret-scan warning, disabling Sign and upload", async () => {
    const review: UploadReview = { tagByteSize: 30, secretScanMatch: "PEM block" };
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getNetworkSettings") return NETWORK_SETTINGS;
      if (message.type === "reviewUpload") return review;
      throw new Error(`unexpected message type ${message.type}`);
    }) as RuntimePort["send"];
    const runtime = fakeRuntime({ send });

    renderWithClient(<UploadView runtime={runtime} wallet={WALLET} onBack={vi.fn()} onDone={vi.fn()} />);

    await typeText("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(screen.getByText(/This looks like a PEM block\./)).toBeTruthy(),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "reviewUpload" }),
    );
    expect((screen.getByRole("button", { name: "Sign and upload" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a Free cost row on the review step when the scan is clean", async () => {
    const review: UploadReview = { tagByteSize: 30, secretScanMatch: null };
    const send = vi.fn(async (message: { type: string }) => {
      if (message.type === "getNetworkSettings") return NETWORK_SETTINGS;
      if (message.type === "reviewUpload") return review;
      throw new Error(`unexpected message type ${message.type}`);
    }) as RuntimePort["send"];
    const runtime = fakeRuntime({ send });

    renderWithClient(<UploadView runtime={runtime} wallet={WALLET} onBack={vi.fn()} onDone={vi.fn()} />);

    await typeText("Notes from the field trip.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByText("Cost")).toBeTruthy());
    expect(screen.getByText("Free")).toBeTruthy();
  });

  it("submits and shows tx id links on success when the scan is clean", async () => {
    const review: UploadReview = { tagByteSize: 30, secretScanMatch: null };
    const send = vi.fn().mockImplementation(async (message: { type: string }) => {
      if (message.type === "getNetworkSettings") return NETWORK_SETTINGS;
      if (message.type === "reviewUpload") return review;
      if (message.type === "submitUpload") return { txId: "test-tx-id-123" };
      throw new Error(`unexpected message type ${message.type}`);
    });
    const runtime = fakeRuntime({ send });
    const onDone = vi.fn();

    renderWithClient(<UploadView runtime={runtime} wallet={WALLET} onBack={vi.fn()} onDone={onDone} />);

    await typeText("Notes from the field trip.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign and upload" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Sign and upload" }));

    await waitFor(() => expect(screen.getByText("Signed and uploaded.")).toBeTruthy());
    expect(screen.getByRole("link", { name: "View content" }).getAttribute("href")).toBe(
      "https://arweave.net/test-tx-id-123",
    );
    expect(screen.getByRole("link", { name: "View in explorer" }).getAttribute("href")).toBe(
      "https://lunar.arweave.net/#/explorer/test-tx-id-123",
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("uses the configured gateway for the view-content link", async () => {
    const review: UploadReview = { tagByteSize: 30, secretScanMatch: null };
    const customNetworkSettings: NetworkSettings = {
      gatewayUrl: "https://my-gateway.example",
      peers: [],
      activePeerUrl: null,
    };
    const send = vi.fn().mockImplementation(async (message: { type: string }) => {
      if (message.type === "getNetworkSettings") return customNetworkSettings;
      if (message.type === "reviewUpload") return review;
      if (message.type === "submitUpload") return { txId: "test-tx-id-456" };
      throw new Error(`unexpected message type ${message.type}`);
    });
    const runtime = fakeRuntime({ send });

    renderWithClient(<UploadView runtime={runtime} wallet={WALLET} onBack={vi.fn()} onDone={vi.fn()} />);

    await typeText("Notes from the field trip.");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Sign and upload" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Sign and upload" }));

    await waitFor(() => expect(screen.getByText("Signed and uploaded.")).toBeTruthy());
    expect(screen.getByRole("link", { name: "View content" }).getAttribute("href")).toBe(
      "https://my-gateway.example/test-tx-id-456",
    );
  });
});
