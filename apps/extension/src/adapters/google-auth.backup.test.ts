import { describe, expect, it, vi } from "vitest";
import { InMemoryStorage } from "@gleam/runtime/testing";
import { createGoogleAuth, GOOGLE_OAUTH_CLIENT_ID } from "./google-auth";

vi.mock("wxt/browser", () => ({ browser: {} }));

const REDIRECT = "https://einabcphdmlicabnjllaaallnebfkmki.chromiumapp.org/";

type Flow = { url: string; interactive?: boolean; abortOnLoadForNonInteractive?: boolean; timeoutMsForNonInteractive?: number };

/** Google's side: answers each flow with what `answer` returns for the request's own parameters. */
function harness(answer: (request: URLSearchParams, flow: Flow) => string | Error) {
  const flows: Flow[] = [];
  const storage = new InMemoryStorage();
  const clock = { now: 1_000_000 };
  const fetchImpl = vi.fn(async () => new Response(null));
  const auth = createGoogleAuth({
    storage,
    identity: {
      getRedirectURL: () => REDIRECT,
      launchWebAuthFlow: (async (flow: Flow) => {
        flows.push(flow);
        const result = answer(new URL(flow.url).searchParams, flow);
        if (result instanceof Error) throw result;
        return result;
      }) as never,
    },
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => clock.now,
  });
  return { auth, flows, storage, clock, fetchImpl };
}

const grants = (token: string) => (request: URLSearchParams) =>
  `${REDIRECT}#access_token=${token}&token_type=Bearer&expires_in=3600&state=${request.get("state")}`;

describe("createGoogleAuth", () => {
  it("asks Google for the app-folder scope alone, answered to this extension", async () => {
    const { auth, flows } = harness(grants("token-1"));
    expect(await auth.token(true)).toBe("token-1");
    const request = new URL(flows[0]!.url);
    expect(request.origin + request.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(request.searchParams)).toMatchObject({
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: "token",
      scope: "https://www.googleapis.com/auth/drive.appdata",
    });
    expect(request.searchParams.has("prompt")).toBe(false);
    expect(flows[0]!.interactive).toBe(true);
  });

  it("renews with no UI, giving Google's page time to redirect", async () => {
    const { auth, flows } = harness(grants("token-1"));
    await auth.token(false);
    expect(new URL(flows[0]!.url).searchParams.get("prompt")).toBe("none");
    expect(flows[0]).toMatchObject({ interactive: false, abortOnLoadForNonInteractive: false, timeoutMsForNonInteractive: 10_000 });
  });

  it("reuses a token until shortly before it expires", async () => {
    const { auth, flows, clock } = harness(grants("token-1"));
    await auth.token(true);
    clock.now += 3_500_000;
    expect(await auth.token(false)).toBe("token-1");
    expect(flows).toHaveLength(1);
    clock.now += 50_000;
    await auth.token(false);
    expect(flows).toHaveLength(2);
  });

  it("has no token when the flow is closed or would need the person", async () => {
    const { auth } = harness(() => new Error("User interaction required."));
    expect(await auth.token(false)).toBeNull();
  });

  it("refuses an answer that isn't to its own request", async () => {
    const { auth, storage } = harness(() => `${REDIRECT}#access_token=planted&expires_in=3600&state=someone-elses`);
    expect(await auth.token(true)).toBeNull();
    expect([...storage.entries.keys()]).toEqual([]);
  });

  it("refuses an answer with no token", async () => {
    const { auth } = harness((request) => `${REDIRECT}#error=access_denied&state=${request.get("state")}`);
    expect(await auth.token(true)).toBeNull();
  });

  it("runs one flow for callers that arrive together", async () => {
    const { auth, flows } = harness(grants("token-1"));
    expect(await Promise.all([auth.token(false), auth.token(false)])).toEqual(["token-1", "token-1"]);
    expect(flows).toHaveLength(1);
  });

  it("forgets a refused token, and only that one", async () => {
    const { auth, flows } = harness(grants("token-1"));
    await auth.token(true);
    await auth.forget("another");
    await auth.token(false);
    expect(flows).toHaveLength(1);
    await auth.forget("token-1");
    await auth.token(false);
    expect(flows).toHaveLength(2);
  });

  it("revokes the token at Google and drops it", async () => {
    const { auth, fetchImpl, storage } = harness(grants("token-1"));
    await auth.token(true);
    await auth.revoke();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=token-1");
    expect([...storage.entries.keys()]).toEqual([]);
  });
});
