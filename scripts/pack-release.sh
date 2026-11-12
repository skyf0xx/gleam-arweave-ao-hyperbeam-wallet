#!/usr/bin/env bash
# Sign a published Gleam release into a .crx for the Chrome Web Store.
#
#   scripts/pack-release.sh v1.27.0 --kdbx <path-to-keepassxc-db>
#   scripts/pack-release.sh v1.27.0 --key <path-to-private-key>
#
# Packs the zip release.yml built and attested, never a local build. It
# checks the tag's signature against .github/allowed_signers, downloads the
# Release's zip and release-manifest.json, checks the zip's sha256 and the
# manifest's commit, and runs `gh attestation verify` so the zip is proven to
# come from release.yml at this repository. Only then does it unlock the key
# and sign the unpacked zip with `chrome --pack-extension`, producing
# <tag>.crx in the current directory.
#
# It runs no pnpm install and no build: npm code that ran on this machine
# could be waiting for the key to appear. Reproduce the build with
# scripts/verify-release.sh beforehand, in another terminal session, not the
# shell that unlocks the key. That run leaves a receipt holding the
# reproduced sha256 ($GLEAM_RELEASE_RECEIPTS/<tag>.verified, default
# ${XDG_STATE_HOME:-~/.local/state}/gleam-release), and the zip is signed
# only if its hash matches the receipt: the attestation proves where the zip
# was built, the rebuild proves it is the tag's source.
#
# The private key never goes through CI. Keep it as the attachment
# "gleam-cws.pem" on the entry "gleam-cws" in a KeePassXC database and pass
# --kdbx (or set GLEAM_CWS_KDBX); set GLEAM_CWS_KDBX_YUBIKEY=<slot[:serial]>
# if the database needs a YubiKey. The key is exported into a private temp
# dir only for the chrome --pack-extension call and deleted on exit.
# --key <path> (or GLEAM_CWS_KEY) still takes a plaintext PEM.
# Chrome Web Store Verified CRX Uploads rejects any upload not signed with
# the matching key, so this step has to run on a trusted machine with the
# key in hand, not in release.yml.
#
# Needs git, gh, node, curl, unzip, shasum or sha256sum, a Chrome/Chromium
# binary (override with CHROME_BIN if it isn't auto-detected), and
# keepassxc-cli when signing from a KeePassXC database.
#
# Overrides, for scripts/pack-release.release.test.ts only (refused unless
# GLEAM_PACK_TEST=1):
#   GLEAM_RELEASE_BASE_URL  as in verify-release.sh (file:// works)
#   GLEAM_GH_REPO           default skyf0xx/gleam-arweave-ao-hyperbeam-wallet
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "usage: $0 v<major>.<minor>.<patch> (--kdbx <path-to-keepassxc-db> | --key <path-to-private-key>)" >&2
  exit 2
}

