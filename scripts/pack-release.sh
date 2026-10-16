#!/usr/bin/env bash
# Sign a verified Gleam release into a .crx for the Chrome Web Store.
#
#   scripts/pack-release.sh v1.27.0 [--key <path-to-private-key>]
#
# Runs verify-release.sh first (downloads the Release, checks its sha256
# against release-manifest.json, and rebuilds the tag from source to
# reproduce that hash) and refuses to pack anything verify-release.sh did
# not pass. Only then unzips the verified build and signs it with
# `chrome --pack-extension`, producing <tag>.crx in the current directory.
#
# The private key never goes through CI: pass its path explicitly, or set
# GLEAM_CWS_KEY. Chrome Web Store Verified CRX Uploads then rejects any
# upload not signed with the matching key, so this step has to run on a
# trusted machine with the key in hand, not in release.yml.
#
# Needs the same tools as verify-release.sh, plus a Chrome/Chromium binary
# (override with CHROME_BIN if it isn't auto-detected).
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  echo "usage: $0 v<major>.<minor>.<patch> [--key <path-to-private-key>]" >&2
  exit 2
}

tag=""
key="${GLEAM_CWS_KEY:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --key)
      [ $# -ge 2 ] || usage
      key="$2"
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
[ -n "$key" ] || { echo "no private key given: pass --key or set GLEAM_CWS_KEY" >&2; exit 2; }
[ -f "$key" ] || { echo "key not found: $key" >&2; exit 2; }

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

repo_root="$(cd "$here/.." && pwd)"
[ "$(git -C "$repo_root" cat-file -t "refs/tags/$tag" 2> /dev/null)" = "tag" ] \
  || { echo "$tag is not an annotated tag" >&2; exit 1; }
git -C "$repo_root" -c gpg.ssh.allowedSignersFile=.github/allowed_signers tag -v "$tag" \
  || { echo "$tag is not signed by a key in .github/allowed_signers; refusing to pack" >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== Verifying $tag =="
if ! "$here/verify-release.sh" "$tag" | tee "$work/verify.log"; then
  echo "verify-release.sh failed for $tag; refusing to pack" >&2
  exit 1
fi

# verify-release.sh rebuilds in the current checkout when it's clean and at
# the tag, otherwise in its own temp clone — either way it prints which.
src=""
if top="$(git rev-parse --show-toplevel 2> /dev/null)" \
  && [ -z "$(git -C "$top" status --porcelain 2> /dev/null)" ] \
  && tag_commit_here="$(git -C "$top" rev-parse -q --verify "refs/tags/$tag^{commit}" 2> /dev/null)" \
  && [ "$tag_commit_here" = "$(git -C "$top" rev-parse HEAD)" ]; then
  src="$top"
else
  die() {
    echo "$1" >&2
    exit 1
  }
  die "checkout is not clean and at $tag; check out the tag with no local changes and re-run"
fi

built_zip=("$src"/apps/extension/.output/*-chrome.zip)
[ "${#built_zip[@]}" -eq 1 ] && [ -f "${built_zip[0]}" ] || {
  echo "expected one built zip in $src/apps/extension/.output, found ${#built_zip[@]}" >&2
  exit 1
}

unpacked="$work/unpacked"
mkdir -p "$unpacked"
unzip -q "${built_zip[0]}" -d "$unpacked"

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
