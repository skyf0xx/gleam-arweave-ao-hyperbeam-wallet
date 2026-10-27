# @gleam/provider

This package is the script that runs inside a dApp's web page. It adds
`window.arweaveWallet` and `window.gleam`, the API that dApps call when
they want to talk to the wallet.

It is a thin RPC client stub: each method serializes its arguments and
sends them to the wallet over a transport, holding no keys and making no
decisions. Because the page can see everything this script does, all of
the real work happens on the wallet's side.

## Structure

- **`provider.ts`**: `GleamProvider`, the object dApps call, which turns
  each ArConnect-compatible method into a single request to the wallet.
- **`install.ts`**: places the provider on `window`. If another Arweave
  wallet is already on the page, it passes calls to that wallet unless
  the user has chosen Gleam for the site.
- **`transport.ts`**: the interface for the line that carries requests
  to the wallet, which each app supplies in its own way.
- **`window-transport.ts`**: the extension's line, which runs through the
  content script.
- **`native-transport.ts`**: the mobile app's line, which runs through
  the built-in dApp browser.

## Where it sits

```text
dApp → window.arweaveWallet (this package) → transport → wallet
```
