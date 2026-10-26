// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WalletState } from "@gleam/core";
import { SITE_ORIGIN } from "@gleam/core/src/models/site-origin.ts";
import { encodeAttestationPayload } from "@gleam/core/src/scan/payload.ts";
import type { Attestation } from "@gleam/core/src/scan/attestation.ts";
import { createRuntime } from "@gleam/runtime/src/create-runtime.ts";
import { createInMemoryPlatform } from "@gleam/runtime/testing/index.ts";
import { createRuntimeHost } from "./host";
import { createPointsLinks, parsePointsLink } from "./points-link";

const ATTESTATION: Attestation = {
  release: "1.4.0",
  commit: "0123456789abcdef0123456789abcdef01234567",
  model: "claude-opus-5-5",
  challenge: "q7Xh2mB9kLp4Wz0RtY6uVa",
  answers: [
    { file: "packages/core/src/vault/encryption.ts", symbol: "decrypt", line: 120, check: "Refuses a ciphertext whose tag doesn't verify." },
    { file: "packages/runtime/src/handlers/provider-params.ts", symbol: "readTransaction", line: 212, check: "Rejects a transaction with an unknown format." },
    { file: "packages/runtime/src/handlers/approval.ts", symbol: "ApprovalHandler.resolveApproval", line: 300, check: "Ignores a resolution for an expired request." },
  ],
  result: "pass",
  report: "# Scan\n\nRead the vault.\n",
};
const PAYLOAD = encodeAttestationPayload(ATTESTATION);
const BASE = "https://open.gleamwallet.app";
const INVITE_URL = `${BASE}/invite?code=GLEAM42`;
const ATTEST_URL = `${BASE}/attest#${PAYLOAD}`;
const SITE = { tier: "site", origin: SITE_ORIGIN };

const base64Url = (text: string) => Buffer.from(text).toString("base64url");

describe("parsePointsLink", () => {
  it("reads an invite link", () => {
    expect(parsePointsLink(INVITE_URL)).toEqual({ kind: "invite", code: "GLEAM42" });
  });

  it("reads an attestation link", () => {
    expect(parsePointsLink(ATTEST_URL)).toEqual({ kind: "attest", attestation: ATTESTATION });
  });

  it("takes the same origin written with its default port or in capitals", () => {
    expect(parsePointsLink("https://OPEN.gleamwallet.app:443/invite?code=GLEAM42")).toEqual({ kind: "invite", code: "GLEAM42" });
  });

  it.each([
    ["not a string", 42],
    ["nothing", undefined],
    ["not a URL", "open.gleamwallet.app/invite?code=GLEAM42"],
    ["http", "http://open.gleamwallet.app/invite?code=GLEAM42"],
    ["a custom scheme", "gleam://open.gleamwallet.app/invite?code=GLEAM42"],
    ["the main site", "https://gleamwallet.app/invite?code=GLEAM42"],
    ["a look-alike host", "https://open.gleamwallet.app.evil.example/invite?code=GLEAM42"],
    ["another host", "https://evil.example/invite?code=GLEAM42"],
    ["another port", "https://open.gleamwallet.app:8443/invite?code=GLEAM42"],
    ["credentials", "https://user:pass@open.gleamwallet.app/invite?code=GLEAM42"],
    ["a trailing slash", `${BASE}/invite/?code=GLEAM42`],
    ["a deeper path", `${BASE}/invite/more?code=GLEAM42`],
    ["another case", `${BASE}/Invite?code=GLEAM42`],
    ["an encoded path", `${BASE}/%69nvite?code=GLEAM42`],
    ["another path", `${BASE}/points?code=GLEAM42`],
    ["the root", `${BASE}/`],
    ["an extra parameter", `${BASE}/invite?code=GLEAM42&utm_source=x`],
    ["the code twice", `${BASE}/invite?code=GLEAM42&code=OTHER42`],
    ["the short parameter name", `${BASE}/invite?c=GLEAM42`],
    ["a fragment on an invite", `${BASE}/invite?code=GLEAM42#x`],
    ["no code", `${BASE}/invite`],
    ["an empty code", `${BASE}/invite?code=`],
    ["a short code", `${BASE}/invite?code=GL`],
    ["an oversized code", `${BASE}/invite?code=${"A".repeat(17)}`],
    ["a lowercase code", `${BASE}/invite?code=gleam42`],
    ["a code with symbols", `${BASE}/invite?code=GLEAM%2042`],
    ["the payload in the query", `${BASE}/attest?p=${PAYLOAD}`],
    ["a query beside the payload", `${BASE}/attest?x=1#${PAYLOAD}`],
    ["a trailing slash on attest", `${BASE}/attest/#${PAYLOAD}`],
    ["no payload", `${BASE}/attest`],
    ["an empty payload", `${BASE}/attest#`],
    ["a payload that isn't base64url", `${BASE}/attest#${PAYLOAD}!`],
    ["a payload that isn't JSON", `${BASE}/attest#${base64Url("not json")}`],
    ["a payload that isn't an attestation", `${BASE}/attest#${base64Url(JSON.stringify({ release: "1.4.0" }))}`],
    ["an attestation with an extra key", `${BASE}/attest#${base64Url(JSON.stringify({ ...ATTESTATION, extra: 1 }))}`],
    ["an oversized link", `${BASE}/attest#${"A".repeat(70_000)}`],
  ])("drops %s", (_label, url) => {
    expect(parsePointsLink(url)).toBeNull();
  });
});

