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

## First run (the setup wizard)

With nothing installed the launcher opens a five-step wizard instead of the full
dashboard — the goal is that someone who has never seen a terminal can get to the
game:

1. **Welcome** — what this is, what it costs you (one file, nothing installed),
   and an aside listing the mods that come with it.
2. **Which revision?** — playable revisions only, the recommended one
   pre-selected and explained ("the one Lost City is developing right now"), three
   visible at a time with the rest a scroll away, client-only branches tucked
   behind a disclosure.
3. **What you're getting** — the three things it will do (download, install
   dependencies, build), plus the mod list when the revision supports LCLite.
4. **Installing** — four named phases with live ticks, the console tail, and a
   real error state (retry / back / open the dashboard) instead of a dead spinner.
5. **You're ready** — Play, a web port field for when 80 is taken, and the way
   into the full launcher. Pressing Play is the last step rather than a dead end:
   once the world answers, the wizard hands you to the launcher by itself (with a
   note saying so), so nobody is left staring at a finished setup screen.

Reloading mid-install picks the install back up where it is. `Skip setup` (or
`Setup guide` later, which re-enters the wizard) toggles between the two views;
both are remembered in `launcher.json`.

### The "recommended" revision

Computed, not hardcoded: **the highest-numbered revision that exists in the
client, engine *and* content repos** — i.e. the branch Lost City is actually
developing. Variant branches (`225-custom`, `225-gpu`, `377-wip`) and client-only
branches (`500`, `jaged`) are never recommended, and the picker explains itself
when a revision has no matching server content. The wizard also shows when that
revision's content branch last moved, so "actively developed" is a fact and not a
claim. Want to lead with a different one (say Lost City cuts a new branch)?
`POST /api/config {"recommended_rev": "300"}` pins it; `""` goes back to
automatic.

## Using it

The dashboard is two columns and one rule: **set up on the left, run it on the
right.** Left: *Lost City revisions* → *Installs* (with the selected install's
card — path, ready/needs-setup, *Update from GitHub*, *Rebuild client*) →
*LCLite mods*. Right: *Server*, then *Join server*. Anything that is real but not
first-run — an existing folder instead of a fresh install, reset-to-pristine, the
bridge port, the three-socket port story, the tree's internals — sits behind a
disclosure with a plain-language label, so the everyday path stays two buttons
and a tick list.

**Every section folds.** Each panel header carries a *Hide* / *Show* toggle, and
what you folded away is remembered in `launcher.json` (`collapsed: ["mods"]`) —
not in `localStorage`, because the UI port is random per run, so a browser-side
preference would reset on every launch. Inside *LCLite mods* the mod list is a
fold of its own, starting at two rows: the panel then answers "which mods do I
have?" at a glance, and *Show all N mods* opens the rest (no inner scrollbar —
one scroll for the page).

1. **Revisions** — the branch list is read live from GitHub (`Client-TS`,
   `Engine-TS`, `Content`) and merged by name. A revision with engine + content
   is playable; client-only branches (e.g. `500`, `jaged`) show as "Client only".
   Branches ending `-wip` / `-node` are treated as internal and hidden. Order is:
   recommended first, then playable newest-first, then client-only.
   The panel shows **one revision at a time** (a 10-branch list was noise in a
   sidebar): step with `▲`/`▼` or the arrow keys, `n / total` tells you where you
   are. This list only **installs** and **reports**: a row either offers *Install*
   or shows a green `✓ installed`, and nothing here selects an install — that
   happens in the installs list, where you also get its mods, update and delete.
2. **Install** — clones the revision into `<data>/installs/<rev>/`. Each install
   row in the sidebar owns its own lifecycle: **Remove** (take it out of the list,
   files untouched, no confirm) and **Delete files** (wipe the cloned revision from
   disk, with a confirm that names the folder it is about to delete) live on the
   row itself, like the revision rows' actions do — there is no separate
   housekeeping panel to hunt through. Both act on **the row you clicked**, never
   on whichever install happens to be selected, and only a folder the launcher
   created can be wiped: a hand-added folder (or a record pointing outside
   `<data>/installs/`) is refused, and a delete that fails leaves the row in place
   so you can retry instead of losing the record with the files still there.

   ```
   <data>/installs/274/
     webclient/   Client-TS @ 274      (browser client source)
     engine/      Engine-TS @ 274      (the world)
     content/     Content   @ 274      (game data)
     lclite/      the overlay copy (the checkout you launched from wins)
   ```

   then `npm install` in `engine/`, then either the LCLite build (the mods for that
   revision, applied + bundled) or a plain `bun run bundle.ts` deploy of `client.js`
   into `engine/public/client/`.

   Install is **idempotent and non-destructive**: a revision that is already
   there keeps its tree exactly as it is (a modded tree is left alone, never
   re-cloned or refused), and only the dependency/overlay/build steps re-run.
   `Update` is the deliberate opposite — it fast-forwards from GitHub and asks
   you to *Reset to pristine* first if the tree is modded.
