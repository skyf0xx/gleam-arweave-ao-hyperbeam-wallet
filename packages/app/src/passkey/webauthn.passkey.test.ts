import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64Url } from "@gleam/core";
import { createUnlockPasskey, PasskeyError, readAnyPasskeyPrf, readPasskeyPrf } from "./webauthn";

class FakePublicKeyCredential {
  static signalUnknownCredential = vi.fn(async () => undefined);
  constructor(
    readonly rawId: ArrayBuffer,
    private readonly results: AuthenticationExtensionsClientOutputs,
  ) {}
  getClientExtensionResults() {
    return this.results;
  }
}

const PRF = new Uint8Array(32).fill(9);
const RAW_ID = new Uint8Array([1, 2, 3, 4]);

const create = vi.fn();
const get = vi.fn();

beforeEach(() => {
  vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
  Object.defineProperty(navigator, "credentials", { value: { create, get }, configurable: true });
  create.mockReset();
  get.mockReset();
  FakePublicKeyCredential.signalUnknownCredential.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createUnlockPasskey", () => {
  it("uses the PRF output returned at creation", async () => {
    create.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, { prf: { enabled: true, results: { first: PRF } } }));

    const created = await createUnlockPasskey();

    expect(created).toMatchObject({ credentialId: bytesToBase64Url(RAW_ID), prfOutput: bytesToBase64Url(PRF) });
    expect(get).not.toHaveBeenCalled();
    const options = create.mock.calls[0]![0].publicKey;
    expect(options.authenticatorSelection.userVerification).toBe("required");
    expect(options.extensions.prf.eval.first).toBeInstanceOf(Uint8Array);
  });

  it("asks once more when the authenticator only reports PRF as enabled", async () => {
    create.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, { prf: { enabled: true } }));
    get.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, { prf: { results: { first: PRF } } }));

    const created = await createUnlockPasskey();

    expect(created.prfOutput).toBe(bytesToBase64Url(PRF));
    expect(get.mock.calls[0]![0].publicKey.allowCredentials[0].id).toEqual(RAW_ID);
  });

  it("refuses a passkey without PRF and asks the password manager to drop it", async () => {
    create.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, { prf: { enabled: false } }));

    await expect(createUnlockPasskey()).rejects.toMatchObject({ reason: "unsupported" });
    expect(FakePublicKeyCredential.signalUnknownCredential).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: bytesToBase64Url(RAW_ID) }),
    );
  });

  it("reports a dismissed prompt as cancelled", async () => {
    create.mockRejectedValue(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));

    const error = await createUnlockPasskey().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PasskeyError);
    expect(error).toMatchObject({ reason: "cancelled" });
  });
});

describe("readPasskeyPrf", () => {
  it("evaluates the stored salt with the enrolled credential and user verification", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, { prf: { results: { first: PRF } } }));
    const salt = new Uint8Array(32).fill(1);

    const output = await readPasskeyPrf({ credentialId: bytesToBase64Url(RAW_ID), prfSalt: bytesToBase64Url(salt) });

    expect(output).toBe(bytesToBase64Url(PRF));
    const options = get.mock.calls[0]![0].publicKey;
    expect(options.userVerification).toBe("required");
    expect(options.extensions.prf.eval.first).toEqual(salt);
  });

  it("fails when the authenticator returns no PRF output", async () => {
    get.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, {}));
    await expect(readPasskeyPrf({ credentialId: "AQID", prfSalt: "AQID" })).rejects.toMatchObject({ reason: "unsupported" });
  });
});

describe("readAnyPasskeyPrf", () => {
  it("offers every passkey with its own salt and reports which one answered", async () => {
    const other = new Uint8Array([9, 9, 9]);
    get.mockResolvedValue(new FakePublicKeyCredential(RAW_ID.buffer, { prf: { results: { first: PRF } } }));
    const candidates = [
      { credentialId: bytesToBase64Url(other), prfSalt: bytesToBase64Url(new Uint8Array(32).fill(2)) },
      { credentialId: bytesToBase64Url(RAW_ID), prfSalt: bytesToBase64Url(new Uint8Array(32).fill(1)) },
    ];

    expect(await readAnyPasskeyPrf(candidates)).toEqual({ credentialId: bytesToBase64Url(RAW_ID), prfOutput: bytesToBase64Url(PRF) });
    const options = get.mock.calls[0]![0].publicKey;
    expect(options.allowCredentials).toHaveLength(2);
    expect(options.extensions.prf.evalByCredential[bytesToBase64Url(RAW_ID)].first).toEqual(new Uint8Array(32).fill(1));
    expect(options.extensions.prf.eval).toBeUndefined();
  });
});
