# Gleam

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/badge)](https://scorecard.dev/viewer/?uri=github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet)

<img src="docs/branding/images/dashboard-tilted-crisp.png" alt="Gleam wallet dashboard" width="360" />

A Chrome browser-extension wallet for Arweave and AO.

## For dApp developers

### Works with `window.arweaveWallet`

Gleam implements the [ArConnect API](https://docs.arconnect.io/api/intro).

Code written for
`window.arweaveWallet` **works with Gleam unchanged.**

### Add a Connect with Gleam button

use `window.gleam` instead of `window.arweaveWallet`

If `window.gleam` is `undefined` the wallet isn't installed and you can link to the
[Chrome Web Store](https://chromewebstore.google.com/detail/gleam/einabcphdmlicabnjllaaallnebfkmki)
instead.

<details>
<summary>Example</summary>

```js
const button = document.querySelector("#connect-gleam");

function showButton() {
  if (window.gleam) button.hidden = false;
}
showButton();
window.addEventListener("gleamWalletLoaded", showButton);

button.addEventListener("click", async () => {
  await window.gleam.connect(["ACCESS_ADDRESS", "SIGN_TRANSACTION"], {
    name: "My dApp",
    logo: "https://example.com/logo.png",
  });
  const address = await window.gleam.getActiveAddress();
});
```

</details>

## Development

<details>
<summary>Build and test</summary>

```bash
pnpm install
pnpm dev            # dev build with live reload
pnpm wxt:build      # production build
pnpm vitest run     # tests
```

Load `apps/extension/.output/chrome-mv3` unpacked in Chrome to try it.

</details>

## Build from source

Releases are reproducible: the same commit gives the same zip, byte for byte.
Build with Node 22 and pnpm 11.25.0 (the `packageManager` in `package.json`):

```bash
git clone --branch v1.27.0 https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet.git
cd gleam-arweave-ao-hyperbeam-wallet
pnpm install --frozen-lockfile
pnpm --filter @gleam/extension exec wxt zip
```

The zip lands in `apps/extension/.output/`, next to the unpacked build in
`chrome-mv3/`.

## Verify a release

Each [GitHub Release](https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases)
has the zip and a `release-manifest.json` with its SHA-256.

```bash
gh attestation verify gleamextension-1.27.0-chrome.zip --repo skyf0xx/gleam-arweave-ao-hyperbeam-wallet
sha256sum gleamextension-1.27.0-chrome.zip   # must equal zipSha256 in release-manifest.json
```

`scripts/verify-release.sh` checks the zip against the manifest and rebuilds
the tag from source to confirm it gets the same hash:

```bash
scripts/verify-release.sh v1.27.0
```

To also compare the extension installed in Chrome, pass its folder
(`Extensions/<id>/<version>_0`). The script ignores Chrome's `_metadata/`
folder and the `key` and `update_url` fields the Chrome Web Store adds to
`manifest.json`.

```bash
scripts/verify-release.sh v1.27.0 --installed "$HOME/Library/Application Support/Google/Chrome/Default/Extensions/einabcphdmlicabnjllaaallnebfkmki/1.27.0_0"
```

Chrome keeps installed extensions in `Default/Extensions/` (or another
profile's folder) under its user data folder:

- macOS: `~/Library/Application Support/Google/Chrome/`
- Windows: `%LOCALAPPDATA%\Google\Chrome\User Data\`
- Linux: `~/.config/google-chrome/`

## License

[MIT](LICENSE)
