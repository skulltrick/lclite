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
| **Go + embedded page, opened in its own app window** | **8.4 MB** | **none (static binary)** | **chosen** |

The launcher is a single static executable. It serves its own UI from
`127.0.0.1` on a random port and opens it in its own window — a Chromium-family
browser's `--app` mode, no tabs and no address bar (see below); the UI is one
HTML file baked into the binary (`go:embed`), no CDN, no npm, no framework. Only
this launcher's own page can drive the API — every `/api/*` call needs the
per-run token that gets injected into the page.

It does *not* bundle Node, npm, bun or git: it detects them (chips in the header)
and installs **bun** on demand if the build needs it (bun is a single ~35 MB zip,
cached under the launcher's data folder). Running a Lost City server needs Node
24+ regardless — that's upstream's requirement, not ours.

**The dashboard opens in its own window.** It is a web page, so a standalone window is
a Chromium-family browser's own `--app` mode: no new dependency, no cgo, no second
toolchain, and the same 8.4 MB static binary — the honest middle ground between "a
tab" and a WebView2/Tauri rebuild. A tab is one flag away (`--browser`), and the
fallback whenever there is no Edge or Chrome to be found.

### Its own window (the default)

`LCLite.exe` opens the dashboard in a window with no tabs and no address bar, its own
taskbar entry and its own icon. Nothing else changes: the same page, the same `/api`
surface, the same single binary.

| | |
| --- | --- |
| Which browser | Edge first (it ships with Windows), then Chrome, then a portable one on `PATH`; the macOS app bundles, then `microsoft-edge`/`google-chrome`/`chromium`/… on Linux |
| Profile | `<data>/window` — private to the launcher, so the window is its own browser process: it never touches your real profile, and quitting it can never close your tabs |
| Size | 1180×800, wide enough for the two columns |
| Override | `LCLITE_APP_BROWSER=<path>` for a portable browser — a wrong path is an error, never a silent fallback |
| No Edge/Chrome at all | says so, then opens your default browser — the app window is the default, not a promise |
| `--browser` | a browser tab instead (`-window=false` says the same thing) |
| `--no-browser` | nothing at all, and it beats both of the above — the headless recipe depends on it |

**Closing the window closes the launcher — but only when nothing is running.** The
page's own polls (`/api/state` every 2.5s, `/api/log` every 0.9s) are the heartbeat,
so a window counts as gone after ~25 seconds of silence, and a world, a bridge or a
job in flight keeps the launcher alive regardless: closing a window must never stop a
server you asked for. When that happens the console says so once — the console is the
way back to that UI (it prints the URL), and Ctrl-C there stops everything.

## First run (the setup wizard)

With nothing installed the launcher opens a five-step wizard instead of the full
dashboard — the goal is that someone who has never seen a terminal can get to the
game:

1. **Welcome** — what this is, what it costs you (no runtime, nothing installed),
   and an aside stating the one promise that matters: the mods are one overlay you
   can switch off, written for the primary revision and ported to the rest.
2. **Which revision?** — playable revisions only, the recommended one
   pre-selected and explained ("the one Lost City is developing right now"), three
   visible at a time with the rest a scroll away, client-only branches tucked
   behind a disclosure. Each card says how much of the mod set that revision really
   gets: the full set, some of it, or none.
3. **What you're getting** — the three things it will do (download, install
   dependencies, build).
4. **Installing** — four named phases with live ticks, the tail of the console, and a
   real error state (retry / back / open the dashboard) instead of a dead spinner.
5. **You're ready** — Play, a web port field for when 80 is taken, and the way
   into the full launcher. Pressing Play is the last step rather than a dead end:
   once the world answers, the wizard hands you to the launcher by itself (with a
   note saying so), so nobody is left staring at a finished setup screen.

Reloading mid-install picks the install back up where it is. `Skip setup` (or
`Setup guide` later, which re-enters the wizard) toggles between the two views;
both are remembered in `launcher.json`.

