# @gleam/keystone

This package lets Gleam work with a Keystone hardware wallet. Keystone
has no cable or Bluetooth connection, so QR codes are the transport: the
wallet shows a code for the device to scan, and the device shows one
back. This package encodes and decodes those messages using the UR
format.

Both the Chrome extension and the mobile app use it. Each app hands its
views to `@gleam/app`, which lets the screens show a Keystone step
without needing to know how QR codes work.

## Structure

- **`KeystoneConnectView.tsx`**: the steps for connecting a Keystone and
  reading its account.
- **`KeystonePanel.tsx`**: the panel in the approval window that sends a
  request to the device and reads back its signature.
- **`sign-request.ts`**: converts a transaction into a request the device
  can sign.
- **`decode-account.ts`**: reads the account details the device shares.
- **`AnimatedQr.tsx`, `QrScanner.tsx`, `ur-assembler.ts`**: displaying
  and scanning QR codes. Large data is split across several codes that
  play one after another, like a short animation.

## Location

```text
        @gleam/app      the screens
            │
            ▼
     @gleam/keystone    QR in and out
            ▲
            │ QR codes
            ▼
     Keystone device
```
