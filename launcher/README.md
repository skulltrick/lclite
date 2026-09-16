# LCLite launcher

A tiny native front door for LCLite: pick a Lost City revision, install it,
choose your mods, press **Play**. It replaces the "open a terminal and run
`node tools/lclite.mjs pick`" ritual with a window, and adds the two things the
CLI can't do — running several revisions side by side and pointing a local
(modded) client at somebody else's server.

```
launcher/          <- this source (Go, stdlib only)
  LCLite.exe       <- build output, sits next to ../LCLite.bat (git-ignored)
```

## Why this shape

| Option | Size | Runtime deps | Verdict |
| --- | --- | --- | --- |
| Electron | 150 MB+ | bundled Chromium | no — the thing we're avoiding |
| Tauri/WebView2 | ~5 MB | WebView2, Rust toolchain | fine, but a second toolchain for one small app |
| .NET WinForms | 60 MB+ self-contained | SDK (this box only has the 6.0 *runtime*) | no |
| **Go + embedded page, opened in the browser** | **8.4 MB** | **none (static binary)** | **chosen** |

The launcher is a single static executable. It serves its own UI from
`127.0.0.1` on a random port and opens your default browser at it; the UI is one
HTML file baked into the binary (`go:embed`), no CDN, no npm, no framework. Only
this launcher's own page can drive the API — every `/api/*` call needs the
per-run token that gets injected into the page.

