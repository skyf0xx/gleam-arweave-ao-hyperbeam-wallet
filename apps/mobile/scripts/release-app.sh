#!/usr/bin/env bash
# Build, sign and upload the Gleam app from a release tag, on this machine.
#
#   apps/mobile/scripts/release-app.sh v1.31.0 ios            --kdbx <path>   TestFlight
#   apps/mobile/scripts/release-app.sh v1.31.0 ios-ipa        --kdbx <path>   signed IPA only
#   apps/mobile/scripts/release-app.sh v1.31.0 android        --kdbx <path>   Play internal track
#   apps/mobile/scripts/release-app.sh v1.31.0 android-bundle --kdbx <path>   signed AAB only
#
# Add --allow-unverified-bundle to skip the comparison with the manifest's
# mobileBundleSha256 (a tag whose manifest has none). It asks for a typed
# "yes"; the environment variable alone is ignored.
#
# The checkout must be clean, at the tag, and the tag must be signed by a key
# in origin/master's .github/allowed_signers and sit on origin/master; all of
# that is checked before any Ruby (the Gemfile) runs. Ruby 3 or newer and,
# for Android, JDK 21 or newer are checked right after the tool checks. The
# web bundle is built
# and checked against the tag's release-manifest.json first, with no
# credentials in the environment. Only then is the KeePassXC database
# unlocked (password asked once; GLEAM_CWS_KDBX_YUBIKEY=<slot[:serial]> if it
# needs a YubiKey) and the credentials exported into a private temp dir that
# is deleted on exit. CI never sees them.
#
# Entries in the database, each name overridable by the variable shown:
#   App Store Connect API    GLEAM_ASC_ENTRY       the entry's single AuthKey_*.p8 attachment
#                                                 (GLEAM_ASC_KEY_ATTACHMENT names it explicitly),
#                                                 attributes KEY_ID and ISSUER_ID
#   Play service account    GLEAM_PLAY_ENTRY      attachment play-service-account.json
#                                                 (GLEAM_PLAY_KEY_ATTACHMENT)
#   gleam-upload-keystore   GLEAM_KEYSTORE_ENTRY  attachment upload-keystore.jks
#                                                 (GLEAM_KEYSTORE_ATTACHMENT), password = store
#                                                 password, attributes KeyAlias and KeyPassword
# ASC_KEY_ID and ASC_ISSUER_ID in the environment replace the KEY_ID and
# ISSUER_ID attributes. GLEAM_APPLE_TEAM_ID overrides the Apple team id.
set -uo pipefail

# Only the --allow-unverified-bundle flag may turn the bypass on.
unset GLEAM_ALLOW_UNVERIFIED_BUNDLE

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mobile="$(cd "$here/.." && pwd)"
repo_root="$(cd "$mobile/../.." && pwd)"

usage() {
  echo "usage: $0 v<major>.<minor>.<patch> ios|ios-ipa|android|android-bundle --kdbx <path-to-keepassxc-db> [--allow-unverified-bundle]" >&2
  exit 2
}

tag=""
target=""
kdbx="${GLEAM_CWS_KDBX:-}"
allow_unverified=0
while [ $# -gt 0 ]; do
  case "$1" in
    --kdbx)
      [ $# -ge 2 ] || usage
      kdbx="$2"
      shift 2
      ;;
    --allow-unverified-bundle)
      allow_unverified=1
      shift
      ;;
    -h | --help | -*) usage ;;
    *)
      if [ -z "$tag" ]; then tag="$1"; elif [ -z "$target" ]; then target="$1"; else usage; fi
      shift
      ;;
  esac
done
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
case "$target" in
  ios) platform=ios; lane=beta ;;
  ios-ipa) platform=ios; lane=signed_ipa ;;
  android) platform=android; lane=internal ;;
  android-bundle) platform=android; lane=signed_bundle ;;
  *) usage ;;
esac
[ -n "$kdbx" ] || { echo "no KeePassXC database: pass --kdbx or set GLEAM_CWS_KDBX" >&2; exit 2; }
[ -f "$kdbx" ] || { echo "KeePassXC database not found: $kdbx" >&2; exit 2; }
command -v keepassxc-cli > /dev/null || { echo "keepassxc-cli not found; brew install --cask keepassxc" >&2; exit 2; }
command -v bundle > /dev/null || { echo "bundler not found; see apps/mobile/fastlane/README.md" >&2; exit 2; }

