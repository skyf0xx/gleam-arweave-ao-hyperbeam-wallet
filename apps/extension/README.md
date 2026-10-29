# @gleam/extension

This is the Chrome extension, built with WXT. It is the composition root
for Chrome: it implements the packages' interfaces with `chrome.*` APIs,
wires those adapters into the packages, and builds the result as an
installable extension.

The wallet's logic and screens live in the packages, so this app holds
only what is specific to Chrome: the manifest, the background service
worker, the script that runs in web pages, and the windows that display
the wallet's screens.

## Structure

- **`wxt.config.ts`**: the extension's manifest and build settings.
- **`entrypoints/`**: each part of the extension that Chrome runs:
  - `background`: the service worker that runs `@gleam/runtime`.
  - `content`: the script in each web page that relays the dApp's
    requests to the background.
  - `provider`: builds the page script from `@gleam/provider`.
  - `popup` and `sidepanel`: the main wallet interface.
  - `approval`: the window that opens whenever a dApp asks for something.
  - `passkey`: the window used for passkey unlock.
  - `connect`: the page for connecting a hardware wallet.
  - `keyring`: a hidden page that keeps unlocked keys in memory.
- **`src/adapters/`**: Chrome's versions of the host services the
  packages rely on, such as storage, windows and messaging.
- **`src/hardware/`**: the connections to Ledger and Keystone devices.

## Location

```text
  @gleam/app         dApp page
       │                 │
       │          content script
       │                 │
       └────────┬────────┘
                ▼
           background        checks the site
                │
                ▼
             handler         runs the request
                │
                ▼
           @gleam/core
```

1. The dApp calls `window.arweaveWallet`, which passes the request to
   the content script.
2. The content script forwards it to the background. Chrome itself tells
   the background which site sent it, so a page cannot pretend to be a
   different site.
3. The background checks that the site is allowed to make the call, and
   opens the approval window if the user needs to decide.
4. A handler carries out the request with `@gleam/core`, and the result
   travels back the same way.

The popup, side panel and approval window are part of the extension
itself, so they talk to the background directly.