const UNLOCKED: WalletState = {
  wallets: [{ id: "w1", address: "addr-1", name: "Main", method: "jwk" }],
  activeWalletId: "w1",
  session: { unlockedWalletIds: ["w1"] },
} as unknown as WalletState;
const LOCKED = { ...UNLOCKED, session: null } as WalletState;
const EMPTY = { ...UNLOCKED, wallets: [], activeWalletId: null, session: null } as unknown as WalletState;

function fakeRuntime({ state = UNLOCKED, inviteUnlock = null as unknown } = {}) {
  return {
    dispatch: vi.fn(async (type: string) => (type === "getState" ? state : type === "getPointsInviteUnlock" ? inviteUnlock : undefined)),
    dispatchSite: vi.fn(async () => ({ ok: true })),
  };
}

describe("createPointsLinks", () => {
  it("redeems an invite as the site's invite message, even while locked", async () => {
    const runtime = fakeRuntime({ state: LOCKED });
    const links = createPointsLinks(runtime);

    await expect(links.open(INVITE_URL)).resolves.toBe("gate");
    expect(runtime.dispatchSite).toHaveBeenCalledExactlyOnceWith({ type: "gleam-points:invite", code: "GLEAM42" }, SITE);
  });

  it("says the gate is unchanged when the install was already past it", async () => {
    const runtime = fakeRuntime({ inviteUnlock: { code: "", result: "ok", at: 1 } });

    await expect(createPointsLinks(runtime).open(INVITE_URL)).resolves.toBe("invite");
    expect(runtime.dispatchSite).toHaveBeenCalledTimes(1);
  });

  it("does nothing with a dropped link", async () => {
    const runtime = fakeRuntime();
    const links = createPointsLinks(runtime);

    await expect(links.open(`${BASE}/invite?code=GL`)).resolves.toBe("dropped");
    await expect(links.open(`${BASE}/attest?p=${PAYLOAD}`)).resolves.toBe("dropped");
    expect(runtime.dispatch).not.toHaveBeenCalled();
    expect(runtime.dispatchSite).not.toHaveBeenCalled();
  });

  it("hands an attestation to the site's attest message when the wallet is unlocked", async () => {
    const runtime = fakeRuntime();

    await expect(createPointsLinks(runtime).open(ATTEST_URL)).resolves.toBe("attest");
    expect(runtime.dispatchSite).toHaveBeenCalledExactlyOnceWith({ type: "gleam-points:attest", attestation: ATTESTATION }, SITE);
  });

  it("holds an attestation while locked and starts it once, on the first unlocked state", async () => {
    const runtime = fakeRuntime({ state: LOCKED });
    const links = createPointsLinks(runtime);

    await expect(links.open(ATTEST_URL)).resolves.toBe("held");
    links.stateSeen(LOCKED);
    expect(runtime.dispatchSite).not.toHaveBeenCalled();

    links.stateSeen(UNLOCKED);
    links.stateSeen(UNLOCKED);
    expect(runtime.dispatchSite).toHaveBeenCalledExactlyOnceWith({ type: "gleam-points:attest", attestation: ATTESTATION }, SITE);
  });

  it("holds only the latest attestation", async () => {
    const runtime = fakeRuntime({ state: LOCKED });
    const links = createPointsLinks(runtime);
    const newer = { ...ATTESTATION, release: "1.5.0" };

    await links.open(ATTEST_URL);
    await links.open(`${BASE}/attest#${encodeAttestationPayload(newer)}`);
    links.stateSeen(UNLOCKED);
    expect(runtime.dispatchSite).toHaveBeenCalledExactlyOnceWith({ type: "gleam-points:attest", attestation: newer }, SITE);
  });

  it("forgets a held attestation once no wallet is left", async () => {
    const runtime = fakeRuntime({ state: LOCKED });
    const links = createPointsLinks(runtime);

    await links.open(ATTEST_URL);
    links.stateSeen(EMPTY);
    links.stateSeen(UNLOCKED);
    expect(runtime.dispatchSite).not.toHaveBeenCalled();
  });
});

