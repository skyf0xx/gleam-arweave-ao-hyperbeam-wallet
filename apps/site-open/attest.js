// The app didn't take this link, so send it to the main site's page. The
// attestation rides in the fragment, which only a script redirect keeps.
location.replace("https://gleamwallet.app/attest.html" + location.hash);
