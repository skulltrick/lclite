# rotten-potato

A staff/developer command palette, client-side. Click the potato in the page corner and a
searchable list of every command this world actually has opens — the engine's own `::`
commands and the content repo's `::~` debug procs — so spawning items, levelling an
account, jumping to a quest step or driving an interface is two clicks instead of typing
a command you half remember.

The homage: Jagex handed its moderators a *rotten potato* that opened a menu of admin
commands. This one is a page overlay and it adds no commands of its own — it is a
shortcut to the ones already in the world, which is why it works on a plain Lost City
install with no content changes.

## How a click becomes a command (read this before changing anything)

Two halves, and **both are load-bearing**:

1. **The page layer** (`files/engine/public/lclite/rotten-potato/ui.js`) writes the
   command BODY — no `::` prefix, e.g. `give rune_axe 5` — into the reserved window slot
   `rottenPotatoCmd`, then dispatches two synthetic `Enter` keydowns at the game canvas
   (`GameShell.onkeydown` → the engine's own key queue).
2. **The engine hunk** (`patches/289/Client_ts.json`) reads that slot in the chatbox's
   own send branch, fills the engine's own `chatInput` with `'::' + body`, and lets the
   engine's real Enter-send path run. So `::fpson`, `::tcg`, the colour prefixes and the
   `CLIENT_CHEAT` packet are all the engine's own code — this mod does not re-implement
   one line of it, and a command behaves exactly as if it had been typed.

**Why it is not a payload-only mod** (the obvious first instinct, and wrong here): the
engine refuses to type into the chatbox while a chat modal is open —
`} else if (this.chatModalId === -1) {` in `handleInputKey()` — which is exactly the
state a quest dev is in, and `give` / `givemany` / `setstat` / `advancestat` all work
fine server-side with a dialogue up (the debug procs even open with `if_close`). A
page-only version that types with synthetic keystrokes is a **silent no-op** in that
state. The hunk widens that guard for the single tick the armed command arrives on
(`|| typeof (window as any)['rottenPotatoCmd'] === 'string'`) and fills the line; the
slot is cleared as it is consumed, so the guard is never widened for longer than that.

**Two Enters, on purpose.** With the hotkeys mod's "Press Enter to Chat" lock on, the
first Enter flips its typing flag and the second flips it back, so WASD camera keeps
working after a palette command; with the lock off the second Enter finds an empty chat
line and is a no-op. hotkeys never *claims* Enter (it only sets its own flag), so both
reach the engine — verified in `mods/hotkeys/files/.../Hotkeys.ts` `hotkeysDecide`.

**The bundle-side gate is the authority.** The page's own check reads
`window.lostcityClient.ingame` (a name that survives minification only because it is
already in `bundle.ts`'s reserve list for the ondemand worker protocol — a missing one
reads as *unknown*, never as *logged out*). The hunk re-checks `this.ingame` where the
flag is mangle-consistent and drops an armed command when it is false, so a command
aimed at the title screen can never reach the login fields.

## What is in the box

```
mods/rotten-potato/
├── README.md                       this file (rule 7: update it in the same commit)
├── files/engine/public/lclite/rotten-potato/
│   ├── core.js                     the CATALOGUE + every pure decision (ES module)
│   ├── ui.js                       the page layer: DOM, search, arg forms, sending
│   └── ui.css                      the chrome (LCLite brown/gold, z 9550)
├── patches/289/
│   ├── Client_ts.json              ONE island: the chat send path (see above)
│   ├── bundle_ts.json              ONE island: the terser reserve for the window slot
│   └── client_ejs.json             ONE island: the stylesheet + module script tags
└── tools/
    ├── edit_tree.py                the live-tree edits, idempotent + CRLF-preserving
    └── rotten_potato_test.mjs      the headless harness (bun) — see below
```

Nothing else in the overlay is touched except control-panel's own files (the F1 row +
four settings rows, and its `panel.js?v=` bump in the live `client.ejs`), which is the
normal cost of a real panel row.

### Sites, and why they are where they are (measured, not chosen by taste)

* **`Client.ts`** — the chat branch in `handleInputKey()` (old line ~3540). It is a
  **single `-U0` island**: the guard line is unique in the file, and the 2-line context
  floor stays pristine (camera's nearest island is ~100 lines up, tcg's `::tcg`
  interception ~42 lines down). **There is deliberately no parked block**, so the
  parked-block diff landmine (`docs/MODS.md` §3b) cannot re-split another mod's islands —
  a real `regen` afterwards named nothing outside this mod.
* **`bundle.ts`** — in the middle of the reserved list, between the dns-json fields and
  the ondemand worker block: ≥3 untouched lines from tcg's island (top) and
  control-panel's (bottom), so all three stay separate hunks.
* **`client.ejs`** — after the canvas div, before `#controls`. **Not** the `<body>` gap:
  that one is `mods/_template`'s own anchor and `selfcheck` asserts the layout example
  still anchors with every other mod applied (it passes with this mod on).

## The catalogue

`core.js` holds 209 entries — 171 `::~` debug procs, 38 engine/client commands — in the
six tabs the mod shows (Account, Items, Teleport, Quests, Client & Engine, Staff).
Provenance, so nobody has to guess:

