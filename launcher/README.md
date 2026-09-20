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
*LCLite mods*. Right: *Your Server* (the world on this machine, and the characters
on it), *Join Server* (somewhere else), then *Worlds*
(the list — see 7 below). Anything that is real but not first-run — an existing
folder instead of a fresh install, reset-to-pristine, the local port, the
three-socket port story, the tree's internals — sits behind a disclosure with a
plain-language label, so the everyday path stays two buttons and a tick list.

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

6. **Join Server** (the RSProx trick) — running your own world and joining
   somebody else's are separate jobs, so they get separate panels: **Your Server**
   (*this machine*, first in the column) and **Join Server** (*somewhere else*).

   The panel has **one verb and two ways to name the target**. Type the address —
   or paste an invite code, which is the same thing plus the host's signed
   description of it. Both end in the same place: **your own built client**, mods
   and all, bridged to that server, opened for you in your browser. There is no
   "whose client" choice, no *Open directly* and no stop button, because none of
   them is a decision a player wants to make here:

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
     tunnel is up — never the host's URL, which is what the pre-one-verb launcher
     did when *Serve my build* was left on "no". `--no-browser` turns the
     launcher's own window-opening off, including this one.
   - **while you are joined, the setup is folded away.** The address field, the
     invite-code field, the *Join* button and the local-port block disappear — an
     address box next to a live connection asks a question you have already
     answered. What replaces them is the **joined card**: the host's own name and
     description, their revision, host name and mod rules, the signature
     fingerprint when there is one, plus what you are serving (the install and the
     mods its tree really has applied), an *Open your client* button and *Leave*.
     A server nobody has described shows its address and says **undescribed**
     rather than inventing a name for it.
   - **Join again to retarget.** A *Join* on a world card (or a pasted code) while
     a bridge is up points it at the new address rather than asking you to stop the
     old one first; *Leave* on the joined card closes the tunnel and brings the
     setup back.
   - **A server that refuses LCLite clients is a browser job, not a launcher job.**
     The engine's `web.allowedOrigin` can pin which Origin a socket may come from,
     and a bridged socket arrives as `localhost:<port>`, so a server that sets it
     can refuse the bridge. The honest answer is the server's own webclient in a
     browser — not a second button in here pretending to be a mode.

   What the panel tells you before you press *Join*: which install it would serve
   and **how many mods that tree really has applied** (read from the install's own
   `installed.json`, not from the ticked boxes). What it tells you after: the
   mod-rule verdict, the build digest, whether the revisions match, and the joined
   card above. Pasting a code **adds that world to your list** as part of joining
   it, and a code for **your own** world is recognised rather than stored (the list
   already leads with it, and you are not a guest on your own server).

   *Your characters — the save vault* lives under **Your Server**, next to the
   world it describes. It shows the characters that world has, flags a file the
   engine would refuse (magic `0x2004`, version, CRC-32), and gives you one button:
   **Open save folder**. See 8 below for why there is nothing else.
