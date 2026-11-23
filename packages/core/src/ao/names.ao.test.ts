import { describe, expect, it } from "vitest";
import { nameSiteUrl } from "../models/collectible";
import {
  hashpathTarget,
  isNamespaceEntry,
  nameCarrierLabel,
  PERMAWEB_NAMESPACE_ID,
  readCarrierHolding,
  readCarrierState,
} from "./names";

const OWNER = "g3i2SW-ZNrOyXGCxwBDIRtldfXnuC2Grz0K5mk6yufo";
const OWNER_UNDERSCORE = "jt19WluLXKr9lcostp_XNmXRmpdxM4VwmXbmyDLoyNM";
const STRANGER = "M9sQruUg4jlkKdB-isAWmAmCCLI27Gas0Mxj9RkziBY";
const CARRIER = "yfQD7-NoarC_H5FfNZyIWNTsNBLJpdNd9N7i4Qj7cBs";
const TARGET = "k-TX4YWt5r1SFsIjxuR-pBvWbd65b_p9msEg3XBsGWU";

const tags = (o: Record<string, string>) => Object.entries(o).map(([name, value]) => ({ name, value }));
const NAME_TAGS = {
  device: "process@1.0",
  "execution-device": "carrier@1.0",
  ticker: "NAME",
  "total-supply": "1",
  denomination: "0",
  name: "zy",
};

/** The key shapes live nodes answer with (arweave.net and the zephyrdev nodes). */
const didKey = (address: string) => `uri-did-ar-${address.toLowerCase().split("_").join("-")}1bznwhvy8`;
const bareKey = (address: string) => address.toLowerCase().split("_").join("-");

const state = (extra: Record<string, unknown>) => ({ "execution-device": "carrier@1.0", value: { target: TARGET }, ...extra });

describe("nameCarrierLabel", () => {
  it("reads a name carrier's label", () => {
    expect(nameCarrierLabel(tags(NAME_TAGS))).toBe("zy");
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, name: "0-7-0_sart" }))).toBe("0-7-0_sart");
  });

  it("rejects other carriers, token processes and odd labels", () => {
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, ticker: "COLLECTION" }))).toBeNull();
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, "execution-device": "token@1.0" }))).toBeNull();
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, "total-supply": "2" }))).toBeNull();
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, name: "Alice" }))).toBeNull();
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, name: "a/b" }))).toBeNull();
    expect(nameCarrierLabel(tags({ ...NAME_TAGS, name: "" }))).toBeNull();
  });
});

describe("nameSiteUrl", () => {
  it("opens the name as a gateway subdomain", () => {
    expect(nameSiteUrl("zy", "https://arweave.net/")).toBe("https://zy.arweave.net");
  });

  it("skips a label that can't be one DNS label", () => {
    expect(nameSiteUrl("a".repeat(64), "https://arweave.net")).toBeUndefined();
    expect(nameSiteUrl("zy", "not a url")).toBeUndefined();
  });
});

describe("readCarrierHolding", () => {
  it("matches the holder under either node's key shape", () => {
    for (const key of [didKey(OWNER), bareKey(OWNER), OWNER]) {
      expect(readCarrierHolding(state({ balances: { [key]: 1 } }), OWNER)).toEqual({ status: "held", target: TARGET });
    }
    expect(readCarrierHolding(state({ balances: { [didKey(OWNER_UNDERSCORE)]: "1" } }), OWNER_UNDERSCORE)?.status).toBe("held");
  });

  it("reads an escrowed sale order the wallet created as listed", () => {
    const listed = state({
      balances: { [didKey(STRANGER)]: 0 },
      orders: { x: { creator: didKey(STRANGER), quantity: 1, status: "open" } },
    });
    expect(readCarrierHolding(listed, STRANGER)).toEqual({ status: "listed", target: TARGET });
    expect(readCarrierHolding(listed, OWNER)).toBeNull();
  });

  it("ignores settled orders, zero balances and other holders", () => {
    expect(
      readCarrierHolding(state({ balances: {}, orders: { x: { creator: didKey(OWNER), quantity: 1, status: "settled" } } }), OWNER),
    ).toBeNull();
    expect(readCarrierHolding(state({ balances: { [didKey(OWNER)]: 0 } }), OWNER)).toBeNull();
    expect(readCarrierHolding(state({ balances: { [didKey(STRANGER)]: 1 } }), OWNER)).toBeNull();
    expect(readCarrierHolding(state({ balances: { short: 1 } }), OWNER)).toBeNull();
  });

  it("refuses a state that isn't a carrier's and drops a malformed target", () => {
    expect(readCarrierHolding({ balances: { [OWNER]: 1 } }, OWNER)).toBeNull();
    expect(readCarrierHolding("nope", OWNER)).toBeNull();
    expect(readCarrierHolding(state({ balances: { [OWNER]: 1 }, value: { target: "x" } }), OWNER)).toEqual({ status: "held" });
  });
});

