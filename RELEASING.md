# Releasing LCLite

The whole release is one command:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

That is it. `.github/workflows/launcher-release.yml` builds every platform, runs the
gates below, and publishes the release with the binaries attached. **The tag is the
version** — nothing else to bump.

## What the workflow does

1. **Version** — from the tag (`v0.2.0` → `0.2.0`). A manual run with no version gets
   `dev-<short sha>`.
2. **Vet + unit tests** (`go vet ./...`, `go test ./...` in `launcher/`).
3. **Build all six targets** via `go run build.go -version <v>`: Windows amd64/arm64,
   Linux amd64/arm64, macOS amd64/arm64. It also writes `dist/SHA256SUMS.txt`.
4. **Smoke-test the artifact** — the freshly built Linux binary must print the version
   it was stamped with, answer `--help`, and **boot and serve its own UI** on a
   localhost port. This is the gate that catches "it compiles but does not run".
5. **Package the portable drop** — `LCLite-portable-windows-amd64.zip` containing
   `LCLite.exe`, `LCLite.bat`, `READ-ME-FIRST.txt` and the checksums, so a Windows
   player can unzip and double-click instead of coping with a bare binary.
6. **Publish** — attaches every binary, the zip and `SHA256SUMS.txt`.

Any failed gate stops the publish; the build artifacts are still uploaded so you can
download what broke.

## Rehearsing without publishing

Actions → **launcher-release** → *Run workflow*:

| dry_run | version | Result |
|---|---|---|
| on (default) | — | build + smoke test, **artifacts only**, nothing public |
| off | `v0.2.0` | a **draft** release you can inspect, then publish by hand |

Rehearse the whole thing before the first real release: run it once with `dry_run`
on, download the artifact, and unzip it somewhere to try. Then run with `dry_run` off
to get a draft you can look at on the releases page.

## Versions

- **Tag = version.** `v0.2.0` in git shows up as `0.2.0` in `LCLite.exe --version`,
  the release title, and the window title.
- A build with no version — a plain `go build`, or `go run build.go` — prints `dev`,
  so nobody mistakes a working copy for a release.
- Stamping happens with `-X main.launcherVersion=…` (`launcherVersion` in `state.go`
  is a `var` for exactly this reason; it cannot be a `const`).
- Adding a version locally:

  ```sh
  cd launcher
  go run build.go -version v0.2.0        # all platforms -> launcher/dist/
  go run build.go windows -version v0.2.0 # just Windows
  ```

- **Use a new number, don't move a published tag.** If a release is broken, publish
  `v0.2.1` rather than deleting and re-tagging `v0.2.0` — moved tags confuse caches and
  anyone who already downloaded it. (Deleting a tag whose release never went public is
  fine: fix, then re-tag.)

## Before you tag

- [ ] Repo clean, everything pushed (`git status`, `git log origin/main..main`).
- [ ] `go vet ./...` and `go test ./...` green in `launcher/`.
- [ ] The corpus is current: `LCLITE_ROOT=<install> node tools/doctor.mjs` exits 0
      (a stale pin is fine, real drift is not — see CONTRIBUTING).
- [ ] `launcher/README.md` and the release notes still describe what ships; anything
      user-visible that changed should be in the release body.
- [ ] The portable drop's `READ-ME-FIRST.txt` is still accurate — it is the first
      thing a new player reads.

## What players need (and why the notes say so)

A downloaded launcher still needs two things on the machine, because it clones and
builds Lost City locally:

| Tool | Why | Where |
|---|---|---|
| **Git** | downloads each revision | https://git-scm.com/downloads |
| **Node.js LTS** | runs the mod engine (`tools/lclite.mjs`) | https://nodejs.org |

`bun` is fetched and kept by the launcher itself. If Git or Node.js is missing, the
dashboard's tool list names it and links to it, and an install now stops with a plain
"git is not installed" message rather than a raw git error.

The binaries are **not code-signed**, so SmartScreen warns on first run; the release
notes tell players to use *More info → Run anyway*, and `SHA256SUMS.txt` lets them
verify the download first.

## Repo hygiene

`LCLite.exe` and `launcher/dist/` are gitignored on purpose — releases are the only
place a binary should live. Git history is append-only, so a committed 8 MB binary
would sit in every clone forever.
