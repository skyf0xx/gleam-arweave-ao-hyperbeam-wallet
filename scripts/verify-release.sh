#!/usr/bin/env bash
# Rebuild a Gleam release from source and check it against what was published.
#
#   scripts/verify-release.sh v1.27.0 [--installed <extension-folder>]
#
# Checks, each printed as PASS or FAIL (exit status is non-zero on any FAIL):
#   1. the Release's zip matches the sha256 in its release-manifest.json
#   2. the manifest's commit is the commit the tag points to
#   3. a clean build of that tag produces a zip with the manifest's sha256
#   4. with --installed: the files Chrome installed match the build
#      (ignores _metadata/ and the key/update_url fields the Chrome Web Store
#      adds to manifest.json)
#
# Needs git, node, pnpm, curl, unzip and shasum or sha256sum. Builds in the
# current checkout if it is clean and at the tag, else in a temporary clone.
#
# Overrides, for testing against a local stand-in:
#   GLEAM_RELEASE_BASE_URL  default https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/download
#                           (files are fetched from <base>/<tag>/<file>; file:// works)
#   GLEAM_REPO_URL          default https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet.git
set -uo pipefail

REPO_URL="${GLEAM_REPO_URL:-https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet.git}"
BASE_URL="${GLEAM_RELEASE_BASE_URL:-https://github.com/skyf0xx/gleam-arweave-ao-hyperbeam-wallet/releases/download}"

usage() {
  echo "usage: $0 v<major>.<minor>.<patch> [--installed <extension-folder>]" >&2
  exit 2
}

