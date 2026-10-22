#!/usr/bin/env bash
# CI-only Developer ID setup/verification. Never prints private signing material.
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true || "$(uname -s)" != Darwin ]]; then
  echo 'Signing setup is restricted to a GitHub macOS runner.' >&2
  exit 1
fi
if [[ -z "${RUNNER_TEMP:-}" || "$RUNNER_TEMP" != /* || "$RUNNER_TEMP" == / ]]; then
  echo 'A private runner temporary directory is required.' >&2
  exit 1
fi
work="$RUNNER_TEMP/dispatch-signing"
keychain="$work/signing.keychain-db"

case "${1:-}" in
  install)
    if [[ "${GITHUB_EVENT_NAME:-}" == pull_request* ]]; then
      echo 'Pull-request events must never install signing credentials.' >&2
      exit 1
    fi
    for name in GITHUB_ENV APPLE_TEAM_ID MACOS_CERTIFICATE_P12_BASE64 MACOS_CERTIFICATE_PASSWORD APP_STORE_CONNECT_ISSUER_ID APP_STORE_CONNECT_KEY_ID APP_STORE_CONNECT_PRIVATE_KEY; do
      if [[ -z "${!name:-}" ]]; then
        echo "Missing signing configuration: $name" >&2
        exit 1
      fi
    done
    if [[ ! "$APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ || ! "$APP_STORE_CONNECT_KEY_ID" =~ ^[A-Z0-9]{10}$ || ! "$APP_STORE_CONNECT_ISSUER_ID" =~ ^[a-fA-F0-9]{8}(-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}$ ]]; then
      echo 'Invalid Apple team, API key or issuer identifier.' >&2
      exit 1
    fi
    if [[ -e "$work" || -L "$work" ]]; then
      echo 'Refusing to reuse an existing signing directory.' >&2
      exit 1
    fi
    umask 077
    mkdir "$work"
    python3 - "$work/keychains.json" <<'PY'
import json, shlex, subprocess, sys
from pathlib import Path
original = shlex.split(subprocess.check_output(['security', 'list-keychains', '-d', 'user'], text=True))
Path(sys.argv[1]).write_text(json.dumps(original))
PY
    printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$work/certificate.p12"
    printf '%s' "$APP_STORE_CONNECT_PRIVATE_KEY" > "$work/AuthKey_$APP_STORE_CONNECT_KEY_ID.p8"
    openssl pkey -in "$work/AuthKey_$APP_STORE_CONNECT_KEY_ID.p8" -noout >/dev/null
    password=$(openssl rand -hex 32)
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 7200 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    security import "$work/certificate.p12" -P "$MACOS_CERTIFICATE_PASSWORD" -k "$keychain" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
    python3 - "$work/keychains.json" "$keychain" <<'PY'
import json, subprocess, sys
from pathlib import Path
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', sys.argv[2], *json.loads(Path(sys.argv[1]).read_text())], check=True)
PY
    identity=$(python3 - "$keychain" <<'PY'
import os, re, subprocess, sys
output = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning', sys.argv[1]], text=True)
identities = [name for name in re.findall(r'"(Developer ID Application:[^"]+)"', output) if name.endswith('(' + os.environ['APPLE_TEAM_ID'] + ')')]
if len(identities) != 1:
    raise SystemExit('Expected exactly one valid Developer ID Application identity for the configured team; an iOS Apple Distribution identity cannot be used.')
print(identities[0])
PY
)
    {
      printf 'APPLE_SIGNING_IDENTITY=%s\n' "$identity"
      printf 'APPLE_API_KEY=%s\n' "$APP_STORE_CONNECT_KEY_ID"
      printf 'APPLE_API_ISSUER=%s\n' "$APP_STORE_CONNECT_ISSUER_ID"
      printf 'APPLE_API_KEY_PATH=%s/AuthKey_%s.p8\n' "$work" "$APP_STORE_CONNECT_KEY_ID"
    } >> "$GITHUB_ENV"
    ;;
  verify)
    : "${APPLE_TEAM_ID:?Apple team is required}"
    app="${2:?App bundle path is required}"
    dmg="${3:?DMG path is required}"
    codesign --verify --deep --strict --verbose=2 "$app"
    for executable in "$app/Contents/MacOS/dispatch" "$app/Contents/MacOS/dispatch-review" "$app/Contents/MacOS/ferropi" "$dmg"; do
      [[ -f "$executable" ]] || { echo "Missing signed component: $executable" >&2; exit 1; }
      codesign --verify --strict "$executable"
      details=$(codesign --display --verbose=4 "$executable" 2>&1)
      grep -q '^Authority=Developer ID Application:' <<< "$details"
      grep -Fxq "TeamIdentifier=$APPLE_TEAM_ID" <<< "$details"
      if [[ "$executable" != "$dmg" ]]; then grep -Eq 'flags=.*\(.*runtime' <<< "$details"; fi
      grep -Eq '^Timestamp=.+' <<< "$details"
      if grep -Fxq 'Timestamp=none' <<< "$details"; then exit 1; fi
    done
    xcrun stapler validate "$app"
    xcrun stapler validate "$dmg"
    assessment=$(spctl --assess --type execute --verbose=4 "$app" 2>&1)
    printf '%s\n' "$assessment"
    grep -Eq '(^|: )accepted$' <<< "$assessment"
    grep -Fxq 'source=Notarized Developer ID' <<< "$assessment"
    assessment=$(spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg" 2>&1)
    printf '%s\n' "$assessment"
    grep -Eq '(^|: )accepted$' <<< "$assessment"
    grep -Fxq 'source=Notarized Developer ID' <<< "$assessment"
    ;;
  cleanup)
    # Remove private files even if restoring the search list fails.
    trap 'if [[ -d "$work" && ! -L "$work" ]]; then rm -rf -- "$work"; fi' EXIT
    if [[ -f "$work/keychains.json" ]]; then
      python3 - "$work/keychains.json" <<'PY'
import json, subprocess, sys
from pathlib import Path
subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *json.loads(Path(sys.argv[1]).read_text())], check=True)
PY
    fi
    if [[ -f "$keychain" ]]; then security delete-keychain "$keychain"; fi
    ;;
  *) echo 'Usage: macos-signing.sh install | verify APP DMG | cleanup' >&2; exit 1 ;;
esac
