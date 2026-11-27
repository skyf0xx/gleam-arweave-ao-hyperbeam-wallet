#!/usr/bin/env bash
# MobSF static scan of an unsigned release build of the synced native project,
# checked against apps/mobile/mobsf-baseline.json. release-app.sh runs it after
# `fastlane <platform> prepare` and before any secret is unlocked; signing
# leaves the scanned code unchanged.
#
#   apps/mobile/scripts/mobsf-scan.sh <android|ios> <work-dir>
set -euo pipefail

platform="${1:-}"
work="${2:-}"
case "$platform" in android | ios) ;; *) echo "usage: mobsf-scan.sh <android|ios> <work-dir>" >&2; exit 2 ;; esac
[ -d "$work" ] || { echo "work dir $work does not exist" >&2; exit 2; }
command -v docker > /dev/null || { echo "docker not found; it runs MobSF" >&2; exit 2; }

mobile="$(cd "$(dirname "$0")/.." && pwd)"
# MobSF v4.6.9.
image=opensecurity/mobile-security-framework-mobsf@sha256:815bb96de3c78a22e0a0996c667c164a227239c9d8a4aba80f188d247b928954

echo "== Building an unsigned $platform release for MobSF =="
if [ "$platform" = android ]; then
  (cd "$mobile/android" && env -u GLEAM_UPLOAD_KEYSTORE ./gradlew --no-daemon -q assembleRelease)
  binary="$work/gleam-unsigned.apk"
  cp "$mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk" "$binary"
else
  xcodebuild -quiet -project "$mobile/ios/App/App.xcodeproj" -scheme App -configuration Release \
    -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath "$work/mobsf-dd" \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
  mkdir -p "$work/mobsf-ipa/Payload"
  cp -R "$work/mobsf-dd/Build/Products/Release-iphoneos/App.app" "$work/mobsf-ipa/Payload/"
  binary="$work/gleam-unsigned.ipa"
  (cd "$work/mobsf-ipa" && zip -qr "$binary" Payload)
fi

echo "== Scanning with MobSF =="
api_key="$(openssl rand -hex 24)"
container="$(docker run -d --rm -p 127.0.0.1::8000 -e MOBSF_API_KEY="$api_key" "$image")"
trap 'docker stop "$container" > /dev/null 2>&1 || true' EXIT
url="http://$(docker port "$container" 8000/tcp | head -1)"

for _ in $(seq 1 60); do
  curl -fsS -o /dev/null "$url/" 2> /dev/null && break
  sleep 2
done
curl -fsS -o /dev/null "$url/" || { echo "MobSF did not start" >&2; exit 1; }

api() { # endpoint [curl args...]
  curl -fsS -H "Authorization: $api_key" "$url/api/v1/$1" "${@:2}"
}
hash="$(api upload -F "file=@$binary" | node -e 'process.stdin.on("data",(d)=>console.log(JSON.parse(d).hash))')"
api scan --data-urlencode "hash=$hash" --max-time 1200 -o /dev/null
api scorecard --data-urlencode "hash=$hash" -o "$work/mobsf-scorecard.json"

node "$mobile/scripts/mobsf-check.mjs" "$platform" "$work/mobsf-scorecard.json"