It does *not* bundle Node, npm, bun or git: it detects them (chips in the header)
and installs **bun** on demand if the build needs it (bun is a single ~35 MB zip,
cached under the launcher's data folder). Running a Lost City server needs Node
24+ regardless — that's upstream's requirement, not ours.

## Using it

1. **Revisions** — the branch list is read live from GitHub (`Client-TS`,
   `Engine-TS`, `Content`) and merged by name. A revision with engine + content
   is playable; client-only branches (e.g. `500`, `jaged`) show as "Client only".
   Branches ending `-wip` / `-node` are treated as internal and hidden.
2. **Install** — clones the revision into `<data>/installs/<rev>/`:

   ```
   <data>/installs/289/
     webclient/   Client-TS @ 289      (browser client source)
     engine/      Engine-TS @ 289      (the world)
     content/     Content   @ 289      (game data)
     lclite/      the overlay, 289 only
   ```

   then `npm install` in `engine/`, then either the LCLite build (289) or a plain
   `bun run bundle.ts` deploy of `client.js` into `engine/public/client/`.
3. **Existing folder** — point it at any checkout holding `webclient/` and
   `engine/` (a hand-made one, another revision, someone else's tree). It reads
   the revision off the git branch. Nothing is written until you press a button.
4. **Mods** — tick boxes, *Apply mods & build*. That's `node tools/lclite.mjs
   --mods <set>`: the listed mods are applied and everything else is stripped, so
   the tree always converges to what the UI shows. Required mods are locked on.
   **Mods are offered on revision 289 only** — the hunks are anchored there, and
   `docs/MODS.md` owns that rule. On other revisions the section explains itself
   and the buttons stay disabled.
5. **Play** — runs `npm run quickstart` in the selected install's `engine/` and
   opens the client. The port comes from `data/config/world.json` (default 80 on
   Windows) or from the field in the UI, which writes that file. First boot packs
   the cache and can take minutes; the server tab streams the boot log.
### Ports and revision quirks

The engine binds **three** ports and the launcher owns all three:

| Port | What | Default |
| --- | --- | --- |
| web | the client page + the game socket | 80 (Windows/macOS), 8888 elsewhere |
| game | raw TCP world port (java clients, routefinder) | 43594 |
| management | the `/setup` page | 8898 |

The web port is whatever you type in the UI. If the game or management port is
already taken — i.e. another world is running — the launcher moves that port up
to the next free one and says so in the log, which is what makes two revisions
playable at once (289 on 8889 and 274 on 8891, verified side by side).

Configuration style changed upstream partway through the series, so the launcher
speaks both: **274+** read `data/config/world.json`, **225–254** read a dotenv
file (`WEB_PORT`, `NODE_PORT`, `WEB_MANAGEMENT_PORT`, scaffolded from
`.env.example`). Writing either one preserves every other key.

Old revisions also run their engine on **bun**, not tsx — the launcher puts its
own bun on that process's PATH so a world doesn't die with
`'bun' is not recognized`.

6. **Custom server** (the RSProx trick) — the webclient dials
   `window.location.host`, so *whatever* answers on the other end of the page is
   "the server". The launcher can listen on localhost and tunnel everything to a
   remote address:

   - *Bridge, use their client* — a friendly localhost name for any Lost City
     server (http and the game socket both pass through).
   - *Bridge + Serve my build* — `/client/*` and `/lclite/*` are answered from
     **your** built install instead of the remote's, while everything else (cache
     crcs, the socket) is tunnelled. That is how you play someone else's world
     with your LCLite mods.

   Caveat worth knowing: the engine's `web.allowedOrigin` can pin which Origin a
   socket may come from. A bridged socket arrives as `localhost:<port>`, so a
   server that sets `allowedOrigin` can refuse it. *Open directly* always works;
   it just uses the server's own client.

## Building

```sh
# one platform
go build -trimpath -ldflags="-s -w" -o LCLite.exe .

# all shipped targets -> dist/
go run build.go

# one target
go run build.go windows
```

Requires Go 1.24+ (no cgo, no third-party modules — `go.mod` has zero requires).
`../LCLite.bat` prefers `LCLite.exe` when it sits beside it and falls back to the
Node picker otherwise, so the repo stays usable with or without a build.

## Data layout

| Path | What |
| --- | --- |
| `%LOCALAPPDATA%\LCLite\launcher.json` | installs, saved servers, cached branch list |
| `%LOCALAPPDATA%\LCLite\installs\<rev>\` | managed revision checkouts |
| `%LOCALAPPDATA%\LCLite\tools\bun\bun.exe` | bun fetched on demand |

Override with `--data <folder>`. Flags: `--port`, `--no-browser`,
`--play <rev>` (install if needed, then launch — handy for a desktop shortcut),
`--version`.

## API (for scripting)

All under `/api`, all requiring header `X-LCLite-Token: <token>` (the token is in
the served page). `state`, `revs`, `install`, `import`, `apply`, `build`,
`update`, `reset`, `strip` (take every mod off), `remove`, `run`, `stop`, `open`,
`browse`, `bun`, `proxy/start`, `proxy/stop`, `job`, `log`, `quit`. Long tasks return a job id; poll
`job?id=&since=` for incremental log lines.

## Verified

`go test ./...` covers the two config styles (JSON + dotenv, including "don't
clobber unrelated keys" and "don't duplicate keys on a second write"). End to
end, on Windows: a fresh **289** install (client + engine + content + overlay,
`npm install`, 9 mods applied with 0 drift, bundle built and deployed) boots and
serves a working client socket; a fresh **274** install boots and runs *next to*
that 289 world; the bridge serves a local build over a remote one and tunnels the
socket both ways.

## Known limits

- **225 does not boot**: its content branch trips RuneScript type errors
  (`@multi4` in quest_waterfall) under a current toolchain. That is an upstream
  branch condition, not the launcher — install/build/patch all succeed, and the
  boot failure is reported with the compiler's own error line. 274 and 289 are
  verified working; 244/245.2/254 are untested.
- Windows is the first-class platform (folder picker via PowerShell, bun
  auto-fetch). Linux/macOS build and run; the picker needs `zenity`/`kdialog` and
  bun has to be on `PATH`.
- One server at a time, one long task at a time (the overlay is stateful — two
  concurrent applies on one tree is how you corrupt a tree).
- No auto-update yet; the launcher is small enough to just replace.
- Rev switching on an install with mods applied is refused until you *Reset to
  pristine* — by design, since the overlay's convergence assumes a clean tree.
