import { PROVIDER_EVENT, PROVIDER_SURFACE_METHODS, type ProviderSurfaceMethod } from "@gleam/messaging/src/page-protocol.ts";
import { GleamProvider, WALLET_NAME } from "./provider";
import type { ProviderTransport } from "./transport";

type WalletLike = Record<PropertyKey, unknown>;
type WalletWindow = { arweaveWallet?: unknown; permawebConnect?: unknown };

/**
 * How long a call to the other wallet waits to learn whether the site uses
 * Gleam instead. The extension's content script answers "not Gleam"
 * straight away when it can't reach the background, so this only covers a
 * reply that never comes, and is long enough for a service worker's cold
 * start.
 */
const SITE_MODE_WAIT_MS = 5_000;
/**
 * How long after DOMContentLoaded another wallet's injected script may
 * still run. Extensions inject a `<script src>` with `async = false`,
 * which can run after DOMContentLoaded on a short page. Until then, a call
 * made with no other wallet in sight waits instead of going to Gleam.
 */
const OTHER_WALLET_SETTLE_MS = 150;
const ROUTER_MARK = Symbol.for("gleam.arweaveWalletRouter");

function isWalletLike(value: unknown): value is WalletLike {
  return value !== null && (typeof value === "object" || typeof value === "function");
}

function isRouter(value: unknown): boolean {
  try {
    return isWalletLike(value) && value[ROUTER_MARK] === true;
  } catch {
    return false;
  }
}

function claimSlot(router: unknown, onAssign: (value: unknown) => void): boolean {
  try {
    Object.defineProperty(window, "arweaveWallet", {
      get: () => router,
      // A wallet that installs by plain assignment is captured rather than
      // dropped, and its strict-mode script doesn't throw.
      set: onAssign,
      configurable: true,
      enumerable: true,
    });
    return true;
  } catch {
    // Another script made the slot non-configurable first. Nothing can
    // replace it, and throwing here would only break the page.
    return false;
  }
}

/**
 * What PermawebOS's dApp SDK checks before it treats `window.permawebConnect`
 * as a wallet (`walletVersion`, `events.on`/`off` and every one of these
 * as a function). Its connect button then calls only `connect`,
 * `disconnect` and the reads behind `getSnapshot`.
 */
const PERMAWEB_CONNECT_METHODS = [
  "connect",
  "disconnect",
  "getPermissions",
  "getActiveAddress",
  "getActivePublicKey",
  "getAllAddresses",
  "getWalletNames",
  "getArweaveConfig",
  "signMessage",
  "verifyMessage",
  "signature",
  "privateHash",
  "encrypt",
  "decrypt",
  "signDataItem",
  "batchSignDataItem",
  "sign",
  "dispatch",
] as const satisfies readonly (ProviderSurfaceMethod & keyof GleamProvider)[];

type PermawebListener = (payload: unknown) => void;

/**
 * The events the SDK's `subscribe` listens for on `permawebConnect.events`,
 * each fed from the window event Gleam already posts. Gleam has no
 * permissions-change event, so `permissions` never fires; the SDK reads
 * permissions again through `getPermissions`.
 */
const PERMAWEB_EVENT_SOURCES: Record<string, ReadonlyArray<[string, (detail: unknown) => unknown]>> = {
  connect: [[PROVIDER_EVENT.CONNECT, () => null]],
  disconnect: [[PROVIDER_EVENT.DISCONNECT, () => null]],
  activeAddress: [
    [PROVIDER_EVENT.CONNECT, (detail) => (detail as { activeAddress?: unknown } | null)?.activeAddress],
    [PROVIDER_EVENT.WALLET_SWITCH, (detail) => (detail as { address?: unknown } | null)?.address],
  ],
};

type PermawebMethod = (typeof PERMAWEB_CONNECT_METHODS)[number];

/**
 * A `window.permawebConnect` in PermawebOS's shape. Every call goes through
 * `callGleam`, which applies the site's wallet choice first.
 */
