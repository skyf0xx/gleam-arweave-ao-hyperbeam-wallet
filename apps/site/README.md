# Gleam website

This is gleamwallet.app, Gleam's public website. It is made of plain
HTML, CSS and JavaScript pages with no build step, and it is hosted on
Vercel.

Besides the usual home, privacy and terms pages, the website is where the
wallet sends people for Points, invites and security scans. Some of its
pages talk to the wallet directly, such as `attest.html`, which hands a
finished scan to the wallet so the user can sign it.

## Structure

- **`index.html`, `privacy.html`, `terms.html`, `security.html`**: the
  main pages of the site.
- **`android.html`, `ios.html`**: how to install the Android (APK) and
  iPhone (TestFlight) betas, behind the `/android` and `/ios` redirects.
- **`welcome.html`, `goodbye.html`, `feedback.html`**: the pages people
  see around installing and uninstalling the extension.
- **`points.html`, `invite.html`, `program.*`**: Gleam Points and
  invites.
- **`scan.html`, `attest.html`, `review-results.html`, `scan-lib.js`**:
  the community security scans.
- **`announcements.json`**: the notices that appear on the wallet's main
  screen.
- **`img/`, `fonts/`, `*.css`**: images, fonts and styles.

## Location

```text
            website
       ┌───────┴───────┐
       ▼               ▼
     wallet        points-api
 invites, scans  stats, rewards
```
