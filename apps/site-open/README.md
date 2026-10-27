# Gleam app links

This small site serves the universal links (iOS) and app links (Android)
for the mobile app. Before either OS lets the app handle a link, it
checks the association files this site serves. If the app is not
installed, the page redirects the visitor to the main website instead.

## Structure

- **`.well-known/`**: the files that iOS (`apple-app-site-association`)
  and Android (`assetlinks.json`) read before trusting the app with these
  links.
- **`attest.html`, `attest.js`**: the fallback used when the app does not
  open a scan link, which forwards the visitor to the main site's
  `attest.html`.
- **`verify.mjs`**: runs during each deploy and stops it if a link file
  still contains placeholder values.
- **`vercel.json`**: hosting settings.

## Where it sits

```text
link on a phone → app installed? → Gleam app
                       ↓ no
                 gleamwallet.app
```