function permawebConnectShim(
  callGleam: (method: PermawebMethod, args: unknown[]) => Promise<unknown>,
  walletVersion: string,
): WalletLike {
  const bridges = new Map<PermawebListener, Array<[string, EventListener]>>();
  const events = {
    on(name: unknown, listener: unknown): void {
      if (typeof name !== "string" || typeof listener !== "function") return;
      const sources = PERMAWEB_EVENT_SOURCES[name] ?? [];
      const added = sources.map(([windowEvent, read]): [string, EventListener] => {
        const bridge: EventListener = (event) => {
          const payload = read((event as CustomEvent).detail);
          if (name !== "activeAddress" || typeof payload === "string") (listener as PermawebListener)(payload);
        };
        window.addEventListener(windowEvent, bridge);
        return [windowEvent, bridge];
      });
      bridges.set(listener as PermawebListener, [...(bridges.get(listener as PermawebListener) ?? []), ...added]);
    },
    off(name: unknown, listener: unknown): void {
      if (typeof name !== "string" || typeof listener !== "function") return;
      const sourceEvents = (PERMAWEB_EVENT_SOURCES[name] ?? []).map(([windowEvent]) => windowEvent);
      const kept = (bridges.get(listener as PermawebListener) ?? []).filter(([windowEvent, bridge]) => {
        if (!sourceEvents.includes(windowEvent)) return true;
        window.removeEventListener(windowEvent, bridge);
        return false;
      });
      bridges.set(listener as PermawebListener, kept);
    },
  };
  const shim: WalletLike = { walletName: WALLET_NAME, walletVersion, events };
  for (const method of PERMAWEB_CONNECT_METHODS) {
    shim[method] = (...args: unknown[]) => callGleam(method, args);
  }
  return Object.freeze(shim);
}

export interface InstallProviderOptions {
  transport: ProviderTransport;
  /** The wallet's release version, which dApps compare against Wander's. */
  walletVersion: string;
}

/**
 * Installs Gleam in the page: `window.arweaveWallet`, `window.gleam` and,
 * when it is free, `window.permawebConnect`.
 *
 * 1. Owns the `window.arweaveWallet` slot but doesn't always answer
 *    through it. When another wallet extension (Wander, PermawebOS) is
 *    on the page, the slot holds a router that forwards each call to
 *    that wallet unless the user chose Gleam for the site (the site mode,
 *    asked for through the transport only once another wallet shows up).
 *    The router reports the other wallet through the transport, so
 *    Gleam's popup can offer to take over on sites that actually use a
 *    wallet. Extension content scripts run in no guaranteed order, so the
 *    router captures a wallet that got there first, one that assigns the
 *    slot later, and one that redefines it and announces
 *    `arweaveWalletLoaded`. PermawebOS skips installing when the slot is
 *    taken, so it is also looked up at `window.permawebConnect`, and
 *    Gleam announces it. Since another wallet may still be on its way, a
 *    call made before `OTHER_WALLET_SETTLE_MS` past DOMContentLoaded
 *    waits, and so does Gleam's own `arweaveWalletLoaded`.
 * 2. Also exposes Gleam itself at `window.gleam`, which never forwards,
 *    so a dApp can offer its own "Connect with Gleam" button (README.md
 *    § For dApp developers). It is announced at once with
 *    `gleamWalletLoaded`.
 * 3. Answers a dApp's PermawebOS button when PermawebOS isn't installed:
 *    an empty `window.permawebConnect` slot gets a shim that calls Gleam
 *    (`permawebConnectShim`). PermawebOS's injected script redefines the
 *    slot unconditionally and announces `permawebConnectLoaded`, so the
 *    shim is configurable and steps aside, like the router yielding to
 *    Wander.
 *
 * Returns a teardown that stops listening and reclaiming the slot, for
 * tests.
 */