# Fastlane and Gradle need newer tools than macOS ships; fail now, not after
# the credentials are unlocked.
# `bundle` runs under its own shebang interpreter, which need not be the
# first `ruby` on PATH, so check that one. Bundler 2.6.9, prism and irb need 3.1.
bundle_bin="$(command -v bundle)"
bundle_ruby="$(head -n 1 "$bundle_bin" | sed -n 's/^#![[:space:]]*//p' | awk '{ if ($1 ~ /\/env$/) print $2; else print $1 }')"
case "$bundle_ruby" in
  */*) ;;
  ruby*) bundle_ruby="$(command -v "$bundle_ruby" || true)" ;;
  *) bundle_ruby="" ;;
esac
if [ -z "$bundle_ruby" ] || ! "$bundle_ruby" -e 'v = RUBY_VERSION.split(".").map(&:to_i); exit((v[0] > 3 || (v[0] == 3 && v[1] >= 1)) ? 0 : 1)' > /dev/null 2>&1; then
  echo "Ruby 3.1 or newer is required; $bundle_bin runs ${bundle_ruby:-an unknown interpreter} (macOS's /usr/bin/ruby is too old). Put \$(brew --prefix ruby)/bin first on PATH" >&2
  exit 2
fi
if [ "$platform" = android ]; then
  java_bin=java
  [ -z "${JAVA_HOME:-}" ] || java_bin="$JAVA_HOME/bin/java"
  java_major="$("$java_bin" -version 2>&1 | sed -n '/version "/{s/^[^"]*"\([0-9][0-9]*\).*/\1/p;q;}')"
  [ "${java_major:-0}" -ge 21 ] 2> /dev/null \
    || { echo "JDK 21 or newer is required for the Android build (found: ${java_major:-none}); point JAVA_HOME at a JDK 21" >&2; exit 2; }
fi
# A second guard behind skip_docs in the Fastfile.
export FASTLANE_SKIP_DOCS=1

# A dirty or wrong checkout must be refused before anything executes from it
# (the Gemfile is Ruby), so this comes before the signature check.
[ "$(git -C "$repo_root" cat-file -t "refs/tags/$tag" 2> /dev/null)" = "tag" ] \
  || { echo "$tag is not an annotated tag" >&2; exit 1; }
[ "$(git -C "$repo_root" rev-parse HEAD)" = "$(git -C "$repo_root" rev-parse "$tag^{commit}")" ] \
  || { echo "checkout is not at $tag; check it out and re-run" >&2; exit 1; }
[ -z "$(git -C "$repo_root" status --porcelain)" ] \
  || { echo "working tree is not clean; refusing to build" >&2; exit 1; }
# The signer list comes from origin/master, not from the checkout: a tagged
# commit could otherwise carry its own allowed_signers and vouch for itself.
git -C "$repo_root" fetch --no-tags origin +refs/heads/master:refs/remotes/origin/master \
  || { echo "could not fetch origin/master; refusing to build" >&2; exit 1; }
git -C "$repo_root" merge-base --is-ancestor "$tag^{commit}" refs/remotes/origin/master \
  || { echo "$tag is not on origin/master; refusing to build" >&2; exit 1; }