The Welcome slide's **"N revisions available"** counts the revisions the overlay
mods *end to end* — every mod has hunks for it, its own corpus or one it inherits
(`fullyModdedRevs`, read from the overlay's corpus layout, never hardcoded). A
revision that is supported but only partly ported is not counted and is not named
in the aside, so the number can never promise more than you would get; port the
rest of the corpus and it appears on its own. With no overlay checkout to read,
the chip is not shown at all rather than guessed at.

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

The dashboard is **one console across the top, then two columns**: **set up on the
left, run it on the right.** Left: *Lost City revisions* → *Installs* (with the
selected install's card — path, ready/needs-setup, *Update from GitHub*, *Rebuild
client*) → *LCLite mods*. Right: *Your Server* (the world on this machine, and the
characters on it) and *Join Server* (somebody else's, with your client — see 6
below).
Anything that is real but not first-run — an existing
folder instead of a fresh install, reset-to-pristine, the local port, the
three-socket port story, the tree's internals — sits behind a disclosure with a
plain-language label, so the everyday path stays two buttons and a tick list.

**The header carries the one question about LCLite itself: is there anything new?**
*Check for update* asks the LCLite repo whether there are newer mods, tools or page
assets than the overlay you are running, and then says what it found in one word:

| Button | What it means |
| --- | --- |
| *Check for update* | nothing has been asked yet — press it |
| *Update* | the repo has commits this checkout does not — press to pull them |
| *Up-to-date* | nothing to pull (greyed out) |
| *Offline* | the repo could not be reached — press to try again |
| *No overlay* | this launcher has no LCLite checkout to update (greyed out) |

The check is a `git fetch` of the overlay's own branch, so it writes to `.git` and
never to the working tree, and the answer is remembered in the launcher rather than in
the page — a reload shows the button it was showing instead of asking again. *Update*
refuses outright when the checkout has uncommitted changes or commits of its own: the
launcher does not throw away work it did not make. It updates the **overlay** only —
an install keeps the mods it was built with until you press *Apply changes* on it.
*Refresh branches*, which used to sit in this spot, now lives in the *Lost City
revisions* header, next to the list it refreshes.

**The console is one feed, at the top.** There used to be three tabs (Task /
Server / Bridge) and you had to guess which one a line landed in; now every
producer writes into a single ordered stream and each line carries the producer it
came from, so an install, the world it starts and a bridge are one history you can
read straight through (a finished job's output stays on screen while the next
thing runs). It is deliberately small — a 160px window that follows the tail — and
it is the one place you can *work* with the log: **click a line to copy it** (links
in a line are links), **type in the filter** to keep only matching lines (it matches
the text and the producer, and says how many it kept), scroll up and it **stops
following** the tail until you press *Latest ↓*, and *Hide* collapses it to its
header. Merging happens in the launcher, not in the page: three rings polled
separately would arrive in poll order, so the order here is the order things
happened.

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
   with the two things you press every day: **Your Server** and **Join Server**). Tick
   boxes, then *Apply changes*. The required mod (the panel — LCLite itself) shows
   as a locked gold tick rather than a disabled checkbox, because a
   greyed-out box reads as "not included". The list **starts folded to two rows**
   (*Show all N mods* opens it) and tracks pending edits: change a tick and the
   button becomes *Apply changes \** with a "not applied yet" line, because the
   difference between "ticked" and "built in" is exactly the mistake worth designing
   out. What is ticked lives in the page's own state, not in the visible
   checkboxes, so folding the list can never silently drop a hidden mod from the
   set you are about to apply. That's `node tools/lclite.mjs --mods <set>`: the listed
   mods are applied and **everything else is stripped**, so the tree always converges
   to what the UI shows — which is why there is one button here and not two. Unticking
   a mod and pressing *Apply changes* takes it off; there is nothing a separate
   "remove" could do that this does not. The panel mod (LCLite itself) is locked on, so
   "none at all" is not a state the panel can ask for — for a bare upstream tree
   use *Reset to pristine* below, or `POST /api/strip` from a script. *Reset to
   pristine* — the blunt git-level repair — lives behind a "Something's broken?"
   disclosure so it stops competing with the everyday button.
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

   **A mod folder IS a mod** — the list is a directory scan of the overlay
   checkout's `mods/`, so dropping a folder in is the whole install story for a
   new mod (`node tools/lclite.mjs new <name>` scaffolds a working one from
   `mods/_template/`). A folder with no `MOD_META` entry still lists: its label
   is the folder name and its description is the first non-heading line of its
   README. Folders whose names start with `_` or `.` are not mods and never
   appear — that is how the layout example lives in the repo without being
   installable. **Available** means the mod can actually deliver on the selected
   revision: it has hunks for it (its own corpus, or one it inherits) *or* a
   `files/` payload, which is copied verbatim on every revision. Both halves
   matter: a files/-only mod has no anchors to rot and must not be greyed out as
   "no hunks for this revision". [docs/MAKING-A-MOD.md](../docs/MAKING-A-MOD.md)
   owns the contract; `node tools/selfcheck.mjs` asserts it.
