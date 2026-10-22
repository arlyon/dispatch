# Developer ID signing and notarization

Dispatch is distributed directly, not through the Mac App Store. Its certificate must be **Developer ID Application**, with the matching private key. Offbeat's **Apple Distribution** iOS certificate cannot substitute for it. Offbeat's App Store Connect team API key may be reusable for notarization if its permissions allow it; actual authentication must still be verified.

Configuration can be performed from Linux. Signing, Apple notarization tooling and Gatekeeper verification run on a GitHub-hosted macOS runner, not the user's Mac.

## Security boundary

- Ordinary pull-request CI remains ad-hoc signed and has no Apple secrets.
- Only the dedicated signing job references the `production` environment.
- Configure a required human reviewer on that environment **before adding credentials**. Offbeat's environment name alone does not imply approval protection.
- The source ref is resolved in an unprivileged job. Approval links to that immutable commit; the credential-bearing job checks out that exact SHA.
- Approve only reviewed source. Its build scripts run in the signing job and can access that job's signing identity.
- Missing credentials, the wrong certificate type/team, rejected notarization, missing tickets or failed Gatekeeper assessment fail the job. There is no ad-hoc fallback.
- Private files are confined to a mode-0700 runner directory. Cleanup restores the original keychain search list and removes credentials, including on failure. No private material is uploaded as an artifact.

## One-time provisioning

Create Dispatch's GitHub `production` environment with a required reviewer, then configure:

| Kind | Name | Source |
| --- | --- | --- |
| Secret | `MACOS_CERTIFICATE_P12_BASE64` | Single-line Base64 of the password-protected Developer ID Application P12, including its private key and appropriate certificate chain |
| Secret | `MACOS_CERTIFICATE_PASSWORD` | Password used to export that P12 |
| Secret | `APP_STORE_CONNECT_ISSUER_ID` | Team API issuer, matching the P8 key |
| Secret | `APP_STORE_CONNECT_KEY_ID` | Team API key ID |
| Secret | `APP_STORE_CONNECT_PRIVATE_KEY` | Complete P8 key text |
| Environment variable | `APPLE_TEAM_ID` | Team that issued the Developer ID certificate |

These notarization secret names match Offbeat. GitHub does not allow downloading their existing plaintext values: populate Dispatch from the original vault/files, not workflow logs. Do not paste secrets into chat, commit them, or broaden Offbeat's credential exposure to work around that boundary. Certificate issuance/export and secret uploads require explicit approval.

A Developer ID certificate request and private key can be generated with OpenSSL on Linux, then the CSR can be submitted through Apple Developer by an appropriately authorized account. No local Mac is required for issuance. Keep the private key, issued certificate, export password and P8 in the vault. Do not revoke or replace Offbeat's working certificate.

## Non-publishing verification

After this workflow change is available through the repository's CI workflow, use **CI → Run workflow → verify_macos_signing = true**. Leave `ref` empty to use the chosen workflow commit, or supply a full commit SHA. Named source branches are rejected for signing verification so the source cannot change between ordinary checks and signing approval. Normal checks/packages must pass first. Review and approve the exact source commit in the protected environment.

The signed job:

1. Imports exactly one valid Developer ID Application identity for the configured team into a temporary keychain.
2. Builds through `mise run package`; Tauri signs the app and bundled executables and notarizes/staples the app.
3. Submits the final signed DMG with `notarytool`, requires `Accepted`, and staples its ticket.
4. Checks `dispatch`, `dispatch-review` and `ferropi` for the expected Developer ID team, hardened runtime and secure timestamps; checks the DMG signature, app/DMG tickets and Gatekeeper's notarized acceptance.
5. Uploads only `dispatch-macos-aarch64-signed` and cleans the keychain/private files.

This path never creates, uploads assets to, or publishes a GitHub release. It does submit the app/DMG to Apple for notarization. Linux mocks and workflow parsing are not evidence of a real Developer ID signature; the macOS job must pass with provisioned credentials before signing is declared working.

## Release integration and rollback

The existing human release-PR merge gate remains. Release checks create unsigned CI artifacts, then release-plz selects a draft tag. That tag gets a separate signed macOS build. Publication depends on successful signing and downloads Linux artifacts plus **only the signed macOS artifact**, never the ad-hoc DMG. Checksums are calculated after notarization/stapling. A failed signing job leaves the release draft unpublished; retry using the existing draft-tag workflow input.

For rollback, disable the signing job or revert the workflow change and stop publication. Do not silently publish an ad-hoc build as recovery. No existing public release is replaced by this configuration work.