tag=""
installed=""
while [ $# -gt 0 ]; do
  case "$1" in
    --installed)
      [ $# -ge 2 ] || usage
      installed="$2"
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
if [ -n "$installed" ] && [ ! -d "$installed" ]; then
  echo "--installed: $installed is not a directory" >&2
  exit 2
fi
[ -z "$installed" ] || installed="$(cd "$installed" && pwd)"

failures=0
pass() { echo "PASS  $1"; }
fail() {
  echo "FAIL  $1"
  failures=$((failures + 1))
}
warn() { echo "WARN  $1"; }
die() {
  echo "FAIL  $1"
  exit 1
}

for cmd in git node pnpm curl unzip; do
  command -v "$cmd" > /dev/null 2>&1 || die "$cmd is required but not installed"
done
if command -v sha256sum > /dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum > /dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "sha256sum or shasum is required"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- source at the tag --------------------------------------------------------

src=""
if top="$(git rev-parse --show-toplevel 2> /dev/null)" \
  && [ -f "$top/apps/extension/wxt.config.ts" ] \
  && [ -z "$(git -C "$top" status --porcelain 2> /dev/null)" ] \
  && tag_commit_here="$(git -C "$top" rev-parse -q --verify "refs/tags/$tag^{commit}" 2> /dev/null)" \
  && [ "$tag_commit_here" = "$(git -C "$top" rev-parse HEAD)" ]; then
  src="$top"
  echo "Using the current checkout (clean, at $tag)"
else
  echo "Cloning $REPO_URL at $tag"
  if ! git clone --quiet --branch "$tag" "$REPO_URL" "$work/src" 2> "$work/clone.log"; then
    cat "$work/clone.log" >&2
    die "could not clone $tag"
  fi
  src="$work/src"
fi
commit="$(git -C "$src" rev-parse HEAD)"
echo "Commit $commit"

# --- toolchain ----------------------------------------------------------------

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" = "22" ]; then
  pass "Node major is 22"
else
  warn "Node major is $node_major; releases are built with 22, so the zip may differ"
fi

want_pnpm="$(node -p 'const p=require(process.argv[1]).packageManager||"";p.replace(/^pnpm@/,"").replace(/\+.*/,"")' "$src/package.json")"
have_pnpm="$(pnpm --version 2> /dev/null || true)"
if [ -n "$want_pnpm" ] && [ "$have_pnpm" = "$want_pnpm" ]; then
  pass "pnpm is $want_pnpm"
else
  warn "pnpm is ${have_pnpm:-unknown}; package.json pins $want_pnpm"
fi

# --- published files ----------------------------------------------------------

dl="$work/release"
mkdir -p "$dl"
if ! curl -fsSL --retry 2 -o "$dl/release-manifest.json" "$BASE_URL/$tag/release-manifest.json"; then
  die "could not download release-manifest.json for $tag from $BASE_URL"
fi
manifest_field() { node -p 'const v=require(process.argv[1])[process.argv[2]];typeof v==="string"?v:""' "$dl/release-manifest.json" "$1"; }
zip_name="$(manifest_field zipName)"
want_sha="$(manifest_field zipSha256)"
manifest_commit="$(manifest_field commit)"
if [[ ! "$zip_name" =~ ^[A-Za-z0-9._-]+\.zip$ ]] || [[ ! "$want_sha" =~ ^[0-9a-f]{64}$ ]]; then
  die "release-manifest.json has no valid zipName and zipSha256"
fi

if ! curl -fsSL --retry 2 -o "$dl/$zip_name" "$BASE_URL/$tag/$zip_name"; then
  die "could not download $zip_name for $tag from $BASE_URL"
fi
got_sha="$(sha256 "$dl/$zip_name")"
if [ "$got_sha" = "$want_sha" ]; then
  pass "downloaded $zip_name matches the manifest ($want_sha)"
else
  fail "downloaded $zip_name is $got_sha, manifest says $want_sha"
fi

if [ "$manifest_commit" = "$commit" ]; then
  pass "manifest commit is the commit $tag points to"
else
  fail "manifest commit is ${manifest_commit:-missing}, $tag points to $commit"
fi

# --- build --------------------------------------------------------------------

# The same two commands release.yml runs.
echo "Building (this installs dependencies and takes a minute)"
rm -rf "$src/apps/extension/.output"
if ! (cd "$src" && pnpm install --frozen-lockfile > "$work/install.log" 2>&1); then
  tail -n 20 "$work/install.log" >&2
  die "pnpm install failed"
fi
if ! (cd "$src" && pnpm --filter @gleam/extension exec wxt zip > "$work/build.log" 2>&1); then
  tail -n 20 "$work/build.log" >&2
  die "build failed"
fi
built_zip="$src/apps/extension/.output/$zip_name"
if [ ! -f "$built_zip" ]; then
  fail "the build did not produce $zip_name"
else
  built_sha="$(sha256 "$built_zip")"
  if [ "$built_sha" = "$want_sha" ]; then
    pass "local build of $tag reproduces the manifest hash ($built_sha)"
  else
    fail "local build is $built_sha, manifest says $want_sha"
  fi
fi

# --- installed extension ------------------------------------------------------

if [ -n "$installed" ]; then
  if [ ! -f "$built_zip" ]; then
    fail "installed extension not compared: no local build"
  else
    expected="$work/expected"
    mkdir -p "$expected"
    unzip -q "$built_zip" -d "$expected"

    list() { (cd "$1" && find . -type f ! -path './_metadata/*' | sort); }
    list "$expected" > "$work/expected.list"
    list "$installed" > "$work/installed.list"

    # manifest.json is compared as JSON without the fields the store adds.
    canon_manifest() {
      node -e '
        const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        delete m.key;
        delete m.update_url;
        const sort = (v) => Array.isArray(v) ? v.map(sort)
          : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]))
          : v;
        process.stdout.write(JSON.stringify(sort(m)));
      ' "$1"
    }

    bad=0
    while IFS= read -r f; do
      if ! grep -Fxq -- "$f" "$work/installed.list"; then
        echo "      missing from installed: $f"
        bad=$((bad + 1))
      fi
    done < "$work/expected.list"
    while IFS= read -r f; do
      if ! grep -Fxq -- "$f" "$work/expected.list"; then
        echo "      not in the build: $f"
        bad=$((bad + 1))
      fi
    done < "$work/installed.list"
    while IFS= read -r f; do
      [ -f "$installed/$f" ] || continue
      if [ "$f" = "./manifest.json" ]; then
        if [ "$(canon_manifest "$expected/$f" 2> /dev/null)" != "$(canon_manifest "$installed/$f" 2> /dev/null)" ]; then
          echo "      differs: $f"
          bad=$((bad + 1))
        fi
      elif [ "$(sha256 "$expected/$f")" != "$(sha256 "$installed/$f")" ]; then
        echo "      differs: $f"
        bad=$((bad + 1))
      fi
    done < "$work/expected.list"

    if [ "$bad" -eq 0 ]; then
      pass "installed extension matches the build ($(wc -l < "$work/expected.list" | tr -d ' ') files)"
    else
      fail "installed extension differs from the build ($bad problems)"
    fi
  fi
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "All checks passed for $tag"
else
  echo "$failures check(s) failed for $tag"
  exit 1
fi