5. **Start** — runs `npm run quickstart` in the selected install's `engine/` and
   opens the client; the button says *Start* whatever is selected, and the status
   line above it names the install that is actually serving. The port comes from
   `data/config/world.json` (default 80 on Windows) or from the field in the UI,
   which writes that file. First boot packs the cache and can take minutes; the
   console at the top of the page streams the boot log, tagged `world`. The
   port/three-sockets explanation folds away
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

6. **Join Server** (the RSProx trick) — running your own world and joining
   somebody else's are separate jobs, so they get separate panels: **Your Server**
   (*this machine*, first in the column) and **Join Server** (*somewhere else*).

   The panel has **one verb and one way to name the target**: type the address.
   That ends in one place — **your own built client**, mods and all, bridged to that
   server, opened for you in your browser. There is no "whose client" choice, no
   *Open directly* and no stop button, because none of them is a decision a player
   wants to make here:

   - **your client is always the one served — and it is the default, not an
     option.** The webclient dials `window.location.host`, so the launcher listens
     on a localhost port and answers `/client/*` and `/lclite/*` from **your**
     install while everything else (cache crcs, the game socket) is bridged to the
     remote. That is how your mods follow you onto someone else's world, and it is
     the only reason to use this panel instead of a browser tab. `proxy/start`
     takes `local_client` as an optional field that means *yes* when it is absent,
     so a script cannot accidentally serve the host's build; passing `false` is
     still possible and the bridge log says so out loud.
   - **joining opens YOUR client, automatically.** The bridge's own address
     (`http://localhost:<port>/rs2.cgi`) is handed to the browser as soon as the
     tunnel is up — never the host's URL. `--no-browser` turns the launcher's own
     window-opening off, including this one.
   - **while you are joined, the setup is folded away.** The address field and the
     *Join* button disappear — an address box next to a live connection asks a
     question you have already answered. What replaces them is the **joined card**:
     the address the bridge really dials, what you are serving (the install and the
     mods its tree really has applied), an *Open your client* button and *Leave*.
   - **Join again to retarget.** A second *Join* while a bridge is up points it at
     the new address rather than asking you to stop the old one first; *Leave* on
     the joined card closes the tunnel and brings the setup back.
   - **A server that refuses LCLite clients is a browser job, not a launcher job.**
     The engine's `web.allowedOrigin` can pin which Origin a socket may come from,
     and a bridged socket arrives as `localhost:<port>`, so a server that sets it
     can refuse the bridge. The honest answer is the server's own webclient in a
     browser — not a second button in here pretending to be a mode.

   What the panel tells you before you press *Join*: which install it would serve
   and **how many mods that tree really has applied** (read from the install's own
   `installed.json`, not from the ticked boxes).

   **Nothing is negotiated with the far end, and the panel does not pretend
   otherwise.** A bridge is an address and a tunnel: there is no handshake, no
   directory service and no claim about what the server on the other side is
   running. So the joined card describes *your* half — the address, and the build
   you are serving — because that is the half this launcher can actually see.

   *Your characters — the save vault* lives under **Your Server**, next to the
   world it describes. It shows the characters that world has, flags a file the
   engine would refuse (magic `0x2004`, version, CRC-32), and gives you one button:
   **Open save folder**. See 7 below for why there is nothing else.
