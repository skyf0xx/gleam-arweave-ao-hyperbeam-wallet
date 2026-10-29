# @gleam/runtime

This package is the wallet's backend, where every request ends up,
whether it comes from the wallet's own screens or from a dApp. It is
structured like a small server: a dispatcher acts as authorization
middleware, checking who is calling and whether they may use the method,
and then routes the request to a handler that does the work with
`@gleam/core`.

The Chrome extension and the mobile app each inject a `Platform` with the
host services the runtime needs, such as storage, timers and windows, so
the runtime never has to know which one it is running in.

## Structure

- **`create-runtime.ts`**: builds the runtime from a `Platform`, routes
  each request to the right handler, and runs background jobs such as
  locking the wallet after a period of inactivity.
- **`platform.ts`**: the list of host services an app must provide.
- **`dispatch/`**: the access-control table that says which callers may
  use each method, along with the entry point for messages from the Gleam
  website.
- **`handlers/`**: one file per feature. For example,
  `wallet-lifecycle.ts` creates, unlocks and switches wallets, and
  `key-session.ts` looks after the unlocked key. Others include
  `transfer.ts`, `approval.ts` and `points.ts`.

## Location

```text
 @gleam/app      dApp page
     └───────┬───────┘
             ▼
         dispatcher     checks the caller
             │
             ▼
          handler       does the work
             │
             ▼
        @gleam/core
```
