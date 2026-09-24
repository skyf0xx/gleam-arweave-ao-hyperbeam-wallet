import { describe, expect, it } from "vitest";
import { METHOD_PERMISSIONS, missingPermissions } from "./method-permissions";
import { PROVIDER_METHODS, type ProviderMethod } from "./method-privileges";
import { PERMISSION_TYPES, type PermissionType } from "./permission";

describe("METHOD_PERMISSIONS", () => {
  it("covers every provider method and nothing else", () => {
    expect(Object.keys(METHOD_PERMISSIONS).sort()).toEqual([...PROVIDER_METHODS].sort());
  });

  it("uses only real permission types", () => {
    for (const permissions of Object.values(METHOD_PERMISSIONS)) {
      for (const permission of permissions) {
        expect(PERMISSION_TYPES).toContain(permission);
      }
    }
  });

  it.each<[ProviderMethod, PermissionType[]]>([
    ["connect", []],
    ["disconnect", []],
    ["getPermissions", []],
    ["getActiveAddress", ["ACCESS_ADDRESS"]],
    ["getAllAddresses", ["ACCESS_ALL_ADDRESSES"]],
    ["getWalletNames", ["ACCESS_ALL_ADDRESSES"]],
    ["getActivePublicKey", ["ACCESS_PUBLIC_KEY"]],
    ["getArweaveConfig", ["ACCESS_ARWEAVE_CONFIG"]],
    ["getBalances", ["ACCESS_ADDRESS", "ACCESS_TOKENS"]],
    ["sign", ["SIGN_TRANSACTION"]],
    ["dispatch", ["DISPATCH"]],
    ["encrypt", ["ENCRYPT"]],
    ["decrypt", ["DECRYPT"]],
    ["signature", ["SIGNATURE"]],
    ["signMessage", ["SIGNATURE"]],
    ["privateHash", ["SIGNATURE"]],
    ["verifyMessage", ["SIGNATURE"]],
    ["signDataItem", ["SIGN_TRANSACTION"]],
    ["batchSignDataItem", ["SIGN_TRANSACTION"]],
    ["transferAoTokens", ["SIGN_TRANSACTION"]],
    ["tokenBalance", ["ACCESS_TOKENS"]],
    ["userTokens", ["ACCESS_TOKENS"]],
    ["addToken", []],
    ["isTokenAdded", []],
  ])("%s needs %j", (method, permissions) => {
    expect(METHOD_PERMISSIONS[method]).toEqual(permissions);
  });
});

describe("missingPermissions", () => {
  it("is empty when the grant covers the method", () => {
    expect(missingPermissions("sign", ["ACCESS_ADDRESS", "SIGN_TRANSACTION"])).toEqual([]);
  });

  it("lists only the permissions the grant lacks", () => {
    expect(missingPermissions("getBalances", ["ACCESS_ADDRESS"])).toEqual(["ACCESS_TOKENS"]);
    expect(missingPermissions("getBalances", [])).toEqual(["ACCESS_ADDRESS", "ACCESS_TOKENS"]);
  });

  it("doesn't let one signing permission stand in for another", () => {
    expect(missingPermissions("dispatch", ["SIGN_TRANSACTION"])).toEqual(["DISPATCH"]);
    expect(missingPermissions("sign", ["DISPATCH", "SIGNATURE"])).toEqual(["SIGN_TRANSACTION"]);
  });
});
