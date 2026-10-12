# Gleam

<img src="docs/branding/images/dashboard-tilted-crisp.png" alt="Gleam wallet dashboard" width="360" />

A Chrome browser-extension wallet for Arweave and AO.

## Getting started

```bash
pnpm install
pnpm dev            # WXT dev build with live reload
```

Load `apps/extension/.output/chrome-mv3` unpacked in Chrome to try it.

```bash
pnpm wxt:build                             # production build
pnpm vitest run                            # tests
pnpm tsc -p packages/core --noEmit         # also: packages/messaging, packages/ui, apps/extension
pnpm eslint --max-warnings=0 .
```

## For dApp developers

Gleam implements the ArConnect API, so code written for
`window.arweaveWallet` works with it unchanged. To add your own
**Connect with Gleam** button, use `window.gleam` instead. It has the
same API and always reaches Gleam.

### Why `window.gleam`

`window.arweaveWallet` is shared by every Arweave wallet extension.
When the user has another one installed as well, Gleam leaves
`window.arweaveWallet` with that wallet on each site until the user
picks Gleam there. `window.gleam` is never shared.

Once the user connects through `window.gleam`, Gleam takes over
`window.arweaveWallet` on your site too, so the rest of your code needs
no changes.

### Detect Gleam

Gleam installs before your scripts run in most cases. To be safe, check
again when the wallet announces itself:

```js
function whenGleamReady(callback) {
  if (window.gleam) return callback(window.gleam);
  window.addEventListener("arweaveWalletLoaded", () => {
    if (window.gleam) callback(window.gleam);
  }, { once: true });
}

whenGleamReady(() => {
  document.querySelector("#connect-gleam").hidden = false;
});
```

If `window.gleam` never appears, Gleam isn't installed. Link to the
[Chrome Web Store listing](https://chromewebstore.google.com/detail/gleam/einabcphdmlicabnjllaaallnebfkmki)
instead of showing the button.

### Connect

Call `connect` from the button's click handler. Ask only for the
permissions you need:

```js
document.querySelector("#connect-gleam").addEventListener("click", async () => {
  await window.gleam.connect(
    ["ACCESS_ADDRESS", "ACCESS_PUBLIC_KEY", "SIGN_TRANSACTION"],
    { name: "My dApp", logo: "https://example.com/logo.png" },
  );
  const address = await window.gleam.getActiveAddress();
});
```

Gleam opens an approval window that shows your app's name, its logo and
the permissions you asked for. `connect` rejects if the user declines.
Calling `connect` again with permissions the site already has resolves
without asking. If you ask for more, the user is asked only about the
new ones.

These are the permissions you can request:

| Permission | What the user approves |
| --- | --- |
| `ACCESS_ADDRESS` | See the active address |
| `ACCESS_PUBLIC_KEY` | See the public key |
| `ACCESS_ALL_ADDRESSES` | See every address in the wallet |
| `ACCESS_ARWEAVE_CONFIG` | See the gateway settings |
| `ACCESS_TOKENS` | See token balances |
| `SIGN_TRANSACTION` | Ask to sign transactions |
| `DISPATCH` | Ask to sign and post transactions |
| `SIGNATURE` | Ask to sign data |
| `ENCRYPT`, `DECRYPT` | Ask to encrypt or decrypt data |

Every signing request still opens its own approval window, with a
preview of what is being signed.

### Methods

`window.gleam` supports these ArConnect methods: `connect`,
`disconnect`, `getPermissions`, `getActiveAddress`, `getAllAddresses`,
`getActivePublicKey`, `getWalletNames`, `getArweaveConfig`, `sign`,
`dispatch`, `signature`, `signMessage`, `verifyMessage`, `signDataItem`,
`batchSignDataItem`, `encrypt`, `decrypt`, `privateHash`, `addToken`,
`isTokenAdded`, `tokenBalance` and `userTokens`. Use `signDataItem` for
AO messages, for example through aoconnect's `createDataItemSigner`.

`walletName` is `"Gleam"`. `sign`, `signature`, `signMessage`,
`signDataItem`, `batchSignDataItem`, `encrypt`, `decrypt` and
`privateHash` also accept `options.signal`, an `AbortSignal`. Aborting
rejects the call on your side only. An approval window that is already
open stays open.

### Events

Gleam dispatches these events on `window`:

- `connect`: after `connect()` succeeds. `detail.activeAddress` is the
  connected address.
- `disconnect`: when your site's access ends, whether you called
  `disconnect()` or the user revoked it in Gleam.
- `walletSwitch`: when the user switches account. `detail.address` is
  the new address.

```js
window.addEventListener("walletSwitch", (event) => {
  showAccount(event.detail.address);
});
```


## License

[MIT](LICENSE)
