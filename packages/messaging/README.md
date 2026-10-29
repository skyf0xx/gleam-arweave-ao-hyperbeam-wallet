# @gleam/messaging

This package is the typed API contract between the wallet's separate
JavaScript contexts: the screens, the background, the content script,
the dApp's page, the keyring and the Gleam website. It plays the role a
shared tRPC router type or an OpenAPI schema plays between a client and
a server.

It contains only types and constants. Keeping the contract in its own
package means the screens get typed calls to the background without
importing any of the background's code.

## Structure

- **`protocol.ts`**: every request that the wallet's screens and the
  content script can send to the background, along with its reply.
- **`page-protocol.ts`**: the messages passed between a dApp's page and
  the content script, and the list of methods a page is able to call.
- **`keyring-protocol.ts`**: the messages between the background and the
  keyring, which holds unlocked keys.
- **`site-protocol.ts`**: the messages the Gleam website sends to the
  wallet.
- **`caller.ts`**: a description of who sent each message.
- **`permissions.ts`**: the privilege levels that decide which callers
  may use which methods.

## Location

```text
  dApp page
      │ page-protocol.ts
      ▼
content script       @gleam/app
      └────────┬─────────┘
               │ protocol.ts
               ▼
           background
               │ keyring-protocol.ts
               ▼
            keyring
```
