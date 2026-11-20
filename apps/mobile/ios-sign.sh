#!/usr/bin/env bash
set -euo pipefail
: "${IOS_DISTRIBUTION_P12_BASE64:?Missing distribution certificate}" "${IOS_P12_PASSWORD:?Missing certificate password}" "${IOS_ADHOC_PROFILE_BASE64:?Missing Ad Hoc profile}"
umask 077
work=$(mktemp -d "$RUNNER_TEMP/shensi-sign.XXXXXX")
keychain="$work/signing.keychain-db"
profile_path=''
cleanup() {
  security delete-keychain "$keychain" >/dev/null 2>&1 || true
  if [ -n "$profile_path" ]; then rm -f "$profile_path"; fi
  rm -rf "$work"
}
trap cleanup EXIT
printf '%s' "$IOS_DISTRIBUTION_P12_BASE64" | base64 -D > "$work/identity.p12"
printf '%s' "$IOS_ADHOC_PROFILE_BASE64" | base64 -D > "$work/profile"
security cms -D -i "$work/profile" > "$work/profile.plist"
TEAM=$(python3 - "$work/profile.plist" <<'PY'
import datetime, plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
assert p['ExpirationDate'] > datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
assert p.get('ProvisionedDevices') and not p.get('ProvisionsAllDevices')
assert not p['Entitlements'].get('get-task-allow')
assert p['Entitlements']['application-identifier'] == p['ApplicationIdentifierPrefix'][0] + '.studio.hexing.shensi.mobile'
print(p['TeamIdentifier'][0])
PY
)
uuid=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$work/profile.plist")
[[ "$uuid" =~ ^[A-Fa-f0-9-]{36}$ && "$TEAM" =~ ^[A-Z0-9]{10}$ ]]
password=$(openssl rand -hex 32)
security create-keychain -p "$password" "$keychain"
security unlock-keychain -p "$password" "$keychain"
security set-keychain-settings -lut 3600 "$keychain"
security import "$work/identity.p12" -k "$keychain" -P "$IOS_P12_PASSWORD" -T /usr/bin/codesign > /dev/null
unset IOS_DISTRIBUTION_P12_BASE64 IOS_P12_PASSWORD IOS_ADHOC_PROFILE_BASE64
security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
identity=$(security find-identity -v -p codesigning "$keychain" | awk '/Apple Distribution|iPhone Distribution/{print $2;exit}')
[[ "$identity" =~ ^[0-9A-F]{40}$ ]]
python3 - "$work/profile.plist" "$identity" <<'PY'
import hashlib, plistlib,sys
assert sys.argv[2].lower() in [hashlib.sha1(c).hexdigest() for c in plistlib.load(open(sys.argv[1],'rb'))['DeveloperCertificates']]
PY
profile_dir="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
mkdir -p "$profile_dir"
test ! -e "$profile_dir/$uuid.mobileprovision"
profile_path="$profile_dir/$uuid.mobileprovision"
cp "$work/profile" "$profile_path"
profile_name=$(/usr/libexec/PlistBuddy -c 'Print Name' "$work/profile.plist")
export_dir="$RUNNER_TEMP/shensi-iphone"
mkdir -p "$export_dir"
xcodebuild -scheme App -project apps/mobile/ios/App/App.xcodeproj -configuration Release -destination generic/platform=iOS -archivePath "$work/App.xcarchive" archive DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$identity" PROVISIONING_PROFILE_SPECIFIER="$profile_name" >"$work/archive.log" || { grep 'error:' "$work/archive.log"; exit 1; }
python3 - "$work/export.plist" "$TEAM" "$uuid" "$identity" <<'PY'
import sys,plistlib
plistlib.dump(dict(method='release-testing',teamID=sys.argv[2],signingStyle='manual',signingCertificate=sys.argv[4],provisioningProfiles={'studio.hexing.shensi.mobile':sys.argv[3]},manageAppVersionAndBuildNumber=False),open(sys.argv[1],'wb'))
PY
xcodebuild -exportArchive -archivePath "$work/App.xcarchive" -exportPath "$work/export" -exportOptionsPlist "$work/export.plist"
ipa=$(find "$work/export" -maxdepth 1 -name '*.ipa')
test -f "$ipa"
unzip -q "$ipa" -d "$work/verify"
app=$(find "$work/verify/Payload" -maxdepth 1 -name '*.app')
codesign --verify --deep --strict "$app"
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$app/Info.plist")" = studio.hexing.shensi.mobile
test "$(/usr/libexec/PlistBuddy -c 'Print CFBundleVersion' "$app/Info.plist")" = 13
security cms -D -i "$app/embedded.mobileprovision" > "$work/installed.plist"
test "$(/usr/libexec/PlistBuddy -c 'Print UUID' "$work/installed.plist")" = "$uuid"
cp "$ipa" "$export_dir/Shensi-0.0.13-AdHoc.ipa"
(cd "$export_dir" && shasum -a 256 *.ipa > SHA256SUMS)
