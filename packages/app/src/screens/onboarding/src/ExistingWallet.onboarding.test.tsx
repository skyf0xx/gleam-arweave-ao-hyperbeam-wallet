import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { fakeAppPlatform, renderWithPlatform } from "../../../app-platform/testing";
import { AddWalletStart } from "./AddWalletStart";
import { ExistingWallet } from "./ExistingWallet";

afterEach(cleanup);

const handlers = { onImport: vi.fn(), onConnectKeystone: vi.fn(), onConnectLedger: vi.fn(), onWatch: vi.fn() };

const screens = {
  ExistingWallet: () => <ExistingWallet onBack={vi.fn()} {...handlers} />,
  AddWalletStart: () => <AddWalletStart onBack={vi.fn()} onCreate={vi.fn()} {...handlers} />,
};

describe.each(Object.entries(screens))("%s hardware wallets", (_name, Screen) => {
  it("lists both devices when the platform supports both", () => {
    renderWithPlatform(<Screen />, fakeAppPlatform({ capabilities: { hardwareWallets: { ledger: true, keystone: true } } }));
    expect(screen.getByRole("button", { name: "Ledger" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keystone" })).toBeTruthy();
  });

  it("lists only Ledger when only Ledger is supported", () => {
    renderWithPlatform(<Screen />, fakeAppPlatform({ capabilities: { hardwareWallets: { keystone: false } } }));
    expect(screen.getByRole("button", { name: "Ledger" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keystone" })).toBeNull();
  });

  it("lists only Keystone when only Keystone is supported", () => {
    renderWithPlatform(<Screen />, fakeAppPlatform({ capabilities: { hardwareWallets: { ledger: false } } }));
    expect(screen.getByRole("button", { name: "Keystone" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ledger" })).toBeNull();
  });

  it("drops the whole section when neither is supported", () => {
    renderWithPlatform(
      <Screen />,
      fakeAppPlatform({ capabilities: { hardwareWallets: { ledger: false, keystone: false } } }),
    );
    expect(screen.queryByRole("region", { name: "Hardware wallet" })).toBeNull();
    expect(screen.queryByText("Hardware wallet")).toBeNull();
    expect(screen.getByRole("button", { name: /Import a keyfile/ })).toBeTruthy();
  });
});