describe("Points links on the runtime host", () => {
  const PASSWORD = "correct horse battery";
  const platform = createInMemoryPlatform();
  const runtime = createRuntime(platform);
  const host = createRuntimeHost(runtime, { onResume: () => {} });
  const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));

  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    await host.dispatch("createWallet", { name: "Main", password: PASSWORD });
  }, 60_000);

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  /** The attestation's reply, once the user has acted on the sheet. */
  async function reply(dispatchSite: ReturnType<typeof vi.spyOn>) {
    return dispatchSite.mock.results.at(-1)!.value as Promise<unknown>;
  }

  it("shows the approval sheet, and a rejection there sends nothing", async () => {
    const present = vi.spyOn(platform.approvalPresenter, "present");
    const dispatchSite = vi.spyOn(runtime, "dispatchSite");
    fetchMock.mockClear();

    await expect(host.openLink(ATTEST_URL)).resolves.toBe("attest");
    await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
    const requestId = present.mock.calls[0]![0];
    await (platform.approvalPresenter as unknown as { userDismiss(id: string): Promise<void> }).userDismiss(requestId);

    await expect(reply(dispatchSite)).resolves.toMatchObject({ ok: false, code: "rejected" });
    expect(fetchMock).not.toHaveBeenCalled();
    present.mockRestore();
    dispatchSite.mockRestore();
  });

  it("holds an attestation while locked and shows the sheet after unlock", async () => {
    const present = vi.spyOn(platform.approvalPresenter, "present");
    await host.dispatch("lockWallet", undefined);

    await expect(host.openLink(ATTEST_URL)).resolves.toBe("held");
    await host.dispatch("getState", undefined);
    expect(present).not.toHaveBeenCalled();

    await host.dispatch("unlockWallet", { password: PASSWORD });
    expect(present).not.toHaveBeenCalled();
    await host.dispatch("getState", undefined);
    await vi.waitFor(() => expect(present).toHaveBeenCalledTimes(1));
    await (platform.approvalPresenter as unknown as { userDismiss(id: string): Promise<void> }).userDismiss(
      present.mock.calls[0]![0],
    );
    present.mockRestore();
  }, 60_000);

  it("drops a link the parser refuses without opening anything", async () => {
    const present = vi.spyOn(platform.approvalPresenter, "present");

    await expect(host.openLink(`https://gleamwallet.app/attest#${PAYLOAD}`)).resolves.toBe("dropped");
    expect(present).not.toHaveBeenCalled();
    present.mockRestore();
  });
});
