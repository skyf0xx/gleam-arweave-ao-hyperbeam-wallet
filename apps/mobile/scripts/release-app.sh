#!/usr/bin/env bash
# Build, sign and upload the Gleam app from a release tag, on this machine.
#
#   apps/mobile/scripts/release-app.sh v1.31.0 ios            --kdbx <path>   TestFlight
#   apps/mobile/scripts/release-app.sh v1.31.0 android        --kdbx <path>   Play internal track
#   apps/mobile/scripts/release-app.sh v1.31.0 android-bundle --kdbx <path>   signed AAB only
#
# Add --allow-unverified-bundle to skip the comparison with the manifest's
# mobileBundleSha256 (a tag whose manifest has none). It asks for a typed
# "yes"; the environment variable alone is ignored.
#
# The checkout must be clean and at the signed tag, and is checked before any
# Ruby (the Gemfile) runs. The web bundle is built
# and checked against the tag's release-manifest.json first, with no
# credentials in the environment. Only then is the KeePassXC database
# unlocked (password asked once; GLEAM_CWS_KDBX_YUBIKEY=<slot[:serial]> if it
# needs a YubiKey) and the credentials exported into a private temp dir that
# is deleted on exit. CI never sees them.
#
# Entries in the database, each name overridable by the variable shown:
#   Apple settings           GLEAM_ASC_ENTRY       attachment AuthKey_XLM98V7M34.p8 (GLEAM_ASC_KEY_ATTACHMENT),
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
  echo "usage: $0 v<major>.<minor>.<patch> ios|android|android-bundle --kdbx <path-to-keepassxc-db> [--allow-unverified-bundle]" >&2
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
  android) platform=android; lane=internal ;;
  android-bundle) platform=android; lane=signed_bundle ;;
  *) usage ;;
esac
[ -n "$kdbx" ] || { echo "no KeePassXC database: pass --kdbx or set GLEAM_CWS_KDBX" >&2; exit 2; }
[ -f "$kdbx" ] || { echo "KeePassXC database not found: $kdbx" >&2; exit 2; }
command -v keepassxc-cli > /dev/null || { echo "keepassxc-cli not found; brew install --cask keepassxc" >&2; exit 2; }
command -v bundle > /dev/null || { echo "bundler not found; see apps/mobile/fastlane/README.md" >&2; exit 2; }

# A dirty or wrong checkout must be refused before anything executes from it
# (the Gemfile is Ruby), so this comes before the signature check.
[ "$(git -C "$repo_root" cat-file -t "refs/tags/$tag" 2> /dev/null)" = "tag" ] \
  || { echo "$tag is not an annotated tag" >&2; exit 1; }
[ "$(git -C "$repo_root" rev-parse HEAD)" = "$(git -C "$repo_root" rev-parse "$tag^{commit}")" ] \
  || { echo "checkout is not at $tag; check it out and re-run" >&2; exit 1; }
[ -z "$(git -C "$repo_root" status --porcelain)" ] \
  || { echo "working tree is not clean; refusing to build" >&2; exit 1; }
git -C "$repo_root" -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v "$tag" \
  || { echo "$tag is not signed by a key in .github/allowed_signers; refusing to build" >&2; exit 1; }

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
cleanup() {
  rm -rf "$work"
  # A Gradle daemon would keep the keystore passwords in its environment.
  [ "$platform" != android ] || (cd "$mobile/android" && ./gradlew --stop > /dev/null 2>&1)
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP
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
if [ "$platform" = ios ]; then
  asc_entry="${GLEAM_ASC_ENTRY:-Apple settings}"
  export_attachment "$asc_entry" "${GLEAM_ASC_KEY_ATTACHMENT:-AuthKey_XLM98V7M34.p8}" "$work/AuthKey.p8"
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