* engine commands come from `engine/src/network/game/client/handler/ClientCheatHandler.ts`
  (its `cmd === '…'` table), and `give` takes an **item NAME**, not an id;
* debug procs come from `content/scripts/**`'s `[debugproc,<name>]` declarations, which
  the engine only dispatches with the world's `debugProcChar` prefix (`~`, `WorldConfig`)
  on a non-production world at `staffModLevel >= 4`;
* the harness **re-derives both from those sources** and asserts every entry exists with
  the same argument count, so the catalogue cannot drift from the world it drives.

Notes worth knowing (they are in the tooltips too):

* `::~addxp <stat> <amount>` multiplies by 10 (`stat_advance($stat, $amount * 10)`) —
  `::~addxp attack 500` grants 5,000 xp;
* item/config args are ONE token: the palette lowercases and turns spaces into
  underscores, so `Rune Axe` becomes `rune_axe` before it is sent;
* `::tele` takes the engine's own `level,mapX,mapZ,tileX,tileZ` string — `::getcoord`
  prints yours in exactly that form;
* the **Staff** tab is the `staffModLevel >= 2/3` set that is gated on
  `Environment.node.production`: on a local dev world those commands do nothing, which
  their notes say;
* `::~help` is in the list for comparison — this palette is what replaces it.

**Deliberately absent:** `::debug`, `::chat` and `::perf` from the `::~help` text do not
exist in this revision (the help page advertises a later client). `::fpson` / `::fpsoff`
/ `::fps N` are what this client actually implements, and those are in the list.
`::setxp` and `::tele up|down` are absent for the same reason.

## Settings contract

This mod's OWN localStorage keys, all read by the page layer (rule 5 — no hub, no other
mod's key):

| key | what | default |
|---|---|---|
| `rottenPotato` | master switch (the F1 row's switch) | `true` |
| `rottenPotatoButton` | show the potato button in the corner | `true` |
| `rottenPotatoCloseOnRun` | hide the palette as soon as a command is sent | `false` |
| `rottenPotatoFavs` | starred command ids, CSV (edited in the palette) | `` |
| `rottenPotatoRecent` | last 8 commands run, CSV | `` |
| `rottenPotatoLast` | the last command line (shown in the F1 row's status) | `` |
| `lcmRottenPotatoAnchor` / `Offset` | palette placement | `MC` / `0,-140` |
| `lcmRottenPotatoButtonAnchor` / `Offset` | button placement | `TL` / `18,16` |

Placement is the panel's alt-drag platform: **the drag layer is the only writer** of the
`lcm…` keys, this layer only reads them (the tcg HUD pattern), and both surfaces register
with `owner: true` so the panel drag-tests them without positioning them. The palette
defaults to the middle of the canvas, the button to viewport top-left (top-right is the
LCLite FAB's). `Reset position` in F1 (or Alt+right-click) puts them back.

The chat line's own limit applies: the palette refuses a body longer than 77 characters
(the engine's typing gate is `chatInput.length < 80`, and the `::` prefix takes two).

## The harness

```
LCLITE_ROOT=<install> bun mods/rotten-potato/tools/rotten_potato_test.mjs
```

2,226 checks: the catalogue's shape (unique ids, declared categories, known arg kinds),
the exact string each representative click produces (item names normalised, numbers
clamped, empty optional args omitted, coords left intact), raw-command parsing, search
(including that every result really contains every token), the CSV helpers — and, with a
tree available, the source cross-check described above plus assertions that the two
engine halves are present and that the slot is reserved.

## Rebuilding this mod

```
python mods/rotten-potato/tools/edit_tree.py <install>     # idempotent: run it twice, same bytes
LCLITE_ROOT=<install> node tools/regen.mjs
LCLITE_ROOT=<install> node tools/lclite.mjs apply --check   # ✗0
LCLITE_ROOT=<install> node tools/doctor.mjs                 # exit 0
node tools/selfcheck.mjs                                    # the template still anchors
node tools/matrix.mjs                                       # 289 + 274 still take the corpus
cd <install>/webclient && ./node_modules/.bin/tsc --noEmit -p tsconfig.json
LCLITE_ROOT=<install> node tools/lclite.mjs build           # the Client.ts hunk needs the bundle
```

The page assets are version-keyed: bump `?v=` in the `client.ejs` hunk **and**
`VERSION` in `core.js`/`ui.js` together (ui.js imports core.js at the same version).

## What to check in game

1. The potato sits in the top-left of the page; clicking it opens the palette centred over
   the game, and Esc (or ✕) closes it.
2. Search `give`, click the row, type `rune axe` (with a space — it should run
   `::give rune_axe 1` in the preview) and press Enter: the axe appears in your inventory.
3. `Account → Max all stats` (`::~maxme`) while a **dialogue is open** — the whole point
   of the engine hunk: it should still run (or the server should answer), not silently do
   nothing.
4. With hotkeys' WASD camera on and the chat locked ("Press Enter to Chat..."): run a
   command, then walk with WASD — the camera should still respond (the two-Enter dance).
5. Alt+drag the palette and the potato to new spots, then `F1 → Rotten Potato → Reset
   position`: both return to their defaults.
6. Open the Raw tab and run `~help` — the engine's own five-section menu should appear.