7. **Worlds** — the list, and nothing else: a world is somebody's Lost City server
   plus a small **signed description** of it (a name, a one-line description, an
   address, the revision, which mods it wants or forbids). There is **no directory
   service** — a world travels as an *invite code* you paste into *Join Server*,
   and the list lives entirely in your own `launcher.json`. Nothing is uploaded
   anywhere. This panel is where a public directory of worlds would land later; it
   is deliberately just cards so that adding one is a data change, not a redesign.

   The list leads with **this machine** (start/stop it right there), then your
   **favorites**, then whatever is online, then the rest. A favorite is pinned: it
   stays visible while it is offline, because a world you care about going down is
   exactly when you want to see it. Offline non-favorites fold away behind one
   line rather than disappearing. Each card carries **Join** (the same join as the
   panel above), *Copy code* and *Forget*; *Check which are online* probes them all
   on demand — never on the 2.5 s state poll.

   **Listing your own world** (*List my world*) sits under **Your Server**, with
   the world you run: fill in a name, a description, an address and its mod rules,
   then hand out a signed code. The signature is what makes a code worth trusting:
   a code edited on its way to you is **refused**, not trusted (verified — editing
   the address in a real code and re-submitting it fails with
   `signature does not match this manifest`). Your launcher's key is created once
   and its fingerprint is shown, so the same world keeps the same identity across
   re-listings, and re-adding a code you already have **updates** it in place
   instead of duplicating it.

   **Mod rules are a gate, not enforcement** — and the UI says so. The client is
   JavaScript the host serves, so a determined player can always lie about what
   they are running. What the launcher *can* do honestly:

   - **forbidden + present → refused.** You are told which mods, and offered a
     one-click *turn them off & rebuild*.
   - **wanted + missing → warned, and you may still join.**
   - The check reads **what the tree actually has** (`engine/public/lclite/installed.json`),
     not what the mods panel had ticked, and reports the **digest of the client
     build** you would serve. A typed address is gated the same way: if it is the
     address of a world you have, that world's rules apply; if nobody has described
     it to you, the answer is just "here is the build you would serve", said out
     loud rather than dressed up as a rule check.

   **What is provable, and what is not.** Provable: a code was not edited after the
   host signed it; a save file is intact; the digest identifies the build you have.
   Not provable: that a player is not cheating, or that a character was earned — a
   save carries a checksum, not a signature. The launcher stops **accidents**
   (the wrong mod set, a wiped or corrupt save, tampered metadata), which is the
   case that actually happens, and does not pretend to stop an adversary.

   **The management port is the one real security finding here.** The engine's
   `/setup` server has **no authentication** and `PUT /setup/config` rewrites the
   world's own config. Upstream binds it to `0.0.0.0`; LCLite's overlay now binds it
   to **loopback by default** (see `mods/control-panel`), and the launcher
   additionally **refuses to list a world** while that page answers on a LAN
   address (dialling the real interface addresses — a bind probe lies on Windows).
   `MANAGEMENT_HOST=0.0.0.0` opts back in deliberately.

