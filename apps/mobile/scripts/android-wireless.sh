#!/usr/bin/env bash
# Build the app and run it on an Android phone over wireless debugging.
#
#   pnpm mobile:android:wifi                  find the phone on the network, build, install, launch
#   pnpm mobile:android:wifi <ip:port>        use this connect address instead of discovery
#   pnpm mobile:android:wifi pair <ip:port>   pair once (asks for the code the phone shows)
#
# A debug build shares the app id with the Play build but not its signing key,
# so the Play build has to be uninstalled first.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v adb >/dev/null || { echo "adb not found: install the Android SDK platform-tools" >&2; exit 1; }

# Gradle follows JAVA_HOME, which can still name an older JDK than the one on PATH.
if jdk21=$(/usr/libexec/java_home -v 21 2>/dev/null); then
  export JAVA_HOME="$jdk21"
fi

if [[ "${1:-}" == "pair" ]]; then
  [[ -n "${2:-}" ]] || { echo "usage: pair <ip:port> (Wireless debugging → Pair device with pairing code)" >&2; exit 1; }
  adb pair "$2"
  exit 0
fi

address="${1:-}"
if [[ -z "$address" ]]; then
  address=$(adb mdns services | awk '/_adb-tls-connect/ { print $NF; exit }')
  [[ -n "$address" ]] || {
    echo "No phone found. Turn on Wireless debugging on the same Wi-Fi, pair once with 'pair <ip:port>', or pass the connect address." >&2
    exit 1
  }
fi

adb connect "$address" | grep -q "connected to" || { echo "Could not connect to $address" >&2; exit 1; }

pnpm exec vite build
pnpm exec cap sync android
pnpm exec cap run android --target "$address" --no-sync
