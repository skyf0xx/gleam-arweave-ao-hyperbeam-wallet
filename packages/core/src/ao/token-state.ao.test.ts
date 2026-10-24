import { describe, expect, it } from "vitest";
import { readTokenStateLogo } from "./token-state";

const PID = "xU9zFkq3X2ZQ6olwNVvr1vUWIjc3kXTWr7xKQD6dh10";
const LOGO = "L".repeat(43);
const PEER = "https://peer.test/";

function headResponse(headers: Record<string, string>, status = 200): Response {
  return new Response(null, { status, headers });
}

describe("readTokenStateLogo", () => {
  it("reads the logo header from a HEAD on the process's compute", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([String(input), init]);
      return headResponse({ ticker: "T", logo: LOGO });
    }) as typeof fetch;
    expect(await readTokenStateLogo(PID, PEER, fetchImpl)).toBe(LOGO);
    expect(calls.map(([url]) => url)).toEqual([`https://peer.test/${PID}~process@1.0/compute&max-age=60`]);
    expect(calls[0]?.[1]?.method).toBe("HEAD");
  });

  it("trims the logo", async () => {
    const fetchImpl = (async () => headResponse({ logo: ` ${LOGO} ` })) as typeof fetch;
    expect(await readTokenStateLogo(PID, PEER, fetchImpl)).toBe(LOGO);
  });

  it("returns null for a missing or blank logo and for a 4xx answer", async () => {
    expect(await readTokenStateLogo(PID, PEER, (async () => headResponse({ ticker: "T" })) as typeof fetch)).toBeNull();
    expect(await readTokenStateLogo(PID, PEER, (async () => headResponse({ logo: "  " })) as typeof fetch)).toBeNull();
    expect(await readTokenStateLogo(PID, PEER, (async () => headResponse({}, 404)) as typeof fetch)).toBeNull();
    expect(await readTokenStateLogo(PID, PEER, (async () => headResponse({}, 403)) as typeof fetch)).toBeNull();
  });

  it("throws on a 5xx or a network failure so the caller can tell it from no logo", async () => {
    await expect(readTokenStateLogo(PID, PEER, (async () => headResponse({}, 570)) as typeof fetch)).rejects.toThrow("570");
    const offline = (async () => {
      throw new TypeError("offline");
    }) as typeof fetch;
    await expect(readTokenStateLogo(PID, PEER, offline)).rejects.toThrow("offline");
  });
});