7. **Your characters** — the save section, under **Your Server**, and deliberately
   almost nothing: the characters that world has, whether each file passes the
   engine's own integrity rule, and **Open save folder**.

   **The vault is gone, on purpose.** It used to copy a character out of a world
   into `%LOCALAPPDATA%\LCLite\saves\<world>` and import one back. That was never
   really a feature: a character is a file on the **host's** disk
   (`engine/data/players/<profile>/<username>.sav`, written by their login server),
   the client never sees it, and a copy only means anything on a world that already
   has your name on it — with that world's revision and item ids. Offering "bring
   your character" invited people to overwrite live progress with a stale backup,
   which is exactly the accident the guard rails were there to catch. So the honest
   version is what shipped: **show the files, hand you the folder.** Copying,
   restoring, deleting and backing up are Explorer's job, and a launcher that
   deletes a player's character is a bug waiting to happen.

   The integrity rule stayed, because it is genuinely useful: magic `0x2004`, the
   version, and the CRC-32 trailer, so a damaged file is flagged in the list before
   a world has to deal with it. It says "not corrupt", never "earned".

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
  launcher.json                ← installs, cached branch list, folded sections
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
| `%LOCALAPPDATA%\LCLite\launcher.json` | installs, cached branch list, folded sections |
| `%LOCALAPPDATA%\LCLite\installs\<rev>\` | managed revision checkouts |
| `%LOCALAPPDATA%\LCLite\tools\bun\bun.exe` | bun fetched on demand |

An older `launcher.json` still loads: the world-list, host-draft and signing-key
fields the Worlds feature used are simply ignored, and drop out of the file on the
next write. Nothing else in it changes.

A character is **not** here: it lives in the world's own tree
(`installs/<rev>/engine/data/players/<profile>/`), which is why the launcher shows
you the folder instead of keeping a copy. `%LOCALAPPDATA%\LCLite\saves\` may still
hold folders from the removed vault; nothing reads them any more, and they are left
alone rather than deleted.

`--data <folder>` moves the whole tree above (the way to test the launcher without
touching real installs).

Override with `--data <folder>`. Flags: `--port`, `--no-browser` (the launcher opens
no window at all — its own dashboard *and* your client after a join), `--browser` (the
dashboard in a browser tab instead of its own app window — see above; `--window` is on
by default), `--play <rev>` (install if needed, then launch — handy for a desktop
shortcut), `--version`.

## A note on how the UI renders

The page polls `/api/state` every 2.5s, so every block re-renders only when the
data behind it changed (a signature check) and the server card is patched in
place. That is not an optimisation — it is what keeps a poll from un-ticking your
mod boxes or eating a half-typed port. Anything that turns into an input must
respect that, or move to a signature of its own.

The Join panel is the sharpest case of it, because it is the one block that holds
an input *and* changes shape: the setup half (address, Join button, local port) is
only ever shown or hidden, never re-rendered, so a half-typed
address survives the poll; the joined card is rebuilt only when the proxy state
behind it changes, keyed on its own signature.

The console is the other one: it sits outside the re-rendered blocks entirely (it is
in the shell, above the grid), so its filter box keeps what you typed through every
poll, and its body is filled by appending the lines `/api/log` hands over. It is
rebuilt only when the whole view is (coming back from the wizard), and then it
replays what it already had — a log that empties itself when you glance at the
setup guide would be worse than no log.

## API (for scripting)

All under `/api`, all requiring header `X-LCLite-Token: <token>` (the token is in
the served page). `state`, `revs`, `config` (`{"skip_wizard":true}`,
`{"recommended_rev":"300"}`, `{"collapsed":["mods","revs"]}`), `install`, `import`, `apply`, `build`,
`update`, `reset`, `strip` (take every mod off), `remove` (`{id, wipe}` — `wipe`
deletes the folder and is refused for a hand-added install or one outside
`<data>/installs/`), `run`, `stop`,
`browse`, `bun`, `overlay/check`, `overlay/update`, `proxy/start`, `proxy/stop`,
`job`, `log`, `quit`. Long tasks return a job id; poll
`job?id=&since=` for a job's status and step (its lines arrive on `log`).

`apply` takes `{id, mods}` and is **convergent**: the listed mods are applied and every
other mod is stripped. `mods` is a pointer on purpose — an **absent** field means "the
default set" (every mod, what a bare `node tools/lclite.mjs` applies), while an
**empty array** means "none of them" and strips the tree. The panel never sends the
empty form (its required mod is locked on), but a script can, and `strip` is the same
verb spelled out.

The update button is two calls: `overlay/check` (a fetch of the overlay's own branch
plus a comparison — the answer is the response, and it is also kept for `/api/state`'s
`overlay` block: `{state, behind, ahead, dirty, shallow, head, remote, path, branch,
note}`, where `state` is `update` / `uptodate` / `offline` / `none`) and
`overlay/update` (a job that pulls, refusing a checkout with uncommitted changes or
commits of its own). `shallow` marks a launcher install's `--depth 1` clone, where git
cannot count commits, so `behind` reads "at least one".

`log?since=` is **the one console**: every producer's lines (jobs, the world, the
bridge), in the order they were written, behind a single monotonic cursor, each
tagged `{n, src, text, at}` with `src` = `task` / `world` / `bridge`. There is no
`which=` any more — a caller that wants one producer's lines filters on `src`, which
is also what the page's filter box does. A job's own `job?id=&since=` view still
exists for its status/step, and the per-producer rings behind the scenes still
answer `tail()` (explaining a process exit).

`proxy/start` takes `{url, port, id, local_client?}`. `local_client` is
**optional and means yes** — your build is served unless a script explicitly says
`false` (a plain bool would have made "absent" mean "serve theirs"). The address is
the whole of the join: nothing is negotiated with the far end, so `/api/state`'s
`proxy.joined` describes the bridge's own target and what this end is serving
(`{addr, install, mods, since}`) — never a claim about the server on the other side.

Saves:

| Endpoint | What |
| --- | --- |
| `saves` | `?install=` — the characters in an install, each checked for integrity, plus the folder they live in |
| `saves/reveal` | `?install=` — open that folder in the desktop's file manager (creates it if the world has never been logged into) |

Removed, not hidden (they answer 404): `saves/import`, `saves/export`,
`saves/browse`, `vault` (the save vault), and the entire Worlds surface —
`worlds`, `worlds/add`, `worlds/remove`, `worlds/favorite`, `worlds/refresh`,
`worlds/check`, `world/publish`. `worlds/note` and `world/unpublish` went before
them, having nothing in the UI that read them.

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

The join/bridge pass was verified against a **live launcher and a stub remote**, not
against mocks:

- **Your client is the one served, and everything else is tunnelled.** With a bridge
  up, `/client/client.js` and `/lclite/installed.json` came back from the picked
  install's own tree while a plain path came back from the remote — read through the
  bridge's own port, not off the panel.
- **`local_client` defaults to your build**: a `proxy/start` with no such field logs
  *serving the local client bundle from …* and reports `local_client: true`; an explicit
  `false` logs *serving the REMOTE's own client* and says so in the bridge log.
- **Joining opens YOUR client, not the host's.** Proven by running the launcher with a
  `cmd.exe` test double first on `PATH`: on startup it asks to open its own dashboard,
  and on a join it asks to open `http://localhost:<bridge>/rs2.cgi` — the bridge's
  address. With `--no-browser` the same join asks for nothing at all. (The launcher
  only ever *asks*; the OS opens it.)