signers="$(mktemp)"
work=""
cleanup() {
  rm -rf ${work:+"$work"} "$signers"
  # A Gradle daemon would keep the keystore passwords in its environment.
  [ "$platform" != android ] || [ -z "$work" ] || (cd "$mobile/android" && ./gradlew --stop > /dev/null 2>&1)
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
git -C "$repo_root" show refs/remotes/origin/master:.github/allowed_signers > "$signers" \
  || { echo "could not read .github/allowed_signers from origin/master" >&2; exit 1; }
git -C "$repo_root" -c "gpg.ssh.allowedSignersFile=$signers" tag -v "$tag" \
  || { echo "$tag is not signed by a key in origin/master's .github/allowed_signers; refusing to build" >&2; exit 1; }
# The signature covers the tag's own name, so a local ref pointed at another
# validly signed tag object (an older release) is caught here.
[ "$(git -C "$repo_root" cat-file tag "$tag" | sed -n '/^$/q;s/^tag //p')" = "$tag" ] \
  || { echo "the signed tag object behind $tag has a different name; refusing to build" >&2; exit 1; }

# Gradle reads these ignored, per-machine files and they can inject build
# logic, so only the SDK path is accepted.
if [ -f "$mobile/android/local.properties" ] \
  && grep -Ev '^[[:space:]]*(#|$)|^sdk\.dir=' "$mobile/android/local.properties" > /dev/null; then
  echo "android/local.properties has entries other than sdk.dir; refusing to build" >&2
  exit 1
fi
if [ -d "$HOME/.gradle/init.d" ] && [ -n "$(ls -A "$HOME/.gradle/init.d" 2> /dev/null)" ]; then
  echo "$HOME/.gradle/init.d has scripts that run in every Gradle build; remove them and re-run" >&2
  exit 1
fi

if [ "$platform" = ios ] && [ "$(uname)" != Darwin ]; then
  echo "iOS builds need macOS" >&2
  exit 2
fi

# The password and the typed confirmation both come from the terminal.
{ : < /dev/tty; } 2> /dev/null || { echo "no terminal available to ask for the password" >&2; exit 2; }
if [ "$allow_unverified" = 1 ]; then
  echo "WARNING: the web bundle will NOT be compared with the release manifest." >&2
  IFS= read -r -p 'Type "yes" to continue: ' answer < /dev/tty
  [ "$answer" = yes ] || { echo "aborted" >&2; exit 1; }
  export GLEAM_ALLOW_UNVERIFIED_BUNDLE=1
fi

cd "$mobile" || exit 1
echo "== Building and verifying the $platform bundle for $tag =="
bundle install --quiet || exit 1
bundle exec fastlane "$platform" prepare "tag:$tag" || exit 1

work="$(mktemp -d)"
chmod 700 "$work"
case "$work/" in "$repo_root"/*) echo "temp dir is inside the repo; refusing" >&2; exit 1 ;; esac

echo "== Unlocking $kdbx =="
yubikey=()
[ -z "${GLEAM_CWS_KDBX_YUBIKEY:-}" ] || yubikey=(--yubikey "$GLEAM_CWS_KDBX_YUBIKEY")
IFS= read -rs -p "KeePassXC password: " db_password < /dev/tty || exit 1
echo
[ -n "$db_password" ] || { echo "empty password" >&2; exit 1; }

# The password goes to keepassxc-cli on stdin, never in argv or the environment.
# The ${a[@]+...} form keeps an empty array legal under set -u on macOS bash 3.2.
kp() {
  printf '%s\n' "$db_password" | keepassxc-cli "$1" -q ${yubikey[@]+"${yubikey[@]}"} "${@:2}"
}
export_attachment() { # entry attachment dest
  (umask 077 && kp attachment-export "$kdbx" "$1" "$2" "$3") \
    || { echo "could not export attachment $2 from entry $1" >&2; exit 1; }
}
attribute() { # entry attribute
  local value
  value="$(kp show -s -a "$2" "$kdbx" "$1")" || { echo "could not read attribute $2 of entry $1" >&2; return 1; }
  [ -n "$value" ] || { echo "attribute $2 of entry $1 is empty" >&2; return 1; }
  printf '%s' "$value"
}

# A failed attribute read inside $(...) cannot exit the script, so the value
# is read first, checked, then exported.
# The key's file name carries its key id, so find it instead of hard-coding it.
# `show --show-attachments` prints an "Attachments:" heading, then one
# "  <name> (<size>)" line per attachment.
find_asc_attachment() { # entry
  local listing names count
  listing="$(kp show --show-attachments "$kdbx" "$1")" || { echo "could not read entry $1" >&2; return 1; }
  names="$(printf '%s\n' "$listing" | sed -n '/^Attachments:/,$ { /^Attachments:/d; s/^[[:space:]]*//; s/ ([0-9.,]* *[A-Za-z]*)$//; p; }' | grep -E '^AuthKey_[A-Za-z0-9]+\.p8$')"
  count="$(printf '%s' "$names" | grep -c .)"
  if [ "$count" != 1 ]; then
    echo "entry $1 must hold exactly one AuthKey_*.p8 attachment (found $count); set GLEAM_ASC_KEY_ATTACHMENT to pick one" >&2
    return 1
  fi
  printf '%s' "$names"
}

if [ "$platform" = ios ]; then
  asc_entry="${GLEAM_ASC_ENTRY:-App Store Connect API}"
  asc_attachment="${GLEAM_ASC_KEY_ATTACHMENT:-}"
  [ -n "$asc_attachment" ] || asc_attachment="$(find_asc_attachment "$asc_entry")" || exit 1
  export_attachment "$asc_entry" "$asc_attachment" "$work/AuthKey.p8"
  key_id="${ASC_KEY_ID:-}"
  [ -n "$key_id" ] || key_id="$(attribute "$asc_entry" KEY_ID)" || exit 1
  issuer_id="${ASC_ISSUER_ID:-}"
  [ -n "$issuer_id" ] || issuer_id="$(attribute "$asc_entry" ISSUER_ID)" || exit 1
  export GLEAM_ASC_KEY_PATH="$work/AuthKey.p8" ASC_KEY_ID="$key_id" ASC_ISSUER_ID="$issuer_id"
else
  keystore_entry="${GLEAM_KEYSTORE_ENTRY:-gleam-upload-keystore}"
  export_attachment "$keystore_entry" "${GLEAM_KEYSTORE_ATTACHMENT:-upload-keystore.jks}" "$work/upload-keystore.jks"
  store_password="$(attribute "$keystore_entry" Password)" || exit 1
  key_alias="$(attribute "$keystore_entry" KeyAlias)" || exit 1
  key_password="$(attribute "$keystore_entry" KeyPassword)" || exit 1
  export GLEAM_UPLOAD_KEYSTORE="$work/upload-keystore.jks" GLEAM_UPLOAD_STORE_PASSWORD="$store_password" \
    GLEAM_UPLOAD_KEY_ALIAS="$key_alias" GLEAM_UPLOAD_KEY_PASSWORD="$key_password"
  if [ "$lane" = internal ]; then
    export_attachment "${GLEAM_PLAY_ENTRY:-Play service account}" "${GLEAM_PLAY_KEY_ATTACHMENT:-play-service-account.json}" "$work/play.json"
    export GLEAM_PLAY_JSON_KEY_PATH="$work/play.json"
  fi
fi
unset db_password store_password key_password

echo "== Running $platform $lane =="
bundle exec fastlane "$platform" "$lane" "tag:$tag"