describe("readCarrierState", () => {
  it("falls through hosts until one returns JSON state", async () => {
    const calls: string[] = [];
    const impl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      return url.startsWith("https://a.test") ? new Response("x", { status: 500 }) : Response.json(state({}));
    }) as typeof fetch;
    await expect(readCarrierState(CARRIER, ["https://a.test/", "https://b.test"], impl)).resolves.toMatchObject({
      "execution-device": "carrier@1.0",
    });
    expect(calls[1]).toBe(`https://b.test/${CARRIER}~process@1.0/now?require-codec=json%401.0&accept-bundle=true`);
  });

  it("throws when no host answers", async () => {
    const impl = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    await expect(readCarrierState(CARRIER, ["https://a.test"], impl)).rejects.toThrow("HTTP 500");
  });
});

describe("isNamespaceEntry", () => {
  const LIVE_HASHPATH = `ao:${PERMAWEB_NAMESPACE_ID}/ao:FMwDgWNcBHx8GascluqjI8skrpCDM7nSWRcKkAgVPYU.${CARRIER}`;
  const answering = (byHost: Record<string, Response | (() => Response)>) => {
    const calls: Array<{ url: string; method?: string }> = [];
    const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      const reply = byHost[new URL(url).origin];
      if (reply === undefined) throw new TypeError("offline");
      return typeof reply === "function" ? reply() : reply;
    }) as typeof fetch;
    return { impl, calls };
  };

  it("confirms the entry when two hosts resolve it to the same process", async () => {
    const { impl, calls } = answering({
      "https://gw.test": new Response(null, { headers: { hashpath: LIVE_HASHPATH } }),
      "https://node.test": new Response(null, { headers: { hashpath: LIVE_HASHPATH } }),
    });
    await expect(isNamespaceEntry("zy", CARRIER, ["https://gw.test", "https://node.test"], impl)).resolves.toBe(true);
    expect(calls).toEqual([
      { url: `https://gw.test/${PERMAWEB_NAMESPACE_ID}/zy`, method: "HEAD" },
      { url: `https://node.test/${PERMAWEB_NAMESPACE_ID}/zy`, method: "HEAD" },
    ]);
  });

  it("does not bind a label on one host's word alone", async () => {
    const { impl } = answering({
      "https://gw.test": new Response(null, { headers: { hashpath: LIVE_HASHPATH } }),
      "https://node.test": new Response(null, { status: 404 }),
    });
    await expect(isNamespaceEntry("zy", CARRIER, ["https://gw.test", "https://node.test"], impl)).resolves.toBe(false);
  });

  it("refuses an entry that resolves to another process", async () => {
    const { impl } = answering({ "https://gw.test": new Response(null, { headers: { hashpath: LIVE_HASHPATH } }) });
    await expect(isNamespaceEntry("zy", TARGET, ["https://gw.test"], impl)).resolves.toBe(false);
  });

  it("asks the next host when one can't resolve the path", async () => {
    const { impl } = answering({
      "https://a.test": new Response(null, { status: 404 }),
      "https://c.test": new Response(null, { headers: { hashpath: LIVE_HASHPATH } }),
      "https://d.test": new Response(null, { headers: { hashpath: LIVE_HASHPATH } }),
    });
    await expect(
      isNamespaceEntry("zy", CARRIER, ["https://a.test", "https://b.test", "https://c.test", "https://d.test"], impl),
    ).resolves.toBe(true);
  });

  it("never asks about a label or id it wouldn't accept", async () => {
    const { impl, calls } = answering({});
    await expect(isNamespaceEntry("../x", CARRIER, ["https://gw.test"], impl)).resolves.toBe(false);
    await expect(isNamespaceEntry("zy", "short", ["https://gw.test"], impl)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("hashpathTarget", () => {
  it("takes the id after the last step's dot", () => {
    expect(hashpathTarget(`ao:${PERMAWEB_NAMESPACE_ID}/ao:${TARGET}.${CARRIER}`)).toBe(CARRIER);
    expect(hashpathTarget(`ao:${CARRIER}`)).toBe(CARRIER);
    expect(hashpathTarget(null)).toBeUndefined();
    expect(hashpathTarget("ao:x/ao:y.z")).toBeUndefined();
  });
});