- **The joined card describes this end, and only this end** — the address the bridge
  dials, the install it is serving, and the mods that tree really has applied (read
  from `engine/public/lclite/installed.json`, not from ticked boxes). Pinned by
  `TestJSONKeysTheUIActuallyReads`, which also asserts a stopped bridge reports no
  `joined` at all, and read back out of the live DOM.
- **The setup is hidden while joined and comes back on *Leave*** — verified in the DOM
  (`display:none` → shown, card emptied, `proxy.joined` gone). Pressing *Join* again
  retargets a live bridge rather than refusing because one is up, and an empty address
  is refused with a sentence instead of being silently ignored.
- **Saves** — the integrity rule was derived from the engine's reader and then
  **checked against every save in the live installs (19/19 pass)**; edited, truncated,
  wrong-magic, future-version and corrupted-trailer files are each refused, and the
  listing reports the folder a character really lives in. In the DOM, a deliberately
  damaged save beside a good one lists with a `damaged` tag and the checksum reason.
  `saves/reveal` was driven against a real install: it returns the folder it opened,
  and creates it on a world nobody has logged into yet
  (`TestEnsureSaveDirCreatesTheFolder`).
- **The Go↔JS contract is pinned**: the JSON keys the page reads are asserted, because
  a rename there does not fail loudly. That test exists because it already caught one —
  the join panel read `address` while the payload shipped `addr`, so a target showed
  its address and then refused to join it.
- **The removed surface really is gone**: every Worlds endpoint answers 404 from the
  running launcher, and `TestWorldEndpointsAreGone` pins that — alongside the
  endpoints that must still route.

The update button was verified against **real git repos in temp dirs and a live
launcher**, not mocks:

- **The four answers are the state machine.** A launcher running from a checkout level
  with its origin showed *Up-to-date* (greyed out, tooltip naming the path and the
  commit); a checkout behind its origin showed *Update*; an overlay whose origin does
  not exist showed *Offline* with git's own sentence in the tooltip, the toast and the
  console; a launcher with no overlay anywhere showed *No overlay*, greyed out. All
  read back out of the live DOM, on a page whose 2.5 s poll was running.
