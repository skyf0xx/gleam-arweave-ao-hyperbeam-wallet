# @gleam/provider

The script a shell injects into a dApp's page: it installs
`window.arweaveWallet`, `window.gleam` and, when PermawebOS isn't there,
`window.permawebConnect`. It runs in the page's own world, so the page can
reach anything it exposes. It holds no wallet logic and reaches the
wallet only through a `ProviderTransport` the shell hands it.

ESLint fences it off from WXT, `@webext-core/*`, Capacitor, the shells,
the `chrome`/`browser` globals, `@gleam/core`, `@gleam/runtime`,
`@gleam/app` and `@gleam/ui`. From `@gleam/messaging` it imports only
`page-protocol.ts`. That keeps every privileged decision on the wallet's
side of the transport. Its only dependency is `@gleam/messaging`; a new
one would ship into every page, so think twice before adding it.

## Components

- [`transport.ts`](#transportts) — the seam a shell implements
- [`provider.ts`](#providerts) — `GleamProvider`, the wallet object
- [`install.ts`](#installts) — `installProvider`, which puts it on `window`
- [`window-transport.ts`](#window-transportts) — the extension's transport

### transport.ts

`ProviderTransport`: `request(method, params, signal)` sends one call and
settles with its result or the wallet's error; `onEvent` delivers pushed
events (`connect`, `disconnect`, `walletSwitch`); `requestSiteMode` and
`onSiteMode` ask whether the user chose Gleam over another wallet on this
site; `reportOtherWallet` tells the wallet another one is on the page.
Params and results are JSON-safe, with binary values as `TaggedBinary`.

A transport never puts an origin in a request. The wallet takes it from
whoever delivered the message, such as Chrome's `sender`, so a page can't
claim to be another site.

### provider.ts

`GleamProvider` maps each ArConnect-compatible method to one transport
call. It owns the per-call timeout (longer for methods that can open an
approval), the `settled` guard, `AbortSignal` support, tagged-binary
encoding, and dispatching pushed events on `window`. The transport sits
in a `#private` field, out of the page's reach. `signature` and
`privateHash` are still sent, so the wallet refuses them with a clear
error.

### install.ts

`installProvider({ transport, walletVersion })` defines `window.gleam`
(read-only), claims the `window.arweaveWallet` slot with a router, and
fills an empty `window.permawebConnect` with a shim. When another wallet
(Wander, PermawebOS) is on the page, the router forwards to it unless the
site mode says the user chose Gleam, and reports it through the
transport so the popup can offer to take over. Calls made before other
wallets have had the chance to install wait for that. It announces
`gleamWalletLoaded`, `arweaveWalletLoaded` and `permawebConnectLoaded`.

### window-transport.ts

`createWindowMessageTransport()` is the page half of the extension's
bridge: each call is a `PageRequestEnvelope` posted to the page's own
origin with a fresh random id, and the content script relays it to the
background and posts back the `PageResponseEnvelope`. It reads only
messages whose `event.source` is this window. It lives here, not in the
extension, because it runs in the page's world too and so belongs under
this fence. The content script, which uses extension APIs, stays in
`apps/extension/entrypoints/content`.

## Tests

`testing/fake-transport.ts` records what the provider sends and lets a
test answer it, so `provider.provider.test.ts` and
`install.provider.test.ts` need no `postMessage`.
`window-transport.provider.test.ts` covers the envelopes against jsdom's
`window`.
