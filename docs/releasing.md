# Releasing Nexus

Releases are automatic from `main`. Version numbers and release notes come from
commit messages, so the one rule is: **PR titles follow
[Conventional Commits](https://www.conventionalcommits.org/)**. PRs are squash-merged
and the title becomes the commit message; the `PR title` check enforces it.

| PR title starts with | Next version | Release notes section |
|---|---|---|
| `feat: …` | 1.4.0 → 1.5.0 | New features |
| `fix: …` | 1.4.0 → 1.4.1 | Fixes |
| `perf: …` | patch | Faster |
| `refactor: …` | patch | Under the hood |
| `feat!: …`, or a `BREAKING CHANGE:` footer | 1.4.0 → 2.0.0 | (flagged as breaking) |
| `docs:`, `test:`, `build:`, `ci:`, `chore:` | no release on their own | hidden |

Write the title for someone reading the release notes: `feat: Cron tab for editing
crontabs over SSH`, not `feat: cron-tool.tsx`.

## What happens

```text
PR merged into main
  CI (Linux): type-check, lint, test, build, secrets scan
  Release workflow
    release-please opens or updates "chore(main): release x.y.z"
      bumps package.json + package-lock.json, updates CHANGELOG.md

"chore(main): release x.y.z" merged
  release-please tags vX.Y.Z and publishes the GitHub release (notes = changelog entry)
  build-mac (macos-latest, Apple silicon)
    builds the RDP add-on (vendored FreeRDP, cached), the app, then electron-builder
    attaches Nexus-x.y.z-arm64.dmg, Nexus-x.y.z-arm64-mac.zip, blockmaps, latest-mac.yml
```

To ship: merge the release PR when you're happy with what's in it. Nothing is
released until then; feature PRs just accumulate in it.

To rebuild the downloads for an existing release (say a build step failed): Actions ›
Release › Run workflow, with the tag (e.g. `v1.1.0`).

## Code signing and notarisation

Until these are set, releases are ad-hoc signed: macOS says the app "can't be
checked for malicious software" on first open (right-click › Open gets past it), and
the in-app updater can't install updates, because macOS only applies updates to
signed apps. Add them under Settings › Secrets and variables › Actions:

| Secret | What it is |
|---|---|
| `MAC_CERTIFICATE_P12_BASE64` | Your "Developer ID Application" certificate exported from Keychain Access as .p12, then `base64 -i cert.p12 \| pbcopy` |
| `MAC_CERTIFICATE_PASSWORD` | The password you set when exporting the .p12 |
| `APPLE_ID` | The Apple ID of your developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | From appleid.apple.com › Sign-In and Security › App-Specific Passwords |
| `APPLE_TEAM_ID` | The 10-character team ID from developer.apple.com › Membership |

All five need an Apple Developer Program membership. The workflow picks them up
on the next release; `build/notarize.cjs` does the notarisation.

## Auto-update

`electron-updater` checks the latest GitHub release of `Tendulkarx/nexus` for
`latest-mac.yml`. Two things stop it working today:

1. The app isn't signed (above).
2. The repo is private, and the updater downloads anonymously. Either make the repo
   public, publish releases to a separate public repo, or point `build.publish` at a
   server you host.

## Limits

- **Apple silicon only.** The vendored FreeRDP is built for the runner's arm64; an
  Intel build would need FreeRDP cross-compiled. The app itself has no other x64
  blocker (node-pty ships both prebuilds).
- **Release PRs don't run CI.** PRs opened with the workflow token don't trigger
  other workflows. They only change the version and changelog, so that's usually
  fine; push an empty commit to the release branch if you want checks on one.
- **Runner minutes.** On a private repo, macOS minutes count 10×, so each release
  build (~10 minutes, longer when FreeRDP isn't cached) uses a noticeable share of
  the free allowance. CI runs on Linux for that reason.

## Building a release locally

```sh
npm run build:native   # optional: RDP
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --publish never
ls dist/   # .dmg, -mac.zip, blockmaps, latest-mac.yml
```