export function installProvider({ transport, walletVersion }: InstallProviderOptions): () => void {
  const providerListener = new AbortController();
  const gleamProvider = new GleamProvider(transport, walletVersion, providerListener.signal);
  const gleam = gleamProvider as unknown as WalletLike;
  const walletWindow = window as unknown as WalletWindow;
  try {
    // Read-only, so a page script or another wallet can't swap it out by
    // assignment.
    Object.defineProperty(window, "gleam", { value: gleamProvider, configurable: true, enumerable: true, writable: false });
  } catch {
    // Something made `window.gleam` non-configurable first; leave it alone.
  }
  let permawebShim: WalletLike | null = null;
  if (!("permawebConnect" in window)) {
    // `callThroughShim` is defined below, and runs only once a call arrives.
    const shim = permawebConnectShim((method, args) => callThroughShim(method, args), walletVersion);
    try {
      // Configurable, so PermawebOS's own `defineProperty` replaces it.
      Object.defineProperty(window, "permawebConnect", { value: shim, configurable: true, enumerable: true, writable: false });
      permawebShim = shim;
    } catch {
      // Taken between the check and the define; leave it to its owner.
    }
  }
  const shimHoldsPermaweb = (): boolean => permawebShim !== null && walletWindow.permawebConnect === permawebShim;
  let captured: WalletLike | null = null;
  // Null until the content script says whether this site holds a grant.
  let useGleam: boolean | null = null;
  // False until every wallet extension's injected script has had the chance
  // to run. Before then, no other wallet in sight doesn't mean there is none.
  let settled = false;
  let waiters: Array<() => void> = [];
  // The wallet the last `arweaveWalletLoaded` was for, so each wallet that
  // ends up behind the slot is announced once. Undefined until the first.
  let announced: WalletLike | null | undefined;
  let dispatching = false;
  let reportedPresence = false;
  let reportedUse = false;
  // The last permission list reported, joined, so each change is sent once.
  let reportedPermissions = "";
  let modeTimeout: ReturnType<typeof setTimeout> | undefined;
  let settleTimeout: ReturnType<typeof setTimeout> | undefined;

  const isSurfaceMethod = (prop: PropertyKey): boolean =>
    typeof prop === "string" && (PROVIDER_SURFACE_METHODS as readonly string[]).includes(prop);

  const other = (): WalletLike | null => {
    if (captured) return captured;
    const permaweb = walletWindow.permawebConnect;
    return isWalletLike(permaweb) && !isRouter(permaweb) && permaweb !== permawebShim ? permaweb : null;
  };

  /** Whether a call made now reaches the wallet the site will keep using. */
  const decided = (): boolean => useGleam === true || (other() ? useGleam !== null : settled);

  const wake = (): void => {
    if (!decided()) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

  const nameOf = (wallet: WalletLike): string =>
    wallet === walletWindow.permawebConnect ? "PermawebOS" : typeof wallet.walletName === "string" ? wallet.walletName : "";

  const report = (used: boolean): void => {
    const wallet = other();
    if (!wallet || (used ? reportedUse : reportedPresence)) return;
    reportedPresence = true;
    if (used) reportedUse = true;
    transport.reportOtherWallet({ walletName: nameOf(wallet), used });
  };

  const reportPermissions = (value: unknown): void => {
    const wallet = other();
    if (!wallet || !Array.isArray(value)) return;
    const permissions = value.filter((permission): permission is string => typeof permission === "string");
    const key = permissions.join(",");
    if (permissions.length === 0 || key === reportedPermissions) return;
    reportedPermissions = key;
    transport.reportOtherWallet({ walletName: nameOf(wallet), used: true, permissions });
  };

  const setMode = (value: boolean): void => {
    useGleam = value;
    clearTimeout(modeTimeout);
    wake();
  };

  const requestMode = (): void => {
    if (modeTimeout !== undefined || useGleam !== null) return;
    modeTimeout = setTimeout(() => {
      if (useGleam === null) setMode(false);
    }, SITE_MODE_WAIT_MS);
    transport.requestSiteMode();
  };

  const noteOther = (): void => {
    if (!other()) return;
    report(false);
    requestMode();
  };

  const whenDecided = (): Promise<void> => {
    noteOther();
    return new Promise((resolve) => {
      waiters.push(resolve);
      wake();
    });
  };

  const target = (): WalletLike => (useGleam === true ? gleam : (other() ?? gleam));

  // The shim answers only for the wallet the site uses, the same choice the
  // router makes: a site the user left on Wander gets no Gleam prompt from
  // its PermawebOS button.
  const callThroughShim = async (method: PermawebMethod, args: unknown[]): Promise<unknown> => {
    if (!decided()) await whenDecided();
    if (target() !== gleam) {
      throw new Error("This site uses another wallet. Choose Gleam for it in the Gleam popup to connect with Gleam.");
    }
    return (gleamProvider[method] as (...rest: unknown[]) => unknown).apply(gleamProvider, args);
  };

  const invoke = (prop: PropertyKey, args: unknown[]): unknown => {
    const wallet = target();
    const method = wallet[prop];
    if (typeof method !== "function") {
      throw new TypeError(`window.arweaveWallet.${String(prop)} is not a function.`);
    }
    // Only a wallet API call counts as the site using the wallet. Any script
    // can call `toString` or poke the other wallet's own helpers, and the
    // popup would then offer Gleam on pages that never touch a wallet.
    const forwarded = wallet !== gleam && isSurfaceMethod(prop);
    if (forwarded) report(true);
    if (forwarded && prop === "connect") reportPermissions(args[0]);
    const result = (method as (...rest: unknown[]) => unknown).apply(wallet, args);
    if (forwarded && prop === "getPermissions") {
      Promise.resolve(result).then(reportPermissions, () => undefined);
    }
    return result;
  };

  // One function per name, so a dApp that cached `arweaveWallet.connect`
  // still reaches whichever wallet the site uses at call time.
  const methods = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const methodFor = (prop: PropertyKey) => {
    let method = methods.get(prop);
    if (!method) {
      method = (...args: unknown[]) => {
        if (decided()) return invoke(prop, args);
        return whenDecided().then(() => invoke(prop, args));
      };
      methods.set(prop, method);
    }
    return method;
  };

  // Until the site's wallet is known, a feature check such as
  // `"signMessage" in arweaveWallet` sees every method either wallet has,
  // and the method waits to call the right one. A sync value such as
  // `walletName` can't wait, so it comes from the likelier wallet: the
  // other one when it is on the page, since a site uses Gleam only once
  // the user picks it there.
  const eitherHasMethod = (prop: PropertyKey): boolean => isSurfaceMethod(prop) || typeof other()?.[prop] === "function";

  const router = new Proxy(Object.create(null) as WalletLike, {
    get(_shell, prop) {
      if (prop === ROUTER_MARK) return true;
      const value = Reflect.get(target(), prop);
      if (typeof value === "function" || (value === undefined && !decided() && eitherHasMethod(prop))) {
        return methodFor(prop);
      }
      return value;
    },
    has(_shell, prop) {
      return prop in target() || (!decided() && eitherHasMethod(prop));
    },
    set(_shell, prop, value) {
      return Reflect.set(target(), prop, value);
    },
    ownKeys() {
      return Reflect.ownKeys(target());
    },
    // The shell has no own properties, so each one is reported as
    // configurable, which a Proxy may do for a property its target lacks.
    getOwnPropertyDescriptor(_shell, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target(), prop);
      if (!descriptor) return undefined;
      const value = typeof descriptor.value === "function" ? methodFor(prop) : descriptor.value;
      return "value" in descriptor ? { ...descriptor, value, configurable: true } : { ...descriptor, configurable: true };
    },
  });

  const announce = (): void => {
    const wallet = other();
    if (announced !== undefined && announced === wallet) return;
    announced = wallet;
    dispatching = true;
    try {
      window.dispatchEvent(new CustomEvent("arweaveWalletLoaded"));
    } finally {
      dispatching = false;
    }
  };

  const capture = (value: unknown): void => {
    if (!isWalletLike(value) || isRouter(value) || value === gleam) return;
    captured = value;
    noteOther();
    wake();
  };

  capture(walletWindow.arweaveWallet);
  if (!claimSlot(router, capture)) return () => undefined;

  const reclaim = (): void => {
    if (dispatching) return;
    const current = walletWindow.arweaveWallet;
    if (current !== router) {
      capture(current);
      claimSlot(router, capture);
    }
    // The other wallet's own event has just told the page. This listener
    // was added before any page script's, so they already read the router.
    if (other()) announced = other();
  };
  // PermawebOS skips a taken slot and announces `arweaveWalletLoaded` only
  // while it holds the slot itself, so Gleam announces it instead.
  const onPermawebLoaded = (): void => {
    // Gleam's own announcement of the shim, not PermawebOS arriving.
    if (shimHoldsPermaweb()) return;
    noteOther();
    if (settled) announce();
  };
  const settle = (): void => {
    settled = true;
    noteOther();
    wake();
    announce();
    // Like `arweaveWalletLoaded`, held until PermawebOS has had its chance
    // to take the slot, so a dApp hears about the shim only in its absence.
    if (shimHoldsPermaweb()) window.dispatchEvent(new CustomEvent("permawebConnectLoaded"));
  };
  const scheduleSettle = (): void => {
    settleTimeout = setTimeout(settle, OTHER_WALLET_SETTLE_MS);
  };
  const stopSiteMode = transport.onSiteMode(setMode);
  window.addEventListener("arweaveWalletLoaded", reclaim);
  window.addEventListener("permawebConnectLoaded", onPermawebLoaded);
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", scheduleSettle, { once: true });
  } else {
    scheduleSettle();
  }
  window.dispatchEvent(new CustomEvent("gleamWalletLoaded"));
  // A wallet that installed first is already behind the slot, so the page
  // can hear about it now. Otherwise the shared event waits for the settle,
  // so a dApp's handler doesn't take Gleam for the only wallet.
  if (other()) announce();
  return () => {
    providerListener.abort();
    clearTimeout(modeTimeout);
    clearTimeout(settleTimeout);
    stopSiteMode();
    window.removeEventListener("arweaveWalletLoaded", reclaim);
    window.removeEventListener("permawebConnectLoaded", onPermawebLoaded);
    window.removeEventListener("DOMContentLoaded", scheduleSettle);
  };
}