8. **Your characters** — the save section, under **Your Server**, and deliberately
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

   The world's own `allow_save_import` flag is now **legacy**: nothing sets it, the
   host form no longer offers it, and the worlds cards no longer advertise it. The
   field stays in the manifest struct *and in the signed payload* on purpose —
   removing it would change the canonical field set inside the signature and
   invalidate every invite code already handed out.

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
| `%LOCALAPPDATA%\LCLite\launcher.json` | installs, saved worlds + the host's own draft + its signing key, cached branch list, folded sections |
| `%LOCALAPPDATA%\LCLite\installs\<rev>\` | managed revision checkouts |
| `%LOCALAPPDATA%\LCLite\tools\bun\bun.exe` | bun fetched on demand |

A world's signing key lives in `launcher.json` and is created on first *List my
world*. It is the world's identity — re-listing under a new key would make every
shared code point at a world nobody has, so a damaged key is reported rather than
silently replaced.

A character is **not** here: it lives in the world's own tree
(`installs/<rev>/engine/data/players/<profile>/`), which is why the launcher shows
you the folder instead of keeping a copy. `%LOCALAPPDATA%\LCLite\saves\` may still
hold folders from the removed vault; nothing reads them any more, and they are left
alone rather than deleted.

`--data <folder>` moves the whole tree above (the way to test the launcher without
touching real installs).

Override with `--data <folder>`. Flags: `--port`, `--no-browser` (the launcher opens
no window at all — its own dashboard *and* your client after a join), `--play <rev>`
(install if needed, then launch — handy for a desktop shortcut), `--version`.

## A note on how the UI renders

The page polls `/api/state` every 2.5s, so every block re-renders only when the
data behind it changed (a signature check) and the server card is patched in
place. That is not an optimisation — it is what keeps a poll from un-ticking your
mod boxes or eating a half-typed port. Anything that turns into an input must
respect that, or move to a signature of its own.

The Join panel is the sharpest case of it, because it is the one block that holds
an input *and* changes shape: the setup half (address, invite code, Join button,
local port) is only ever shown or hidden, never re-rendered, so a half-typed
address survives the poll; the joined card is rebuilt only when the proxy state
behind it changes, keyed on its own signature.

## API (for scripting)

All under `/api`, all requiring header `X-LCLite-Token: <token>` (the token is in
the served page). `state`, `revs`, `config` (`{"skip_wizard":true}`,
`{"recommended_rev":"300"}`, `{"collapsed":["mods","revs"]}`), `install`, `import`, `apply`, `build`,
`update`, `reset`, `strip` (take every mod off), `remove` (`{id, wipe}` — `wipe`
deletes the folder and is refused for a hand-added install or one outside
`<data>/installs/`), `run`, `stop`,
`browse`, `bun`, `proxy/start`, `proxy/stop`, `job`, `log`, `quit`. Long tasks return a job id; poll
`job?id=&since=` for incremental log lines.

`proxy/start` takes `{url, port, id, local_client?, world_id?}`. `local_client` is
**optional and means yes** — your build is served unless a script explicitly says
`false` (a plain bool would have made "absent" mean "serve theirs"). `world_id`
names the world so `/api/state`'s `proxy.joined` can describe it: a saved world's
id, or `"self"` for this machine's own; blank falls back to the address, and a
server nobody has described comes back with an empty name rather than a made-up
one.

Worlds and saves:

| Endpoint | What |
| --- | --- |
| `worlds` | the list: this machine first, then favorites, then online, then the rest. Never probes — the panel's 2.5s poll must stay cheap |
| `worlds/add` | `{code}` — import an invite code. A signed code that fails verification is refused; an unsigned one is accepted with a warning; a code for **this launcher's own** world comes back `{"self":true}` and is not stored (the list already leads with it) |
| `worlds/remove` `worlds/favorite` | `{id}` / `{id, favorite}` |
| `worlds/refresh` | probes every world (TCP dial, then read the page, so "something answered" is not mistaken for "a Lost City world") |
| `worlds/check` | `{id, install}` **or** `{addr, install}` → the mod-rule verdict, the build digest, and whether the revisions match. An address that belongs to a saved world is gated by that world's rules; an address nobody has described has no rules and answers with the build alone |
| `world/publish` | `{name, description, host_name, address, mods_required, mods_forbidden}` → a signed manifest + invite code. Refused while the management page answers on a LAN address unless `{allow_exposed:true}` |
| `saves` | `?install=` — the characters in an install, each checked for integrity, plus the folder they live in |
| `saves/reveal` | `?install=` — open that folder in the desktop's file manager (creates it if the world has never been logged into) |

Removed with the vault: `saves/import`, `saves/export`, `saves/browse`, `vault`
(the endpoints are gone, not hidden — they answer 404). `worlds/note` and
`world/unpublish` went too: nothing in the UI ever read a note or cleared the
listing flag, so both were surface with no user.

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

The Worlds work added its own coverage, and the parts that *can* be proven are proven
against real bytes rather than mocks:

- **Signing** — every field of a manifest is covered by the signature (a per-field
  tamper test fails each one in turn); a manifest re-labelled under another host's key
  fails; re-listing under the same key keeps the world's id; a newline in a name
  cannot forge an extra signed field. Invite codes round-trip, and a gzip bomb is
  rejected by the bounded inflate.
- **Saves** — the integrity rule was derived from the engine's reader and then
  **checked against every save in the live installs (19/19 pass)**; edited, truncated,
  wrong-magic, future-version and corrupted-trailer files are each refused, and the
  listing reports the folder a character really lives in.
- **The management-port detector** is tested against a **real listener** on a real
  interface address, not a mocked one — and the loopback default itself was proven by
  booting a world and reading `netstat`: `:80` and `:43594` on `0.0.0.0`, `:8898` on
  `127.0.0.1`.
- **The Go↔JS contract** is pinned: the JSON keys the page reads are asserted, because
  a rename there does not fail loudly. That test exists because it already caught one —
  `bridgeToWorld` read `address` while the manifest shipped `addr`, so a world showed
  its address on its card and then refused to join it.
- End to end through the real UI in a browser: cards render and sort (self → favorites →
  online → rest), an offline non-favorite folds away, a star re-pins it, a world that
  bans an applied mod **blocks** with a one-click repair, a world that merely wants a
  missing mod **warns and still joins**, publishing signs and returns a code, and the
  save list reports characters with their integrity. Every `onclick` in the
  rendered panel was swept and checked to name a real function.
- **Joining, both ways, against a live launcher** (not a mock): a typed address runs
  the gate (`{addr}` → the build digest and "nobody has described this server"), and a
  pasted invite code adds the world, probes it, gates it on the host's rules and then
  bridges — `proxy/start` with `local_client:true` and the picked install's id, which
  the panel then reports as `joined <target>` with the *Leave* link. A code for the
  launcher's own world comes back `{"self":true}`, is not stored twice, and joins as
  `self`.

The join/your-server pass added its own, against a running launcher and a world signed
by a **different** key (so the panel was describing somebody else's server, not its own):

- **The joined card** renders the host's name, description, revision, host name, mod
  rules and signature fingerprint from the launcher's own state, plus the install and
  the mods that tree really has applied; a bridge to a bare typed address comes back
  **undescribed** with the address and nothing invented. Checked in the DOM, and pinned
  by `TestJSONKeysTheUIActuallyReads` (which also asserts a stopped bridge reports no
  `joined` at all).
- **The setup is hidden while joined, and comes back on *Leave*** — verified in the DOM
  (`display:none` → `block`, card emptied, `proxy.joined` gone), and a world card's
  *Join* retargets a live bridge to the new name without leaving.
- **Joining opens YOUR client, not the host's.** Proven by running the launcher with a
  `cmd.exe` test double first on `PATH`: on startup it asks to open its own dashboard,
  and on a join it asks to open `http://localhost:<bridge>/rs2.cgi` — the bridge's
  address. With `--no-browser` the same join asks for nothing at all. (The launcher
  only ever *asks*; the OS opens it.)
