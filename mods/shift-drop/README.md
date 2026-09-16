# mods/shift-drop

**Shift + left-click drops an item**, exactly like RuneLite's shift-click-to-drop /
OSRS's shift-click option: no menu, no item drag, the item leaves the inventory there and
then. On by default in the panel (it is opt-OUT: nothing happens unless you hold Shift).

## What's in the box

- `patches/Client_ts.json` — THREE hunks:
  1. `Client.shiftDown` field + `Client.shiftDropIndex()` right before `mouseLoop()`
     (the rule lives in one place).
  2. The dispatch: the top of `mouseLoop()`'s "menu is closed, item under the cursor"
     branch — before the item-drag setup, so a shift click can never start a drag.
  3. `Client.pointerDown()`: capture `e.shiftKey` on the press.

## Why the rule is a label match

A left click is resolved cycles after the DOM event: `GameShell`'s loop copies
`nextMouseClickButton` and calls `mainloop()`, and by then the only evidence of Shift is
whatever we stored. The click is then dispatched as "the top entry of the menu
`buildMinimenu()` built" (`menuAction[menuNumEntries - 1]`) — so the honest definition of
"drop this item" is **the entry the player can read as `Drop`**, which is also how
RuneLite implements it. `shiftDropIndex()` therefore scans the built menu for a label
starting with `Drop ` whose action is an item op (`OP_HELD1-5`, `INV_BUTTON1-5`) and
dispatches THAT entry through the normal `doAction()` path, params and all. Two
consequences worth knowing:

- It follows the item's own ops, so it works in **any** interface that offers a Drop
  option (inventory, worn items, a side inventory), and it does nothing in the bank, a
  shop or a trade window, whose ops are Withdraw/Deposit/Remove — no new packet, no
  invented op, the same thing a player gets by clicking that row.
- It never reads entries at or above `menuNumEntries`, who are the PREVIOUS menu's text;
  `menuOption` is a fixed `string[]` and only the first `menuNumEntries` entries are
  current (see the harness, which pins this).
- The item ops send `INV_BUTTON5`/`OP_HELD5` — the server validates the op against the
  item's own `iop`/component `iop` (`InvButtonHandler`/`OpHeldHandler`), so there is no way
  for this to do something the game would not also have done from the menu.

## Settings contract

- `localStorage['shiftDrop']` — this mod's OWN key, read at click time (only `'false'`
  disables it, so a missing key keeps the feature on). No other mod's key is touched.
- Panel row: `MOD_REGISTRY` entry `shift-drop` (`master.key === 'shiftDrop'`).
- `mods/shift-drop/tools/shift_drop_test.mjs` — the rule harness (label match, non-item
  actions, stale entries, mod off, priority-reordered menus). Run it after any change to
  the menu code:
  `LCLITE_ROOT=<install> node mods/shift-drop/tools/shift_drop_test.mjs`

## Deliberate divergences

- **No "use" or "wield" swaps.** RuneLite's Menu Entry Swapper does far more; this mod
  does exactly one thing (drop), because that is the one players hold Shift for.
- **No drag suppression setting.** A shift click consumed as a drop cannot also begin an
  item drag, and that is the desired behaviour in every interface that has a Drop op.
- **The click is consumed** (`mouseClickButton = 0`) after the drop, so the item-drag
  path and the default-action path can never also fire from the same press.
