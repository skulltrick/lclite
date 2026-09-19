# mods/hotkeys — OSRS/RuneLite-style keybinds

F-key sidebar tabs, Esc closes interfaces, Space and 1-5 drive dialogues, WASD
camera. RuneLite's **Key Remapping** plugin (WASD + "Press Enter to Chat") plus
the F-key/Esc/Space/dialogue-number behaviour OSRS itself ships, ported onto this
client's own input path.

A player notices it as: press **F1** and the Combat tab opens, **Esc** and the
bank closes, **Space** advances an NPC's dialogue and **1**–**5** pick an option
in a "Select an Option" menu, and (if they turn it on) **W/A/S/D** rotate the
camera without ever reaching the chatbox.

## What's in the box

| Piece | Where | Why there |
|---|---|---|
| `Hotkeys.ts` (pure core: key tables, the settings reader, the claim decision, and the dialogue's option-row shape) | `files/webclient/src/client/Hotkeys.ts` → `webclient/src/client/Hotkeys.ts` | a files/ payload (the gpu pattern): the mod's logic is testable without a client |
| two key hooks (`hotkeyKeyDown`/`hotkeyKeyUp`, both no-ops) | hunks into `webclient/src/client/GameShell.ts` | the engine's `onkeydown`/`onkeyup` are private, so the mod claims keys from a hook that runs *before* the engine's key queue |
| the keybind block, the dialogue keys + the chatbox prompt | hunks into `webclient/src/client/Client.ts` | one isolated fields+methods slot before `drawChat()` (the stat-orbs/true-tile pattern), plus one line in `drawChat()` |
| panel rows, the F1 yield | `mods/control-panel/files/engine/public/lclite/panel.js` (TYPE A, no rebuild) | the panel is the settings UI for every mod |

No terser reserves: nothing crosses the bundle↔page boundary (the panel only
writes localStorage keys, the engine reads them at its own hook).

## Behaviour

**F-key tabs** (master `hotkeys` + `hotkeysFkeys`, both on by default). Bound keys
switch the sidebar tab the same way clicking its icon does (`activeIcon` +
`redrawSide` + `redrawIcons`). If a *side* interface is open (bank, shop — in this
rev they own the sidebar, `drawSide` prefers `sideModalId`), the tab key closes it
first via the client's own `closeModal()`, so the key is never invisible. A slot
the server has not filled (`sideIcon[i] === -1`, e.g. during the tutorial) is left
alone and the key falls through.

Defaults are OSRS's own table, for the tabs this rev actually has
(`content/scripts/general/configs/tabs.constant` — those numbers are the server's):

| Key | Tab | Key | Tab |
|---|---|---|---|
| F1 | Combat (0) | F8 | Friends (8) |
| F2 | Skills (1) | F9 | Logout (10) |
| F3 | Quests (2) | F10 | Game options (11) |
| Esc | Inventory (3) | F7, F11, F12 | unbound |
| F4 | Worn equipment (4) | Ignore (9) | unbound |
| F5 | Prayer (5) | Player controls (12) | unbound |
| F6 | Spellbook (6) | Music (13) | unbound |

Deliberate gaps: OSRS puts clan chat on F7, account management on F9 and emotes
on F11 — this rev has none of those tabs, so those keys stay free (F9 is given to
the Logout tab, which is where 2004 keeps the logout button). **F12 is left
unbound on purpose**: the browser owns F11/F12 (fullscreen, devtools) and a page
cannot block them, so binding F12 would do both things at once. Slot 7 has no
interface at all in this rev, so it gets no row and no binding.

Every tab is rebindable from the panel (`hotkeysKey<slot>` selects: None, Esc,
F1–F12, Tab, Home/End/PgUp/PgDn, digits, `-`, `=`, letters). A key bound to two
slots opens the first one. Bound letters/digits are *claimed from the chatbox*
unless "Press enter to chat" is on, and a printable binding always yields while a
chat line is live — that is the only sane compromise without the lock.

**Esc closes interfaces** (`hotkeysEscClose`, on). Esc runs this order:
1. a half-typed chat line is discarded (never a half-sent message);
2. while typing with the chat lock on, Esc leaves typing mode (RuneLite's rule);
3. an open interface closes — `closeModal()`, i.e. exactly what the X button
   sends (`ClientProt.CLOSE_MODAL`; the server's `CloseModalHandler` sets
   `requestModalClose` and `Player.closeModal()` runs the `if_close` triggers);
4. otherwise Esc falls through to its binding — the Inventory tab, as in OSRS.

Turning the toggle off leaves step 4 only, which is OSRS's older default.

**Space continues a dialogue, 1–5 pick an option** (`hotkeysSpace` and
`hotkeysNumbers`, both on). With a dialogue open — an NPC chat, a message box, a
"Select an Option" menu — Space and the number row become the dialogue's own keys:

- **Space** presses "Click here to continue". It runs the client's own
  `PAUSE_BUTTON` action, which is exactly what that button sends:
  `RESUME_PAUSEBUTTON`, plus the client's one-click guard (`resumedPauseButton`,
  the flag that makes the button read "Please wait..."), so holding Space cannot
  skip two pages. The tutorial's plain "Click to continue" line — no interface,
  just `tutComMessage` — is cleared the same way the engine's own left-click
  clears it.
- **1**–**5** choose that option in a numbered list. The click is the client's own
  `IF_BUTTON` action for the option's component id, which is precisely what the
  server reads: `IfButtonHandler` sets `player.lastCom` and resumes the paused
  script, and the dialogue procs `switch_component (last_com)` on it
  (`content/scripts/interface_chat/scripts/chat.rs2` — the same
  `if_addresumebutton`/`p_pausebutton` handshake a mouse click uses). An option
  key and a mouse click are the same packet.

Both are claimed (swallowed), so the key can never also type into the chatbox.

**What counts as a numbered list is decided by shape, not by an interface id.**
`hotkeysOptionRows` wants 2–5 plain buttons, one per line (distinct y, boxes that
do not overlap the row above), all sharing a width and left edge. That is what
keeps the number row off this rev's lookalikes: the smithing/crafting menus
(`skill_multi*`) stack four buttons on ONE line per item and put the items side by
side, and the item-select menus (`multiobj*`) are a row of equal-y cells. Both are
refused by the per-line rule, so a digit there is left to the chatbox. A dialogue
with options has no continue button, so Space does nothing on it — as in OSRS.

A live chat line always wins: while you are typing, Space types a space and the
digits type digits. And a digit bound to a sidebar tab keeps both jobs — it picks
the option while a dialogue is up, and opens the tab once the dialogue is gone
(the dialogue keys are checked before the tab bindings, so the two can never
fight).

**Nothing is claimed outside the game.** The whole mod stands down while
`Client.ingame` is false, so the login screen's username/password fields keep
every key (RuneLite gates on the chatbox widget for the same reason) — otherwise
a WASD player could not type their own password. Keys with Ctrl/Alt/Meta held and
input modals (enter-amount, add/delete friend, report abuse) are never claimed
either.

**WASD camera** (`hotkeysWasd`, off) + **Press enter to chat** (`hotkeysChatLock`,
on). The four camera keys (`hotkeysKeyCamUp/Down/Left/Right`, default W/S/A/D) set
`keyHeld[3|4|1|2]` while held — the *same* per-frame path the arrow keys use, so
speed, easing, pitch clamp, touch-cancel and the camera telemetry
(`EVENT_CAMERA_POSITION`) all behave identically. Release clears the direction the
mod itself set (tracked by key name, so rebinding mid-hold cannot stick a camera
key on).

The chat lock is what makes letter binds usable: this client's chatbox is *always
live* (no click-to-focus — `handleInputKey` appends characters whenever no chat
modal is up), so without the lock a bound W could never be typed. While locked the
chat input line shows RuneLite's own prompt, **"Press Enter to Chat..."** (drawn
in `drawChat()` in place of `chatInput + '*'`), Enter or `:` opens the box, Enter
sends and re-locks, and a Backspace that empties the line re-locks. Keys the lock
never swallows: function keys (F1 still opens a tab), the bound camera keys, and
anything with Ctrl/Alt/Meta held (browser shortcuts, copy/paste, the alt-drag
placement layer).

## Settings contract

Every key is this mod's own, read at its own hook site (hard rule 5) — nothing is
shared with another mod and no hub exists.

| localStorage key | Default | Read at |
|---|---|---|
| `hotkeys` | `true` | keydown (per key) + per frame for the prompt |
| `hotkeysFkeys` | `true` | keydown |
| `hotkeysEscClose` | `true` | keydown |
| `hotkeysSpace` | `true` | keydown |
| `hotkeysNumbers` | `true` | keydown |
| `hotkeysWasd` | `false` | keydown |
| `hotkeysChatLock` | `true` | keydown + per frame for the prompt |
| `hotkeysKeyCombat` / `Skills` / `Quests` / `Inventory` / `Worn` / `Prayer` / `Magic` / `Friends` / `Ignore` / `Logout` / `Options` / `Controls` / `Music` | see the table above | keydown |
| `hotkeysKeyCamUp` / `CamDown` / `CamLeft` / `CamRight` | `W` / `S` / `A` / `D` | keydown |

Defaults live once, in `Hotkeys.ts` (`HOTKEYS_TAB_DEFAULTS`, `HOTKEYS_CAM_DEFAULTS`,
`hotkeysReadSettings`) — the panel's rows and the engine can therefore never
disagree about what "unset" means. The panel's key *list* (`HK_KEYS`) and row
defaults are hand-mirrored from the same file, and `hotkeys_test.ts` asserts the
mirror still matches (a page script cannot import TS).

## The panel's F1

F1 was LCLite's own panel shortcut. While the Hotkeys mod is on **and** a tab is
bound to F1 **and** the game canvas holds the keyboard, the panel yields F1 to the
game (the FAB still opens it; press F1 when the canvas is not focused). The
panel's `hotkeysBinding('F1')` reads only its own rendered rows.

## Deliberate divergences

- **Esc closes dialogues too** (chat modals). `closeModal()` is one path for all
  three modal surfaces and the server treats it as an early close (content uses
  `if_close;` for exactly this). Say so if dialogues should be immune.
- **The character-design screen is exempt from Esc** — interface 3559, detected by
  the `CC_DESIGN_PREVIEW` client code (verified: exactly one of the 289 table's
  11,942 interfaces carries it). It has no close button, and the tutorial only
  advances when the design is accepted, so Esc there would soft-lock a new
  account. Esc still switches the sidebar tab behind it.
- **Nothing is claimed before login** (`Client.ingame`), so the login fields keep
  their keys.
- **`/` does not unlock the chatbox** (RuneLite unlocks on Enter, `/` and `:`):
  `/` is LCLite's panel-search shortcut.
- **A tab key closes an open side interface** where a plain icon click would leave
  the bank up and the key would look dead.
- **F12 unbound by default** (see above). The number row is offered per tab *and*
  claimed by an open dialogue — the dialogue wins while it is up, which is what
  makes the two features unable to fight. An input dialogue ("Enter amount:")
  still owns its digits, because the mod claims nothing while one is up.
- **Space is claimed only while a dialogue is up.** With nothing to advance it is
  left alone entirely (it types into the chatbox, and the chat lock swallows it
  when WASD is on) — the mod never takes a key it has no job for.
- **The "Make X" and item-select menus do not take numbers.** They are not
  numbered lists (see above); their own buttons are the way in, and the number row
  stays with the chatbox there.
- **No keys are claimed while an input modal is up** (enter-amount, add/delete
  friend, report abuse): those forms own the keyboard.

## Testing

```
bun run mods/hotkeys/tools/hotkeys_test.ts      # 159 checks: key names, defaults,
                                                # the whole claim table (dialogue
                                                # keys included), the option-row
                                                # shape policy re-derived from the
                                                # rev's own .if files, the
                                                # ButtonType mirror, the panel↔core
                                                # mirror, payload==tree
LCLITE_ROOT=<install> node tools/regen.mjs      # 6 hunks (3 GameShell, 3 Client)
LCLITE_ROOT=<install> node tools/lclite.mjs apply --check   # ✗0
LCLITE_ROOT=<install> node tools/doctor.mjs     # exit 0
bash tools/acceptance.sh                       # whole-corpus gate (all 12 mods):
                                                # pristine clones at the pins READ
                                                # FROM THE CORPUS + apply == the live
                                                # install, byte for byte, then a
                                                # strip/re-apply converge round-trip,
                                                # re-compared
```

Live checks that needed a browser (CDP, dev bundle): F2 switches the sidebar
(`activeIcon` 3→1) with the key claimed out of the engine's queue; `hotkeysFkeys`
off returns the key to the queue; W latches `keyHeld[3]` and releases to 0; a
letter is swallowed while locked, Enter unlocks and then it types; Esc clears a
half-typed line, closes a main modal, and leaves 3559 alone; the panel renders all
23 rows and writes `hotkeysWasd` / `hotkeysKeyInventory`.

**The dialogue keys are not provable in the harness** (they end in a packet, not a
pixel). The live recipe, which needs no walking: on a `production=false` world
every account is staff, so type `::help` in the chatbox. That opens this rev's own
5-option `p_choice5_header` menu — press **5** ("Client & Engine commands") and the
first `mesbox` page should appear (one `IF_BUTTON` round trip), then press **Space**
and the next page should (one `RESUME_PAUSEBUTTON` round trip), and keep pressing
it to walk the list. `1` on the same menu should open the account-commands pages
instead, and `Esc` should still close the menu. Turn `hotkeysNumbers` off and the
digits should go back to the chatbox.

## Not done (on purpose)

- Press-to-bind capture buttons (the rows are selects; RuneLite's keybind widget
  would need a new panel row kind).
- Camera *zoom* keys and a "reset zoom" key (the camera mod owns zoom; adding
  keys here would need a cross-mod write, which rule 5 forbids).
- Remapping the arrow keys themselves (they are the engine's own camera keys and
  are untouched by design).