- **`local_client` defaults to your build**: a `proxy/start` with no such field logs
  *serving the local client bundle from …* and reports `local_client: true`; an explicit
  `false` logs *serving the REMOTE's own client* and says so in the bridge log.
- **The removed endpoints 404** rather than lingering (`saves/import`, `saves/export`,
  `saves/browse`, `vault`, `worlds/note`, `world/unpublish`), and `saves/reveal` was
  driven against a real install — it returns the folder it opened, and creates it on a
  world nobody has logged into yet (`TestEnsureSaveDirCreatesTheFolder`).
- The panel's own save list was read in the DOM with a **deliberately damaged** save
  beside a good one: the good one lists clean, the damaged one carries a `damaged` tag
  and the checksum reason.

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
- No auto-update yet; the launcher is small enough to just replace.
- Rev switching on an install with mods applied is refused until you *Reset to
  pristine* — by design, since the overlay's convergence assumes a clean tree.
- **Mod rules cannot be enforced, only checked.** The client is JavaScript served by
  the host, so a player can lie about their mod set; nothing here can stop that. The
  gate stops accidents, which is the case that happens. See *Worlds* above.
- **A server that pins `web.allowedOrigin` can refuse a bridged socket**, and there is
  deliberately no "open directly" fallback in the panel any more: the answer to "this
  server will not take my client" is that server's own webclient in a browser, not a
  second button in the launcher pretending to be a mode. Everything the launcher's
  Join does is bridge *your* build; if that is not wanted, the launcher is the wrong
  tool for that server. (The bridge can still be told to serve the host's build with
  `local_client:false` on `/api/proxy/start`, for a script that wants the raw tunnel —
  the panel never asks for it.)
- **There is no world directory.** A world is shared by handing somebody an invite
  code; there is no public list, no server, and no discovery. The manifest format is
  versioned (`v:1`) and signed so a hosted directory can be added later without
  invalidating codes already shared.
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
- **One install carries one mod set**, so two worlds with different rules can mean a
  full apply-and-rebuild between them. The bridge already chooses which bundle to serve
  (`/client/*`), so per-world built bundles are the obvious next step; a mod that
  patches the *engine* (LCLite's own panel) can never be swapped that way, because the
  host's server has to have it too.
