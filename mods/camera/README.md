# mods/camera — the OSRS-feel camera, and the client's telemetry posture

TYPE B (engine hunks) + TYPE A (panel rows). 5 patched files, 58 hunks:

| file | hunks | what lives there |
|---|---|---|
| `webclient/src/client/Client.ts` | 31 | the camera state + zoom easing, the one-shot walk pick, the wheel/middle-drag handlers, and the legacy-telemetry removal (below) |
| `webclient/src/client/GameShell.ts` | 7 | the input plumbing: a non-passive wheel listener, middle-button down/move/up as a rotate drag (never a game click), the two mod switches the page reads |
| `webclient/src/dash3d/World.ts` | 18 | `visBacking`/`viewRadius`: the visibility cache is precomputed for the default camera distance, so zooming out has to re-derive it (a live frustum probe replaces the stale table) |
| `webclient/src/dash3d/Pix3D.ts` | 1 | the depth clip planes, scaled with the zoom multiplier (defaults stay 50/3500) |
| `webclient/src/dash3d/Model.ts` | 1 | the model-side partner of that clip change |

Settings (every key is read by the ENGINE at its own hook site — rule 5 — so all of
them apply live, no reload):

| key | default | what it does |
|---|---|---|
| `camera` | `true` | the mod's master switch (the panel's row switch) |
| `wheelZoom` | `true` | mouse wheel zooms the camera |
| `middleRotate` | `true` | hold middle mouse + drag to rotate (drag follows the mouse) |
| `wheelScrollChat` | `true` | wheel over the chatbox scrolls history instead of zooming |
| `cameraZoom` | `1` | 0.4× close-up … 2.6× wide (panel slider, eased toward its target) |

Panel rows: three toggles + the zoom slider, all under the Camera row's gear.

## The legacy telemetry removal (folded in 2026-09-20, always on)

This mod never sends the client's legacy input telemetry. There is no key, no
panel row and no field for it — the mod's own master switch is the only control,
and turning the mod OFF gives you the authentic client back.

What is gone from `Client.ts` (each site carries a `// custom (lclite camera mod)`
comment where the code was, so the next reader can see what was removed and why):

| telemetry | where it was | what the server does with it |
|---|---|---|
| `EVENT_MOUSE_MOVE` | `gameLoop`, every 40 tracked positions or on any click: a ~60-line position packer | feeds `InputTracking.mouseMove` |
| `EVENT_MOUSE_CLICK` | `gameLoop`, on any click | feeds `InputTracking.mouseClick` |
| `EVENT_CAMERA_POSITION` | `gameLoop`, on the 20-tick resend timer armed by the arrow keys and by middle-drag rotate | feeds `InputTracking.cameraPosition` |
| `EVENT_APPLET_FOCUS` | `gameLoop`, on every focus change | feeds `InputTracking.appletFocus` |
| `ANTICHEAT_CYCLELOGIC1-7` | the seven counter sites in the world/map/interface/input paths, including two ~25-line random-byte packers | **nothing at 289** — the engine declares these opcodes but binds no handler, so they were already inert on the wire |
| `ANTICHEAT_OPLOGIC1-9` | the eleven object/loc/player/held/inv option paths | **nothing at 289**, as above |

The `EVENT_*` four are the ones that matter: `World.submitInputTracking` only
records while `player.input.active` is set, which happens when staff flag a
session (`RELAY_TRACK`) or when a player is reported for macroing/bug abuse
(`World.notifyPlayerReport`). With this mod on, that recording gets no input from
this client. Nothing else reads those packets — no kick, no validation, no
gameplay effect — and the real action packets (`OPOBJ*`, `OPLOC*`, `OPPLAYER*`,
`OPHELD*`, `INV_BUTTON*`, `MOVE_GAMECLICK`/`MOVE_MINIMAPCLICK`/`MOVE_OPCLICK`,
`IF_BUTTON`) are untouched, so a click, a walk
and a dialogue option reach the server exactly as before.

Why it is unconditional: this used to be its own mod (`mods/anti-cheat`, split out
of camera on 2026-09-09) with a `localStorage 'antiCheat'` toggle that defaulted to
**authentic** — so it did nothing until a player found the row, while the mod's
NAME ("Disable anti-cheat") sat in the mod list doing the project no favours. The
authentic behaviour is what this mod exists to replace; there is nothing left to
toggle. `254` loses the suppression with this change (camera is not available on
254 at all — it has no `World.visBacking`), and the `254` corpus that carried it
was deleted with the mod.

## Migrating an install that had the old mod

The `mods/anti-cheat` corpus is deleted, so the tooling can no longer reverse-apply
its guards: an install whose tree still carries them (anything that had the mod
applied before this change) must be reset to pristine ONCE and re-applied —
otherwise these 22 folded hunks report `anchor not found`, because they anchor on
the pristine telemetry code the old guards are sitting in.

* launcher: the install's **revert / "Working tree reset to pristine"** action, then
  apply (or just press Play — the mod set re-applies), or
* by hand: `git -C <install>/webclient checkout -- .` and the same in `engine/`, then
  `LCLITE_ROOT=<install> node tools/lclite.mjs apply`, then rebuild the bundle
  (`bun run bundle.ts` in `webclient/`, and copy `out/client.js` into
  `engine/public/client/client.js` — that copy is the launcher's `buildClient` step).

## Revisions

* **289** — primary, where this mod is authored.
* **274** — inherits 289 (every anchor matches byte-for-byte; `matrix` verifies).
* **254** — not available: 254 has no `World.visBacking`/`visBackingDirty`, the
  visibility cache the zoom-out hook maintains. Its telemetry suppression is gone
  with `mods/anti-cheat`.

## Gates

`LCLITE_ROOT=<install> node tools/doctor.mjs` (0) · `node tools/lclite.mjs apply
--check` (✗0) · `tsc --noEmit` in the install's `webclient/` · `bash
tools/acceptance.sh` (byte-identical + converge round-trip) · `node
tools/matrix.mjs` after any primary-corpus change. The telemetry removal is not
provable in a harness — it is the ABSENCE of packets — so it is verified by the
byte-compare (the tree text is the proof) plus a live client check that no
`ClientProt.EVENT_*`/`ANTICHEAT_*` opcode is written to `out` while playing.