3. **Existing folder** — point it at any checkout holding `webclient/` and
   `engine/` (a hand-made one, another revision, someone else's tree). It reads
   the revision off the git branch. Nothing is written until you press a button.
   It lives behind *Use an existing folder instead*, because it is the exception
   rather than the way in.
4. **Mods** — their own panel, under the install list (the right-hand column leads
   with the two things you press every day: **Server** and **Join server**). Tick
   boxes, *Apply mods & build*. The required mod (the panel — LCLite itself) shows
   as a locked gold tick rather than a disabled checkbox, because a
   greyed-out box reads as "not included". The list **starts folded to two rows**
   (*Show all 12 mods* opens it) and tracks pending edits: change a tick and the
   button becomes *Apply mods & build \** with a "not applied yet" line, because the
   difference between "ticked" and "built in" is exactly the mistake worth designing
   out. What is ticked lives in the page's own state, not in the visible
   checkboxes, so folding the list can never silently drop a hidden mod from the
   set you are about to apply. *Remove mods* takes every mod back off; *Reset to
   pristine* — the blunt git-level repair — lives behind a "Something's broken?"
   disclosure so it stops competing with it. That's `node tools/lclite.mjs --mods
   <set>`: the listed mods are applied and everything else is stripped, so the tree
   always converges to what the UI shows. The required mod is locked on.
   **Which revisions come with mods is the overlay's call, not the launcher's.**
   The launcher reads `revs.json` out of the overlay checkout (`overlay_revs` in
   `/api/state`) and offers mods on exactly the revisions it declares — the same
   declaration `tools/doctor.mjs` and `tools/matrix.mjs` check, so the UI can never
   drift from what the corpus actually ships. Today that is **289** (where mods are
   authored), **274** (same hunks, byte-identical anchors) and **254** (its own
   ported corpus). A mod the overlay has no hunks for on the selected revision is
   listed with a *not on this revision* tag and a dash instead of a tick — it cannot
   be applied there, and a mod is all-or-nothing per revision because half a mod is
   a broken mod. The section says how many that is and points at
   `node tools/port.mjs <rev>`. [docs/REVS.md](../docs/REVS.md) owns the rule.

   A mod's **name and one-line description are the in-game panel's** (the F1
   panel's mod list): the launcher reads `MOD_META` from `tools/lib.mjs`, which
   mirrors `MOD_REGISTRY` in the control-panel mod, and `node tools/doctor.mjs`
   prints a note when the two wordings drift apart. Order is alphabetical by the
   name you read, like the panel.
5. **Start** — runs `npm run quickstart` in the selected install's `engine/` and
   opens the client; the button says *Start* whatever is selected, and the status
   line above it names the install that is actually serving. The port comes from
   `data/config/world.json` (default 80 on Windows) or from the field in the UI,
   which writes that file. First boot packs the cache and can take minutes; the
   server tab streams the boot log. The port/three-sockets explanation folds away
   under *Ports & running two worlds*.
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

6. **Join server** (the RSProx trick) — running your own world and connecting to
   someone else's are separate jobs, so they get separate panels: **Server**
   (*this machine*, first in the column) and **Join server** (*somewhere else*).
   The everyday path is one field and one button — type the address, press
   *Bridge & play* — with the bridge port and whose client to serve folded under
   *Advanced*. The webclient dials `window.location.host`, so *whatever* answers
   on the other end of the page is "the server" — the launcher can listen on
   localhost and tunnel everything to a remote address:

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
# one platform (a working copy: --version prints "dev")
go build -trimpath -ldflags="-s -w" -o LCLite.exe .

# all shipped targets -> dist/ + SHA256SUMS.txt
go run build.go

# one target, stamped with a version
go run build.go windows -version v0.2.0
```

`-version` (or the `LCLITE_VERSION` env var) stamps the build:
`-X main.launcherVersion=…`, so `LCLite.exe --version` reports `0.2.0`. The release
tag is the source of truth in CI, and a build with no stamp honestly says `dev`.
Cutting a release — one command, plus how to rehearse it — is documented in
[../RELEASING.md](../RELEASING.md).

Requires Go 1.24+ (no cgo, no third-party modules — `go.mod` has zero requires).
`../LCLite.bat` prefers `LCLite.exe` when it sits beside it and falls back to the
Node picker otherwise, so the repo stays usable with or without a build.

## Where things live

```
lclite/                        ← the overlay repo: mods, tools, docs AND this launcher
  LCLite.exe                   ← build output, sits next to ../LCLite.bat
  launcher/                    ← Go source

%LOCALAPPDATA%\LCLite\          ← the launcher's data folder
  installs/<rev>/              ← webclient/ engine/ content/ (+ lclite/ copy)
  launcher.json                ← installs, saved servers, cached branch list, folded sections
  tools/bun/bun.exe            ← bun fetched on demand
```

Nothing needs to be cloned into the repo any more, and the repo doesn't have to sit
inside a Lost City checkout. **Mods come from the checkout the launcher was launched
from** — the overlay next to the exe wins over the copy cloned into each install, so
editing `mods/` here changes what the launcher applies immediately (the mods card
says "from your checkout"; the install's own copy is the fallback when the binary
travels alone). For the CLI, point `LCLITE_ROOT` at an install:

```
LCLITE_ROOT=%LOCALAPPDATA%\LCLite\installs\289 node tools/lclite.mjs doctor
```

An install whose folder has been moved or deleted shows up as **missing** in the
list, with a one-click way to drop the record — it never pretends to be a broken
installation.

## Data layout

| Path | What |
| --- | --- |
| `%LOCALAPPDATA%\LCLite\launcher.json` | installs, saved servers, cached branch list, folded sections |
| `%LOCALAPPDATA%\LCLite\installs\<rev>\` | managed revision checkouts |
| `%LOCALAPPDATA%\LCLite\tools\bun\bun.exe` | bun fetched on demand |

`--data <folder>` moves the whole tree above (the way to test the launcher without
touching real installs).

Override with `--data <folder>`. Flags: `--port`, `--no-browser`,
`--play <rev>` (install if needed, then launch — handy for a desktop shortcut),
`--version`.

## A note on how the UI renders

The page polls `/api/state` every 2.5s, so every block re-renders only when the
data behind it changed (a signature check) and the server card is patched in
place. That is not an optimisation — it is what keeps a poll from un-ticking your
mod boxes or eating a half-typed port. Anything that turns into an input must
respect that, or move to a signature of its own.

## API (for scripting)

All under `/api`, all requiring header `X-LCLite-Token: <token>` (the token is in
the served page). `state`, `revs`, `config` (`{"skip_wizard":true}`,
`{"recommended_rev":"300"}`, `{"collapsed":["mods","revs"]}`), `install`, `import`, `apply`, `build`,
`update`, `reset`, `strip` (take every mod off), `remove` (`{id, wipe}` — `wipe`
deletes the folder and is refused for a hand-added install or one outside
`<data>/installs/`), `run`, `stop`, `open`,
`browse`, `bun`, `proxy/start`, `proxy/stop`, `job`, `log`, `quit`. Long tasks return a job id; poll
`job?id=&since=` for incremental log lines.

## Verified

`go test ./...` covers the two config styles (JSON + dotenv, including "don't
clobber unrelated keys" and "don't duplicate keys on a second write"), the revision
gate (`overlayRevs` / `revSupported` / `modCorpusRev`, including the no-`revs.json`
fallback and the inherit-vs-own-corpus resolution) and the hidden-branch filter for
the revision picker. End to end, on Windows: a fresh **289** install (client + engine
+ content + overlay, `npm install`, 12 mods applied with 0 drift, bundle built and
deployed) boots and serves a working client socket; a fresh **274** install gets all
12 mods from the *inherited* corpus, boots and serves a modded page (`LCLite - 274`);
a fresh **254** install gets the 7 mods it has a corpus for and serves them; the
bridge serves a local build over a remote one and tunnels the socket both ways.

## Known limits

- **225 and 254 do not boot as cloned**: their content branches trip RuneScript
  errors under a current toolchain (`@multi4` in quest_waterfall at 225; `[logout,_]
  ()(boolean)` in `logout.rs2` at 254 — upstream even left a `// TODO: Change compiler
  to remove return value` above it). That is an upstream branch condition, not the
  launcher or the overlay: install/build/patch all succeed and the boot failure is
  reported with the compiler's own error line. Both are one-line content fixes away
  (`git -C <install>/content checkout -- .` undoes one). **274 and 289 boot clean**;
  244/245.2 are untested.
- Windows is the first-class platform (folder picker via PowerShell, bun
  auto-fetch). Linux/macOS build and run; the picker needs `zenity`/`kdialog` and
  bun has to be on `PATH`.
- One server at a time, one long task at a time (the overlay is stateful — two
  concurrent applies on one tree is how you corrupt a tree).
- No auto-update yet; the launcher is small enough to just replace.
- Rev switching on an install with mods applied is refused until you *Reset to
  pristine* — by design, since the overlay's convergence assumes a clean tree.
