import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deriveAddress,
  type BadgePort,
  type JWKInterface,
  type Signer,
  type StoragePort,
  type WalletMethod,
} from "@gleam/core";
import { signerFromJwk, generateJWK } from "@gleam/core/signer";
import { buildAttestMessage, verifyPointsProof } from "@gleam/core/src/points/index.ts";
import { attestationId, parseAttestation, type ParsedAttestation } from "@gleam/core/src/scan/attestation.ts";
import { PointsHandler } from "./points";


const API = "https://points.example";

const ATTESTATION = {
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

let wallet: { jwk: JWKInterface; address: string; signer: Signer };
let attestation: ParsedAttestation;
let id: string;
let message: string;

beforeAll(async () => {
  const jwk = await generateJWK();
  const address = await deriveAddress(jwk);
  wallet = { jwk, address, signer: signerFromJwk(jwk, address) };
  const parsed = parseAttestation(ATTESTATION);
  if (!parsed.ok) throw new Error("fixture is invalid");
  attestation = parsed.attestation;
  id = await attestationId(attestation);
  message = buildAttestMessage(attestation.release, id);
}, 60_000);

const storage: StoragePort = {
  async get() {
    return null;
  },
  async set() {},
  async setMany() {},
  async remove() {},
  watch() {
    return () => {};
  },
};
const badge: BadgePort = { setDot: async () => {} };

function setup(
  respond: (url: string, init?: RequestInit) => Promise<Response>,
  options: { walletMethod?: WalletMethod; locked?: boolean; deviceProof?: ConstructorParameters<typeof PointsHandler>[0]["deviceProof"] } = {},
) {
  const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(respond);
  const handler = new PointsHandler({
    storage,
    deviceKey: {
      loadOrCreate: async () => {
        throw new Error("attesting never uses the device key");
      },
    },
    apiUrl: API,
    signer: async () => (options.locked ? null : wallet.signer),
    walletMethod: async () => options.walletMethod ?? "jwk",
    deviceProof: options.deviceProof,
    badge,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { handler, fetchImpl };
}

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("PointsHandler.attest", () => {
  it("signs the attest message with signMessage and posts exactly the server's submit body", async () => {
    const { handler, fetchImpl } = setup(json({ ok: true, attestationId: id, points: "5000000000000", paid: true, unpaidReason: null, paidPlacesLeft: 19 }));

    const result = await handler.attest({ walletId: "w1", attestation });

    expect(result).toEqual({ ok: true, attestationId: id, points: "5000000000000", paid: true, unpaidReason: null, paidPlacesLeft: 19 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API}/attestations`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // A keyfile's proof is the default, so `proof` is left out as at /register.
    expect(Object.keys(body).sort()).toEqual(["attestation", "message", "owner", "signature"]);
    expect(body).toMatchObject({ attestation: ATTESTATION, message, owner: wallet.jwk.n });
    expect(await verifyPointsProof("message", wallet.jwk.n, message, body.signature as string)).toBe(true);
  });

  it("a hardware wallet proves with the ownership transaction and sends proof: transaction", async () => {
    const deviceProof = vi.fn(async ({ message: build }: { walletId: string; message: (address: string) => string }) => ({
      owner: "device-owner",
      address: "device-address",
      signature: "c2ln",
      message: build("device-address"),
    }));
    const { handler, fetchImpl } = setup(json({ ok: true, attestationId: id, points: "0", paid: false, paidPlacesLeft: 0 }), {
      walletMethod: "keystone",
      deviceProof,
    });

    await handler.attest({ walletId: "hw", attestation });

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ owner: "device-owner", message, signature: "c2ln", proof: "transaction" });
  });

  it("refuses to sign for a locked wallet without posting", async () => {
    const { handler, fetchImpl } = setup(json({}), { locked: true });

    await expect(handler.attest({ walletId: "w1", attestation })).rejects.toThrow("Unlock this wallet to sign a scan attestation.");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a proof made over another message", async () => {
    const { handler, fetchImpl } = setup(json({}));

    await expect(
      handler.submitAttestation(attestation, { owner: "o", address: "a", message: "gleam-points:attest:v1:1.4.0:" + "0".repeat(64), signature: "s", proof: "message" }),
    ).rejects.toThrow(/isn't for this attestation/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes the server's reason for an unpaid scan through, and reads an unknown one as none", async () => {
    const reasoned = setup(json({ ok: true, attestationId: id, points: "0", paid: false, unpaidReason: "no_snapshot", paidPlacesLeft: 5 }));
    expect(await reasoned.handler.attest({ walletId: "w1", attestation })).toMatchObject({ paid: false, unpaidReason: "no_snapshot" });
    const odd = setup(json({ ok: true, attestationId: id, points: "0", paid: false, unpaidReason: "whatever", paidPlacesLeft: 5 }));
    expect(await odd.handler.attest({ walletId: "w1", attestation })).toMatchObject({ unpaidReason: null });
  });

  it.each([
    ["already_attested", 409, /already attested v1\.4\.0.*next release/],
    ["release_not_latest", 409, /v1\.4\.0 is no longer the latest release/],
    ["challenge_expired", 409, /expired.*pnpm scan start/],
    ["challenge_used", 409, /already used/],
    ["answers_failed", 422, /pnpm scan finish/],
    ["wallet_not_registered", 403, /isn't in Gleam Points/],
    ["wallet_not_live", 403, /last 3 days/],
    ["invalid_signature", 401, /didn't accept the signature/],
    ["github_unavailable", 503, /in a minute/],
    ["challenge_unavailable", 503, /in a minute/],
    ["unknown_release", 404, /latest release/],
  ])("maps the server's %s to one sentence with a next step", async (code, status, sentence) => {
    const { handler } = setup(json({ error: "agent-facing text", code }, status));

    const result = await handler.attest({ walletId: "w1", attestation });

    expect(result).toEqual({ ok: false, code, error: expect.stringMatching(sentence) });
    expect(result.ok === false && result.error).not.toContain("agent-facing text");
  });

  it("a 429 without a code reads as rate limited, and an unknown code keeps the server's sentence", async () => {
    expect(await setup(json({ error: "Slow down." }, 429)).handler.attest({ walletId: "w1", attestation })).toMatchObject({
      code: "rate_limited",
    });
    expect(await setup(json({ error: "Something new.", code: "brand_new" }, 400)).handler.attest({ walletId: "w1", attestation })).toEqual({
      ok: false,
      code: "server_error",
      error: "The points server refused the attestation: Something new. Open the link again later.",
    });
  });

  it("a network failure, a hung request or an unreadable success is offline", async () => {
    const failing = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await failing.handler.attest({ walletId: "w1", attestation })).toMatchObject({ ok: false, code: "offline" });

    // AbortSignal.timeout runs on the platform's clock, so the abort itself is simulated.
    const hung = setup(async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    expect(await hung.handler.attest({ walletId: "w1", attestation })).toMatchObject({ ok: false, code: "offline" });

    const odd = setup(json({ ok: true, attestationId: id, points: 5, paid: true, paidPlacesLeft: 1 }));
    expect(await odd.handler.attest({ walletId: "w1", attestation })).toMatchObject({ ok: false, code: "offline" });
  });
});

describe("PointsHandler.checkAttestation", () => {
  it("posts only the attestation to /attestations/check and passes when the server accepts it", async () => {
    const { handler, fetchImpl } = setup(json({ ok: true, attestationId: id, paidPlacesLeft: 3 }));

    expect(await handler.checkAttestation(attestation)).toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API}/attestations/check`);
    expect(JSON.parse(String(init?.body))).toEqual({ attestation: ATTESTATION });
  });

  it("sends the wallet's address when it has one", async () => {
    const { handler, fetchImpl } = setup(json({ ok: true }));

    await handler.checkAttestation(attestation, "addr-1");

    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body))).toEqual({ attestation: ATTESTATION, address: "addr-1" });
  });

  it("turns a refusal into the sentence saying what to do next, and a dead network into offline", async () => {
    const expired = await setup(json({ error: "x", code: "challenge_expired" }, 409)).handler.checkAttestation(attestation);
    expect(expired).toMatchObject({ ok: false, error: expect.stringContaining("pnpm scan start") });

    const down = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await down.handler.checkAttestation(attestation)).toMatchObject({ ok: false, error: expect.stringContaining("couldn't reach the points server") });
  });
});