- **The check writes nothing to the working tree** (`git status` identical before and
  after, in both clone shapes), and **a fetch on a complete clone does not shallow-ify
  it** — `--depth 1` is only ever asked for on a clone that already is one
  (`TestOverlayCheckReportsWhatIsNew`).
- **The full loop lands files**: a shallow overlay one commit behind pulled its new
  file onto disk, the console showed the `checkout -B main FETCH_HEAD`, and the button
  went *Update* → *Updating…* → *Up-to-date @ <sha>*
  (`TestOverlayUpdatePullsTheNewFiles`, plus the same run in the browser).
- **It refuses to destroy work**: a checkout with uncommitted changes, and one with
  commits of its own (no fast-forward possible), both fail with a sentence naming the
  reason, and the local files are still there afterwards
  (`TestOverlayUpdateRefusesToClobberLocalWork`,
  `TestOverlayUpdateWillNotForceAForkedCheckout`). A checkout that is *ahead* reads
  *Up-to-date* rather than offering a pull that would refuse.
- **The overlay target falls back to an install's own copy** when the launcher lives
  alone (the portable exe), and follows that copy's origin.
- **Applying with nothing ticked really strips** — through the live HTTP API, `apply
  {mods: []}` ran `node tools/lclite.mjs uninstall`, while `apply` with the field absent
  ran the default set (`--mods …`); pinned by `TestApplyWithNothingTickedStripsEveryMod`
  against a recording fake overlay. In the panel, *Apply changes* is the only button in
  that row, and unticking a mod and applying strips it.

The overlay gate for the new `web.ts` hunk was the full one: `apply --check` ✗0,
`regen` twice byte-identical, `doctor` 0, **only `control-panel`'s patch JSON changed**,
`matrix` green on all three revisions (274's `inherits` claim survives), and
`acceptance.sh` byte-identical with a stable converge round-trip.

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
- No auto-update for the launcher **binary** yet — the header's *Check for update* pulls
  the LCLite overlay (mods, tools, page assets), not this exe, which is small enough to
  just replace.
- Rev switching on an install with mods applied is refused until you *Reset to
  pristine* — by design, since the overlay's convergence assumes a clean tree.
- **A server that pins `web.allowedOrigin` can refuse a bridged socket**, and there is
  deliberately no "open directly" fallback in the panel any more: the answer to "this
  server will not take my client" is that server's own webclient in a browser, not a
  second button in the launcher pretending to be a mode. Everything the launcher's
  Join does is bridge *your* build; if that is not wanted, the launcher is the wrong
  tool for that server. (The bridge can still be told to serve the host's build with
  `local_client:false` on `/api/proxy/start`, for a script that wants the raw tunnel —
  the panel never asks for it.)
- **Nothing is negotiated with the server you join.** The bridge is an address and a
  tunnel: the launcher cannot tell you what revision that world runs, whether your mod
  set suits it, or who is behind it, and it does not guess. If you are joining a world
  whose build matters to you, ask its owner.
- **The engine's management port is still the real security finding here, and the
  launcher no longer warns about it.** `/setup` has **no authentication** upstream and
  `PUT /setup/config` rewrites the world's own config; the overlay's control-panel mod
  binds it to **loopback by default** (see `mods/control-panel`) and
  `MANAGEMENT_HOST=0.0.0.0` opts back out. The launcher used to refuse to *list* a
  world while that page answered on a LAN address — a check that went with the Worlds
  feature, since it existed to stop a host publishing a foot-gun. Do not forward that
  port.
- **A save is a file on the host's disk and the launcher does not move it.** It used
  to (the vault), and that was the wrong shape: a character is bound to a username
  *and* to a revision (item ids and varps differ between branches), so a copy only
  means anything on a world that already has your name on it. The launcher shows you
  the characters a world has, tells you when a file is damaged, and opens the folder;
  copying a character between worlds is a manual file operation between hosts, and
  the engine's own rules (a save whose playtime went backwards is refused) apply when
  you do it.
- **The integrity check is a checksum, not a signature.** It says a file is not
  corrupt; it cannot say a character was earned. `%LOCALAPPDATA%\LCLite\saves\` may
  still hold folders from the removed vault — nothing reads them, and they are left
  alone.
- **One install carries one mod set**, so playing two worlds with different expectations
  of your client can mean a full apply-and-rebuild between them. The bridge already
  chooses which bundle to serve (`/client/*`), so per-target built bundles are the
  obvious next step; a mod that patches the *engine* (LCLite's own panel) can never be
  swapped that way, because the host's server has to have it too.
