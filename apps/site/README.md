# Gleam website

This is gleamwallet.app, Gleam's public website. It is made of plain
HTML, CSS and JavaScript pages with no build step, and it is hosted on
Vercel.

Besides the usual home, privacy and terms pages, the website is where the
wallet sends people for Points, invites and security scans. Some of its
pages talk to the wallet directly, such as `attest.html`, which hands a
finished scan to the wallet so the user can sign it.

## Structure

Each page is a folder holding its `index.html` and the CSS and JS only it
uses. `vercel.json` rewrites `/<page>.html` to `/<page>/index.html`, so
the public URLs stay as they are: shipped extensions, shared invite links
and `apps/site-open` link to them. Asset paths in a page are root-absolute
(`/scan/scan.css`) because the page is served from `/<page>.html`.

- **`index.html`, `styles.css`, `main.js`, `umami.js`**: the home page and
  what every page shares.
- **`privacy/`, `terms/`, `security/`**: the policy and security pages.
- **`download/`**: every download link (Chrome Web Store, TestFlight,
  APK), with this device's first. `/android` and `/ios` redirect here.
- **`welcome/`, `goodbye/`, `feedback/`**: the pages people see around
  installing and uninstalling the extension.
- **`points/`, `invite/`, `gleam/`**: Gleam Points, invites and the
  GLEAM vision page.
- **`scan/`, `attest/`, `review-results/`**: the community security scans.
  `attest/` hands a finished scan to the wallet to sign. The scan
  scripts (`scan-lib.js`, `scan-api.js`, `scan-attest.js`) live in
  `scan/` and the other two pages import them.
- **`shared/`**: `pages.js`, `program.css` and `program.js`, used by the
  Points pages and the extension's welcome, goodbye and feedback pages.
- **`announcements.json`**: the notices that appear on the wallet's main
  screen.
- **`latest.json`**: the newest release per shell that doesn't update
  itself (`{ "android": "1.54.0" }`). An older install shows an update
  notice. `scripts/publish-latest.sh` sets it once the build is
  downloadable.
- **`.well-known/security.txt`**: where to report a vulnerability
  (RFC 9116). `well-known.test.ts` fails 30 days before its `Expires`
  date.
- **`img/`, `fonts/`**: images and fonts.

## Location

```text
            website
       ┌───────┴───────┐
       ▼               ▼
     wallet        points-api
 invites, scans  stats, rewards
```
