#!/usr/bin/env bash
# Tell installs that don't update themselves that a release is out.
#
#   scripts/publish-latest.sh v1.54.0 android
#
# Sets <shell> to <version> in apps/site/latest.json on a branch off
# origin/master, opens a PR and turns on auto-merge. When the site deploys,
# those installs show an update notice within the hour. Run it only once
# the build is downloadable: release-app.sh android-apk calls it after
# uploading gleam.apk.
#
# Works in a temporary worktree, so the current checkout (often detached at
# the tag) is left alone. The commit is signed like any other.
set -uo pipefail

tag="${1:-}"
shell="${2:-}"
if ! [[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || ! [[ "$shell" =~ ^(android|ios|extension)$ ]]; then
  echo "usage: $0 v<major>.<minor>.<patch> android|ios|extension" >&2
  exit 2
fi
version="${BASH_REMATCH[1]}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
branch="chore/latest-$shell-$version"

git -C "$repo_root" fetch --quiet origin master || exit 1
work="$(mktemp -d)"
trap 'git -C "$repo_root" worktree remove --force "$work" >/dev/null 2>&1; rm -rf "$work"' EXIT
git -C "$repo_root" worktree add --quiet -b "$branch" "$work" origin/master || exit 1

# A plain JSON edit; no npm code runs here.
LATEST_FILE="$work/apps/site/latest.json" LATEST_SHELL="$shell" LATEST_VERSION="$version" node -e '
  const fs = require("fs");
  const file = process.env.LATEST_FILE;
  const latest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const older = (a, b) => {
    const [x, y] = [a, b].map((v) => v.split(".").map(Number));
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };
  const current = latest[process.env.LATEST_SHELL];
  if (typeof current === "string" && !older(current, process.env.LATEST_VERSION)) {
    console.error(`latest.json already has ${process.env.LATEST_SHELL} ${current}`);
    process.exit(3);
  }
  latest[process.env.LATEST_SHELL] = process.env.LATEST_VERSION;
  fs.writeFileSync(file, JSON.stringify(latest, null, 2) + "\n");
'
status=$?
[ "$status" -eq 3 ] && exit 0
[ "$status" -eq 0 ] || exit 1

git -C "$work" add apps/site/latest.json || exit 1
# The worktree has no node_modules for the hooks' tsc; CI runs every check on the PR.
git -C "$work" commit --quiet --no-verify -m "chore(site): announce $tag to $shell installs" || exit 1
git -C "$work" push --quiet -u origin "$branch" || exit 1
url="$(gh pr create --head "$branch" --base master \
  --title "chore(site): announce $tag to $shell installs" \
  --body "Sets \`$shell\` to \`$version\` in \`apps/site/latest.json\`. Once the site deploys, $shell installs on an older version show an update notice.")" || exit 1
gh pr merge "$url" --auto --merge || exit 1
echo "== $url merges once CI passes; the notice goes out when the site deploys =="