tag=""
key="${GLEAM_CWS_KEY:-}"
kdbx="${GLEAM_CWS_KDBX:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --key)
      [ $# -ge 2 ] || usage
      key="$2"
      shift 2
      ;;
    --kdbx)
      [ $# -ge 2 ] || usage
      kdbx="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      [ -z "$tag" ] || usage
      tag="$1"
      shift
      ;;
  esac
done
[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
if [ -n "$kdbx" ]; then
  [ -z "$key" ] || { echo "both a KeePassXC database and a key file given; pass only one" >&2; exit 2; }
  [ -f "$kdbx" ] || { echo "KeePassXC database not found: $kdbx" >&2; exit 2; }
  command -v keepassxc-cli > /dev/null || { echo "keepassxc-cli not found; brew install --cask keepassxc" >&2; exit 2; }
else
  [ -n "$key" ] || { echo "no private key given: pass --kdbx or --key, or set GLEAM_CWS_KDBX or GLEAM_CWS_KEY" >&2; exit 2; }
  [ -f "$key" ] || { echo "key not found: $key" >&2; exit 2; }
fi

chrome_bin="${CHROME_BIN:-}"
if [ -z "$chrome_bin" ]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    "$(command -v google-chrome 2> /dev/null || true)" \
    "$(command -v chromium 2> /dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      chrome_bin="$candidate"
      break
    fi
  done
fi
[ -n "$chrome_bin" ] || { echo "no Chrome/Chromium binary found; set CHROME_BIN" >&2; exit 2; }

for cmd in git gh node curl unzip; do
  command -v "$cmd" > /dev/null 2>&1 || { echo "$cmd is required but not installed" >&2; exit 2; }
done
if command -v sha256sum > /dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum > /dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  echo "sha256sum or shasum is required" >&2
  exit 2
fi

# Both overrides decide what gets signed, so outside the test they are refused
# rather than trusted from the environment.
if { [ -n "${GLEAM_RELEASE_BASE_URL:-}" ] || [ -n "${GLEAM_GH_REPO:-}" ]; } && [ "${GLEAM_PACK_TEST:-}" != "1" ]; then
  echo "GLEAM_RELEASE_BASE_URL and GLEAM_GH_REPO are for scripts/pack-release.release.test.ts only; unset them" >&2
  exit 2
fi
BASE_URL="${GLEAM_RELEASE_BASE_URL:-https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/download}"
GH_REPO="${GLEAM_GH_REPO:-skyf0xx/gleam-arweave-ao-hyperbeam-wallet}"

repo_root="$(cd "$here/.." && pwd)"
[ "$(git -C "$repo_root" cat-file -t "refs/tags/$tag" 2> /dev/null)" = "tag" ] \
  || { echo "$tag is not an annotated tag" >&2; exit 1; }
git -C "$repo_root" -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v "$tag" \
  || { echo "$tag is not signed by a key in .github/allowed_signers; refusing to pack" >&2; exit 1; }
tag_commit="$(git -C "$repo_root" rev-parse "refs/tags/$tag^{commit}")"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== Downloading $tag =="
dl="$work/release"
mkdir -p "$dl"
curl -fsSL --retry 2 -o "$dl/release-manifest.json" "$BASE_URL/$tag/release-manifest.json" \
  || { echo "could not download release-manifest.json for $tag from $BASE_URL" >&2; exit 1; }
# Run from $work so node picks up nothing from the checkout.
manifest_field() {
  (cd "$work" && node -p 'const v=require(process.argv[1])[process.argv[2]];typeof v==="string"?v:""' "$dl/release-manifest.json" "$1")
}
zip_name="$(manifest_field zipName)"
want_sha="$(manifest_field zipSha256)"
manifest_commit="$(manifest_field commit)"
if [[ ! "$zip_name" =~ ^[A-Za-z0-9._-]+\.zip$ ]] || [[ ! "$want_sha" =~ ^[0-9a-f]{64}$ ]]; then
  echo "release-manifest.json has no valid zipName and zipSha256; refusing to pack" >&2
  exit 1
fi
[ "$manifest_commit" = "$tag_commit" ] \
  || { echo "manifest commit is ${manifest_commit:-missing}, $tag points to $tag_commit; refusing to pack" >&2; exit 1; }
zip="$dl/$zip_name"
curl -fsSL --retry 2 -o "$zip" "$BASE_URL/$tag/$zip_name" \
  || { echo "could not download $zip_name for $tag from $BASE_URL" >&2; exit 1; }
got_sha="$(sha256 "$zip")"
[ "$got_sha" = "$want_sha" ] \
  || { echo "downloaded $zip_name is $got_sha, manifest says $want_sha; refusing to pack" >&2; exit 1; }
echo "$zip_name matches the manifest ($want_sha)"

echo "== Verifying the attestation =="
# The source digest and ref pin the attestation to this tag's commit, so a
# zip release.yml attested for another tag does not pass.
gh attestation verify "$zip" --repo "$GH_REPO" \
  --signer-workflow "$GH_REPO/.github/workflows/release.yml" \
  --source-digest "$tag_commit" --source-ref "refs/tags/$tag" \
  || { echo "gh attestation verify failed for $zip_name; refusing to pack" >&2; exit 1; }

echo "== Checking the local rebuild =="
receipt="${GLEAM_RELEASE_RECEIPTS:-${XDG_STATE_HOME:-$HOME/.local/state}/gleam-release}/$tag.verified"
[ -f "$receipt" ] \
  || { echo "no rebuild receipt at $receipt; run scripts/verify-release.sh $tag in another terminal first" >&2; exit 1; }
[ "$(tr -d '[:space:]' < "$receipt")" = "$got_sha" ] \
  || { echo "the local rebuild of $tag ($receipt) does not match $zip_name ($got_sha); refusing to pack" >&2; exit 1; }
echo "$zip_name matches the local rebuild"

unpacked="$work/unpacked"
mkdir -p "$unpacked"
unzip -q "$zip" -d "$unpacked" || { echo "could not unzip $zip_name; refusing to pack" >&2; exit 1; }

if [ -n "$kdbx" ]; then
  echo "== Unlocking $kdbx =="
  yubikey=()
  [ -z "${GLEAM_CWS_KDBX_YUBIKEY:-}" ] || yubikey=(--yubikey "$GLEAM_CWS_KDBX_YUBIKEY")
  key="$work/gleam-cws.pem"
  # The ${a[@]+...} form keeps an empty array legal under set -u on macOS bash 3.2.
  (umask 077 && keepassxc-cli attachment-export ${yubikey[@]+"${yubikey[@]}"} \
    "$kdbx" gleam-cws gleam-cws.pem "$key") \
    || { echo "could not export gleam-cws.pem from entry gleam-cws in $kdbx" >&2; exit 1; }
fi

echo "== Packing and signing =="
out_dir="$(pwd)"
"$chrome_bin" --pack-extension="$unpacked" --pack-extension-key="$key"

# Chrome writes <dir>.crx next to the unpacked folder; move it to cwd as <tag>.crx.
produced="$unpacked.crx"
[ -f "$produced" ] || { echo "chrome --pack-extension did not produce $produced" >&2; exit 1; }
mv "$produced" "$out_dir/$tag.crx"

echo
echo "Wrote $out_dir/$tag.crx"
echo "Upload it to the Chrome Web Store Developer Dashboard."
