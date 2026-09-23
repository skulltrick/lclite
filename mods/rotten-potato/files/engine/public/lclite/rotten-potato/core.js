/* lclite:rotten-potato — the catalogue and every pure decision.
   Plain ES module, loaded by ui.js (the page layer) AND by
   mods/rotten-potato/tools/rotten_potato_test.mjs (the harness), so the command
   table and the exact string a click produces are testable headlessly.

   WHERE THE COMMANDS COME FROM — this file invents nothing:
     · engine/src/network/game/client/handler/ClientCheatHandler.ts  (the engine's
       own `cmd === '…'` table: give, setstat, tele, openmain, the prod-gated
       staff set …). Those are typed as `::name`, and `give` takes an item NAME.
     · content/scripts/_test/scripts/**  the `[debugproc,<name>]` procs. The
       engine dispatches those only when the command starts with the world's
       debugProcChar (WorldConfig `~`, i.e. `::~name`), on a non-production world
       with staffModLevel 4. Their signatures are the arg lists below.
   `::~help` (content cheat_help.rs2) is the in-game index this mod replaces; the
   three client commands it advertises but this rev does NOT implement (::debug,
   ::chat, ::perf) are deliberately absent — ::fpson/::fpsoff/::fps N and ::lag
   are what actually exist here.

   NOTE LENGTH IS A UI BUDGET: notes are tooltips on one line. */

export const VERSION = 1;

/** The 19 skills this revision has (PlayerStatMap / PlayerStatEnabled order). */
export const SKILLS = [
    'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

/** Tab order = ::~help's own five sections, then the live-world staff set. */
export const CATEGORIES = [
    { id: 'account', label: 'Account' },
    { id: 'items', label: 'Items' },
    { id: 'tele', label: 'Teleport' },
    { id: 'quests', label: 'Quests' },
    { id: 'client', label: 'Client & Engine' },
    { id: 'staff', label: 'Staff' }
];

// ---- arg kinds -----------------------------------------------------------
//  skill   one of SKILLS (select)
//  number  integer, clamped to min..max when given
//  item    an item NAME (ObjType.getId) — spaces become underscores
//  name    any other config NAME (npc/loc/seq/spotanim/interface/inv) — same rule
//  coord   the engine's own coord text, e.g. 0,50,50,22,22 — commas survive
//  player  a username, passed through untouched
//  text    free text (broadcast) — spaces preserved
const A = {
    skill: (def) => ({ name: 'skill', kind: 'skill', def: def || 'attack' }),
    number: (name, def, min, max) => ({ name, kind: 'number', def, min, max }),
    item: (name) => ({ name, kind: 'item', def: '', ph: 'rune_axe' }),
    name: (name, ph) => ({ name, kind: 'name', def: '', ph: ph || '' }),
    coord: () => ({ name: 'coord', kind: 'coord', def: '0,50,50,22,22' }),
    player: (name) => ({ name, kind: 'player', def: '' }),
    text: (name, ph) => ({ name, kind: 'text', def: '', ph: ph || '' })
};

/** item/name args: a config name is one token — "rune axe" must be "rune_axe". */
export function normalizeName(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/\s+/g, '_');
}

/** One arg's text for the command line, or null when it should be omitted. */
export function argValue(arg, raw) {
    const has = raw !== undefined && raw !== null && String(raw).trim() !== '';
    const v = has ? String(raw).trim() : (arg.def === undefined ? '' : String(arg.def));

    if (v === '' && arg.def === undefined) {
        return null;                     // optional and empty: leave it off
    }

    if (arg.kind === 'number') {
        let n = parseInt(v, 10);
        if (isNaN(n)) {
            n = parseInt(String(arg.def), 10);
        }
        if (isNaN(n)) {
            return null;
        }
        if (arg.min !== undefined && n < arg.min) {
            n = arg.min;
        }
        if (arg.max !== undefined && n > arg.max) {
            n = arg.max;
        }
        return String(n);
    }

    if (arg.kind === 'item' || arg.kind === 'name') {
        const n = normalizeName(v);
        return n === '' ? null : n;
    }

    if (arg.kind === 'coord') {
        // the engine splits the cheat on spaces, then the coord on commas: keep the
        // commas, drop anything else that would break the arg (spaces, quotes)
        const c = v.replace(/[^0-9,]/g, '');
        return c === '' ? null : c;
    }

    if (arg.kind === 'skill') {
        const s = normalizeName(v);
        return SKILLS.indexOf(s) === -1 ? SKILLS[0] : s;
    }

    // player / text: untouched — and an EMPTY one is omitted, never a stray space
    return v === '' ? null : v;
}

/** The FULL chat line a click sends: '::' + the entry's own cmd + its args. */
export function commandLine(entry, values) {
    const vals = values || [];
    const parts = [entry.cmd];
    const args = entry.args || [];
    for (let i = 0; i < args.length; i++) {
        const v = argValue(args[i], vals[i]);
        if (v !== null) {
            parts.push(v);
        }
    }
    return '::' + parts.join(' ');
}

/** What the palette shows while you type — same string, before it is sent. */
export function preview(entry, values) {
    return commandLine(entry, values);
}

/**
 * The Raw tab: accept whatever a dev types and make it a command line.
 *   'maxme'            -> '::~maxme'?  no: the tilde decides, not us. A bare word
 *                         is sent as '::maxme' (an engine command); type '~maxme'
 *                         for a debugproc, exactly as ::~help spells it.
 *   '::give rune_axe'  -> '::give rune_axe'   (a pasted command keeps working)
 *   '::~maxme'         -> '::~maxme'
 * Returns '' for empty input.
 */
export function parseRaw(text) {
    const t = String(text == null ? '' : text).trim();
    if (t === '') {
        return '';
    }
    return t.startsWith('::') ? t : '::' + t;
}

/** Everything a search matches against for one command — args included, so typing
 *  "rune_axe" or "player" finds the commands that take them. Exported so the
 *  harness can assert the search's own rule rather than a copy of it. */
export function haystack(c) {
    let hay = c.id + ' ' + c.label + ' ' + c.cmd + ' ' + (c.note || '') + ' ' + c.cat;
    for (const a of c.args || []) {
        hay += ' ' + a.name + ' ' + (a.ph || '');
        for (const o of a.options || []) {
            hay += ' ' + o[0] + ' ' + o[1];
        }
    }
    return hay.toLowerCase();
}

/** Every token must appear somewhere (id/label/cmd/note/category/args), case-insensitive. */
export function searchCommands(commands, query, cat) {
    const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
        if (cat && cat !== 'all' && c.cat !== cat) {
            return false;
        }
        if (tokens.length === 0) {
            return true;
        }
        const hay = haystack(c);
        return tokens.every((t) => hay.indexOf(t) !== -1);
    });
}

/** Favourites/recent CSV helpers (the page's own localStorage keys). */
export function csvList(raw) {
    return String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function csvAdd(raw, id, max) {
    const list = csvList(raw).filter((x) => x !== id);
    list.unshift(id);
    return list.slice(0, max || 12).join(',');
}

export function csvToggle(raw, id) {
    const list = csvList(raw);
    const i = list.indexOf(id);
    if (i === -1) {
        list.push(id);
    } else {
        list.splice(i, 1);
    }
    return list.join(',');
}

// ---- the catalogue -------------------------------------------------------
// cat / label / cmd / note / args. `cmd` is the body WITHOUT the '::' prefix, so
// the tilde is visible in the row (::~maxme) exactly like the in-game help text.
export const COMMANDS = [
    // ---------------------------------------------------------------- account
    { id: 'maxme', cat: 'account', label: 'Max all stats', cmd: '~maxme', note: 'Every stat to 99 (cheat_maxme.rs2).' },
    { id: 'minme', cat: 'account', label: 'Min all stats', cmd: 'minme', note: 'Every stat to 1, hitpoints 10 (engine command).' },
    { id: 'advancestat', cat: 'account', label: 'Advance a stat to a level', cmd: 'advancestat', note: 'Engine command: level-up messages and all.', args: [A.skill('attack'), A.number('level', 99, 1, 99)] },
    { id: 'setstat', cat: 'account', label: 'Set a stat to a level', cmd: 'setstat', note: 'Engine command: silent — no level-up message.', args: [A.skill('attack'), A.number('level', 99, 1, 99)] },
    { id: 'addxp', cat: 'account', label: 'Add XP to a stat', cmd: '~addxp', note: 'The script multiplies by 10: ::~addxp attack 500 grants 5,000 xp.', args: [A.skill('attack'), A.number('amount', 500, 1)] },
    { id: 'stat_boost', cat: 'account', label: 'Boost a stat', cmd: '~stat_boost', note: 'stat_boost(stat, constant, percent).', args: [A.skill('attack'), A.number('constant', 5), A.number('percent', 10)] },
    { id: 'stat_drain', cat: 'account', label: 'Drain a stat', cmd: '~stat_drain', note: 'stat_drain(stat, constant, percent).', args: [A.skill('attack'), A.number('constant', 5), A.number('percent', 10)] },
    { id: 'minstat', cat: 'account', label: 'Drain a stat to 0', cmd: '~minstat', note: 'stat_sub(stat, 0, 100).', args: [A.skill('attack')] },
    { id: '1hp', cat: 'account', label: 'Hitpoints to 1', cmd: '~1hp', note: 'Drop current hitpoints to 1.' },
    { id: '1pray', cat: 'account', label: 'Prayer to 1', cmd: '~1pray', note: 'Drop current prayer to 1.' },
    { id: 'energy', cat: 'account', label: 'Restore run energy', cmd: '~energy', note: '100% energy and run turned on.' },
    { id: 'godbab', cat: 'account', label: 'The amazing kebab', cmd: '~godbab', note: '+2 attack/strength/defence, heals 24% + 7.' },
    { id: 'poison', cat: 'account', label: 'Poison yourself', cmd: '~poison', note: 'queue(poison_player, 0, severity).', args: [A.number('severity', 1, 0, 100)] },
    { id: 'hit', cat: 'account', label: 'Take damage', cmd: '~hit', note: 'queue(damage_player, 0, amount).', args: [A.number('amount', 10, 0, 999)] },
    { id: 'damage', cat: 'account', label: 'Take 100 damage', cmd: '~damage', note: 'A fixed 100 hit.' },
    { id: 'killme', cat: 'account', label: 'Kill yourself', cmd: '~killme', note: 'Damage equal to your current hitpoints.' },
    { id: 'death', cat: 'account', label: 'Die (999)', cmd: '~death', note: 'damage_self(999) — a real death, with the usual consequences.' },
    { id: 'stunned', cat: 'account', label: 'Stun yourself', cmd: '~stunned', note: 'Stun for N ticks.', args: [A.number('ticks', 5, 1)] },
    { id: 'skull', cat: 'account', label: 'Skull yourself', cmd: '~skull', note: 'pk_skull(duration).', args: [A.number('duration', 60, 0)] },
    { id: 'clearskull', cat: 'account', label: 'Clear your skull', cmd: '~clearskull', note: 'clear_pk_skull.' },
    { id: 'checkskull', cat: 'account', label: 'Print skull state', cmd: '~checkskull', note: 'Prints map_clock and %pk_skull.' },
    { id: 'reset', cat: 'account', label: 'Reset all progress', cmd: '~reset', note: 'Asks to confirm, wipes inv/bank/worn, resets quests, then logs you out.' },
    { id: 'pcs', cat: 'account', label: 'Print combat stats', cmd: '~pcs', note: 'player_combat_stat — the derived combat level maths.' },
    { id: 'members', cat: 'account', label: 'Print membership', cmd: '~members', note: 'Your membership status.' },

    // ------------------------------------------------------------------ items
    { id: 'give', cat: 'items', label: 'Give an item (by name)', cmd: 'give', note: 'Engine command: the item NAME, not an id — spaces become underscores.', args: [A.item('item'), A.number('amount', 1, 1)] },
    { id: 'givemany', cat: 'items', label: 'Give 1000 of an item', cmd: 'givemany', note: 'Engine command: always 1000.', args: [A.item('item')] },
    { id: 'givecrap', cat: 'items', label: 'Fill inventory with random items', cmd: 'givecrap', note: 'Engine command: 28 random non-dummy items.' },
    { id: 'giveother', cat: 'items', label: 'Give an item to a player', cmd: 'giveother', note: 'Live worlds only. Player name, item name, amount.', args: [A.player('player'), A.item('item'), A.number('amount', 1, 1)] },
    { id: 'bank', cat: 'items', label: 'Open your bank', cmd: '~bank', note: 'Open the bank interface anywhere.' },
    { id: 'bank_preset', cat: 'items', label: 'Fill bank with a preset', cmd: '~bank_preset', note: 'Confirms, clears your bank, then fills it with a common item preset.' },
    { id: 'bank_f2p', cat: 'items', label: 'Fill bank with the F2P preset', cmd: '~bank_f2p', note: 'Clears the bank, then the free-to-play item set.' },
    { id: 'clearbank', cat: 'items', label: 'Clear your bank', cmd: '~clearbank', note: 'inv_clear(bank).' },
    { id: 'clearinv', cat: 'items', label: 'Clear a named inventory', cmd: '~clearinv', note: 'inv name: inv, worn or bank (empty = inv).', args: [{ name: 'inv', kind: 'select', def: 'inv', options: [['inv', 'inventory'], ['worn', 'worn/equipped'], ['bank', 'bank']] }] },
    { id: 'magicbank', cat: 'items', label: 'Bank full of magic items', cmd: '~magicbank', note: 'Runes, staves and the magic test kit.' },
    { id: 'fmbank', cat: 'items', label: 'Bank full of firemaking items', cmd: '~fmbank', note: 'Logs and tinderboxes.' },
    { id: 'foodbank', cat: 'items', label: 'Bank full of food', cmd: '~foodbank', note: 'Every food this rev has.' },
    { id: 'fletchbank', cat: 'items', label: 'Bank full of fletching items', cmd: '~fletchbank', note: 'Logs, knives, bowstrings, arrowheads.' },
    { id: 'wptest', cat: 'items', label: 'Weapon poison test kit', cmd: '~wptest', note: 'Weapon poisons and the weapons to put them on.' },
    { id: 'giverunes', cat: 'items', label: 'Give every rune (1000 each)', cmd: '~giverunes', note: 'cheat_magic.rs2 — 1000 of all 13 runes.' },
    { id: 'fmtest', cat: 'items', label: 'Firemaking test items', cmd: '~fmtest', note: 'debug_firemaking.rs2.' },
    { id: 'fishtest', cat: 'items', label: 'Fishing test items', cmd: '~fishtest', note: 'debug_fishing.rs2.' },
    { id: 'specweps', cat: 'items', label: 'Every special-attack weapon', cmd: '~specweps', note: 'Clears the inventory, then adds the dragon weapons.' },
    { id: 'givemc', cat: 'items', label: 'Dwarf cannon parts', cmd: '~givemc', note: 'The three tool parts.' },
    { id: 'givetrawler', cat: 'items', label: 'Trawler test kit', cmd: '~givetrawler', note: 'Clears the inventory: swamp paste + bailing buckets.' },
    { id: 'trawler_loot', cat: 'items', label: 'Trawler loot roll', cmd: '~trawler_loot', note: 'Sets the catch counter and rolls the reward.', args: [A.number('rolls', 1, 1)] },
    { id: 'objbox', cat: 'items', label: 'Show an item in a box', cmd: '~objbox', note: 'The objbox dialogue for any item name.', args: [A.item('item')] },
    { id: 'giveclues', cat: 'items', label: 'Give treasure trail clues', cmd: '~giveclues', note: 'The clue scroll kit (debug_clues).' },
    { id: 'coordclues', cat: 'items', label: 'Spawn coordinate clues', cmd: '~coordclues', note: 'Confirms — it WILL clear your inventory.' },
    { id: 'drop_items', cat: 'items', label: 'Drop 40 logs (obj test area)', cmd: '~drop_items', note: 'Teleports to the obj test area and drops a pile.' },

    // --------------------------------------------------------------- teleport
    { id: 'tele', cat: 'tele', label: 'Teleport to a coordinate', cmd: 'tele', note: 'Engine command: level,mapX,mapZ,tileX,tileZ — ::getcoord prints yours in this form.', args: [A.coord()] },
    { id: 'getcoord', cat: 'tele', label: 'Print your coordinate', cmd: 'getcoord', note: 'Engine command: the ::tele argument for where you stand.' },
    { id: 'north', cat: 'tele', label: 'Teleport north', cmd: '~north', note: 'N tiles north.', args: [A.number('distance', 1, 1, 63)] },
    { id: 'east', cat: 'tele', label: 'Teleport east', cmd: '~east', note: 'N tiles east.', args: [A.number('distance', 1, 1, 63)] },
    { id: 'south', cat: 'tele', label: 'Teleport south', cmd: '~south', note: 'N tiles south.', args: [A.number('distance', 1, 1, 63)] },
    { id: 'west', cat: 'tele', label: 'Teleport west', cmd: '~west', note: 'N tiles west.', args: [A.number('distance', 1, 1, 63)] },
    { id: 'home', cat: 'tele', label: 'Lumbridge', cmd: '~home', note: '0_50_50_22_22 — the default spawn.' },
    { id: 'varrock', cat: 'tele', label: 'Varrock', cmd: '~varrock', note: '0_50_53_13_31.' },
    { id: 'falador', cat: 'tele', label: 'Falador', cmd: '~falador', note: '0_46_52_21_51.' },
    { id: 'draynor', cat: 'tele', label: 'Draynor Village', cmd: '~draynor', note: '0_48_50_8_50.' },
    { id: 'portsarim', cat: 'tele', label: 'Port Sarim', cmd: '~portsarim', note: '0_47_50_19_25.' },
    { id: 'rimmington', cat: 'tele', label: 'Rimmington', cmd: '~rimmington', note: '0_46_50_12_10.' },
    { id: 'alkharid', cat: 'tele', label: 'Al Kharid', cmd: '~alkharid', note: '0_51_49_28_47.' },
    { id: 'seers', cat: 'tele', label: 'Seers Village', cmd: '~seers', note: '0_42_54_44_29.' },
    { id: 'ardy', cat: 'tele', label: 'Ardougne', cmd: '~ardy', note: '0_41_51_39_38.' },
    { id: 'brimhaven', cat: 'tele', label: 'Brimhaven', cmd: '~brimhaven', note: '0_43_49_50_41.' },
    { id: 'entrana', cat: 'tele', label: 'Entrana', cmd: '~entrana', note: '0_44_52_11_16.' },
    { id: 'giants', cat: 'tele', label: 'Giants (Edgeville dungeon)', cmd: '~giants', note: '0_48_153_38_38 — level 153.' },
    { id: 'kbd', cat: 'tele', label: 'King Black Dragon', cmd: '~kbd', note: '0_47_160_60_16.' },
    { id: 'elvarg', cat: 'tele', label: 'Elvarg', cmd: '~elvarg', note: '0_44_150_30_36 — Crandor.' },
    { id: 'ma', cat: 'tele', label: 'Mage Arena', cmd: '~ma', note: '0_48_61_20_30.' },
    { id: 'pvp', cat: 'tele', label: 'Wilderness PvP spot', cmd: '~pvp', note: '0_52_60_37_37.' },
    { id: 'duel', cat: 'tele', label: 'Duel Arena', cmd: '~duel', note: '0_52_51_42_4.' },
    { id: 'trawler', cat: 'tele', label: 'Fishing Trawler', cmd: '~trawler', note: '0_41_49_52_34 — the lobby.' },
    { id: 'gamesroom', cat: 'tele', label: 'Games room', cmd: '~gamesroom', note: '0_34_77_32_32.' },
    { id: 'gb', cat: 'tele', label: 'Gnomeball', cmd: '~gb', note: '0_37_54_14_32.' },
    { id: 'greenland', cat: 'tele', label: 'Greenland (Gnome Stronghold)', cmd: '~greenland', note: '0_37_55_60_47 — the debug test field.' },
    { id: 'mortton', cat: 'tele', label: 'Mortton temple altar', cmd: '~mortton', note: 'Shades of Mortton.' },
    { id: 'misc_tele', cat: 'tele', label: 'Miscellania', cmd: '~misc_tele', note: 'Throne of Miscellania.' },
    { id: 'misc_tele_queen', cat: 'tele', label: 'Miscellania — the queen', cmd: '~misc_tele_queen', note: 'Straight to the queen.' },
    { id: 'kqtele', cat: 'tele', label: 'Kalphite Queen', cmd: '~kqtele', note: 'The KQ lair.' },
    { id: 'kq', cat: 'tele', label: 'Kalphite lair (kq)', cmd: '~kq', note: 'debug_kalphite.rs2.' },
    { id: 'mctele', cat: 'tele', label: 'Dwarf cannon test area', cmd: '~mctele', note: 'debug_cannon.rs2.' },
    { id: 'atele', cat: 'tele', label: 'Cannon area (atele)', cmd: '~atele', note: 'debug_cannon.rs2.' },
    { id: 'itele', cat: 'tele', label: 'Interaction test area', cmd: '~itele', note: 'The obj/loc interaction test zone.' },
    { id: 'gold_test', cat: 'tele', label: 'Walk the bug-test path', cmd: '~gold_test', note: 'engine/bugs.rs2 — a two-hop teleport along the reported bug path.' },
    { id: 'mazeend', cat: 'tele', label: 'Random-event maze end', cmd: '~mazeend', note: 'debug_others.rs2.' },
    { id: 'pp1', cat: 'tele', label: 'Priest in Peril — step 1', cmd: '~pp1', note: 'debug_quests.rs2.' },
    { id: 'pp2', cat: 'tele', label: 'Priest in Peril — step 2', cmd: '~pp2', note: 'debug_quests.rs2.' },
    { id: 'pp3', cat: 'tele', label: 'Priest in Peril — step 3', cmd: '~pp3', note: 'debug_quests.rs2.' },
    { id: 'pp4', cat: 'tele', label: 'Priest in Peril — step 4', cmd: '~pp4', note: 'debug_quests.rs2.' },
    { id: 'lf', cat: 'tele', label: "Legends — fire", cmd: '~lf', note: 'Legends Quest: the fire section.' },
    { id: 'lgem', cat: 'tele', label: 'Legends — gem puzzle', cmd: '~lgem', note: 'Legends Quest: the gem puzzle.' },
    { id: 'lb', cat: 'tele', label: 'Legends — beach', cmd: '~lb', note: 'Legends Quest: the beach.' },
    { id: 'lg', cat: 'tele', label: 'Legends — guild', cmd: '~lg', note: 'Legends Quest: the guild.' },
    { id: 'lw', cat: 'tele', label: 'Legends — water', cmd: '~lw', note: 'Legends Quest: the water section.' },
    { id: 'jf', cat: 'tele', label: 'Jungle forester', cmd: '~jf', note: 'Legends Quest: the forester.' },
    { id: 'lv', cat: 'tele', label: 'Viyeldi', cmd: '~lv', note: 'Legends Quest: Viyeldi caves.' },
    { id: 'dragslay', cat: 'tele', label: 'Dragon Slayer — Crandor', cmd: '~dragslay', note: 'debug_quests.rs2.' },

    // ----------------------------------------------------------------- quests
    { id: 'quests', cat: 'quests', label: 'Open the quest journal', cmd: '~quests', note: 'The debug quest list (::~help calls it Quest commands).' },
    { id: 'completequests', cat: 'quests', label: 'Complete every quest', cmd: '~completequests', note: 'Alias: ::~cq. Confirms first.' },
    { id: 'resetquests', cat: 'quests', label: 'Reset every quest', cmd: '~resetquests', note: 'Alias: ::~rq.' },
    { id: 'setup_sheep_herder', cat: 'quests', label: 'Set up Sheep Herder', cmd: '~setup_sheep_herder', note: 'Coins, bones, the whole start.' },
    { id: 'setup_waterfall_quest', cat: 'quests', label: 'Set up Waterfall Quest', cmd: '~setup_waterfall_quest', note: 'Runes and the start of the quest.' },
    { id: 'setup_druidic_ritual', cat: 'quests', label: 'Set up Druidic Ritual', cmd: '~setup_druidic_ritual', note: 'Teleports you there with the items.' },
    { id: 'setup_witches_house', cat: 'quests', label: "Set up Witch's House", cmd: '~setup_witches_house', note: 'Teleports you there with the items.' },
    { id: 'setup_dwarf_cannon', cat: 'quests', label: 'Set up Dwarf Cannon', cmd: '~setup_dwarf_cannon', note: 'Teleports you there with the items.' },
    { id: 'setup_temple_of_ikov', cat: 'quests', label: 'Set up Temple of Ikov', cmd: '~setup_temple_of_ikov', note: 'Teleports you there with the items.' },
    { id: 'setup_monks_friend', cat: 'quests', label: "Set up Monk's Friend", cmd: '~setup_monks_friend', note: 'Teleports you there with the items.' },
    { id: 'hero', cat: 'quests', label: "Hero's Quest menu", cmd: '~hero', note: 'Start it, teleport, get the items, or complete it outright.' },
    { id: 'gang', cat: 'quests', label: "Hero's Quest — join a gang", cmd: '~gang', note: 'Phoenix or Blackarm, join or teleport.' },
    { id: 'heu', cat: 'quests', label: "Hero's Quest — stage +1", cmd: '~heu', note: 'debug_quests.rs2.' },
    { id: 'hed', cat: 'quests', label: "Hero's Quest — stage -1", cmd: '~hed', note: 'debug_quests.rs2.' },
    { id: 'dragslaystart', cat: 'quests', label: 'Dragon Slayer — start', cmd: '~dragslaystart', note: 'debug_quests.rs2.' },
    { id: 'dragslaybank', cat: 'quests', label: 'Dragon Slayer — items', cmd: '~dragslaybank', note: 'The quest item kit.' },
    { id: 'tew', cat: 'quests', label: 'Elemental Workshop — complete', cmd: '~tew', note: 'queue(elemental_workshop_quest_complete).' },
    { id: 'spkm', cat: 'quests', label: 'Spawn the kings messenger', cmd: '~spkm', note: 'settimer(spawn_kings_messenger, 10).' },
    { id: 'iku', cat: 'quests', label: 'Temple of Ikov — stage +10', cmd: '~iku', note: '%ikov + 10.' },
    { id: 'ikd', cat: 'quests', label: 'Temple of Ikov — stage -10', cmd: '~ikd', note: '%ikov - 10.' },
    { id: 'upr', cat: 'quests', label: 'Underground Pass — reset', cmd: '~upr', note: 'Resets %upass and %ibanmulti.' },
    { id: 'upu', cat: 'quests', label: 'Underground Pass — stage +1', cmd: '~upu', note: 'debug_quests.rs2.' },
    { id: 'upd', cat: 'quests', label: 'Underground Pass — stage -1', cmd: '~upd', note: 'debug_quests.rs2.' },
    { id: 'upb', cat: 'quests', label: 'Underground Pass — a bit', cmd: '~upb', note: 'Toggles one %ibanmulti bit (0-10: started, koftik, doll, …).', args: [A.number('bit', 0, 0, 10)] },
    { id: 'wtu', cat: 'quests', label: 'Watchtower — stage +1', cmd: '~wtu', note: 'debug_quests.rs2.' },
    { id: 'wtd', cat: 'quests', label: 'Watchtower — stage -1', cmd: '~wtd', note: 'debug_quests.rs2.' },
    { id: 'zqu', cat: 'quests', label: 'Shilo Village — stage +1', cmd: '~zqu', note: 'The zombie queen varp.' },
    { id: 'zqd', cat: 'quests', label: 'Shilo Village — stage -1', cmd: '~zqd', note: 'The zombie queen varp.' },
    { id: 'zqr', cat: 'quests', label: 'Shilo Village — reset', cmd: '~zqr', note: 'Resets the quest and its map mechanisms.' },
    { id: 'zqb', cat: 'quests', label: 'Shilo Village — a bit', cmd: '~zqb', note: 'Toggles a map-mechanism bit (scrolls, plaque, door, Nazastarool).', args: [A.number('bit', 0, 0, 8)] },
    { id: 'slqb', cat: 'quests', label: 'Legends Quest — set a bit', cmd: '~slqb', note: 'setbit(%legends_bits, bit).', args: [A.number('bit', 0, 0, 31)] },
    { id: 'misc_quest_finish', cat: 'quests', label: 'Miscellania — finish', cmd: '~misc_quest_finish', note: 'debug_miscquest.rs2.' },
    { id: 'misc_quest_reset', cat: 'quests', label: 'Miscellania — reset', cmd: '~misc_quest_reset', note: 'debug_miscquest.rs2.' },
    { id: 'misc_set_optimum', cat: 'quests', label: 'Miscellania — optimum', cmd: '~misc_set_optimum', note: 'The ideal kingdom state.' },
    { id: 'misc_rewind', cat: 'quests', label: 'Miscellania — rewind', cmd: '~misc_rewind', note: 'debug_miscquest.rs2.' },
    { id: 'misc_update', cat: 'quests', label: 'Miscellania — update', cmd: '~misc_update', note: 'Runs the kingdom update.' },
    { id: 'misc_print', cat: 'quests', label: 'Miscellania — print state', cmd: '~misc_print', note: 'Prints every kingdom varp.' },
    { id: 'resetmortton', cat: 'quests', label: 'Shades of Mortton — reset', cmd: '~resetmortton', note: 'Resets the quest progress completely.' },
    { id: 'resettbwt', cat: 'quests', label: 'Tai Bwo Wannai Trio — reset', cmd: '~resettbwt', note: 'Resets the quest progress completely.' },
    { id: 'tbwtstatus', cat: 'quests', label: 'Tai Bwo Wannai Trio — status', cmd: '~tbwtstatus', note: 'Prints every TBWT varp.' },
    { id: 'tbwtcs2', cat: 'quests', label: 'TBWT — final cutscene', cmd: '~tbwtcs2', note: 'Plays the quest\'s closing cutscene.' },
    { id: 'testpuz', cat: 'quests', label: 'Treasure trail puzzle box', cmd: '~testpuz', note: 'cheat_treasuretrails.rs2.' },
    { id: 'tc', cat: 'quests', label: 'Print sextant coordinates', cmd: '~tc', note: 'The coordinate clue format.' },

    // -------------------------------------------------------- client & engine
    { id: 'help', cat: 'client', label: 'The engine\'s own command menu', cmd: '~help', note: '::~help — the five-section index this mod replaces.' },
    { id: 'coord', cat: 'client', label: 'Print your coord (Jagex format)', cmd: '~coord', note: 'level_mapX_mapZ_tileX_tileZ.' },
    { id: 'pos', cat: 'client', label: 'Print your position', cmd: '~pos', note: 'x z level.' },
    { id: 'zone', cat: 'client', label: 'Print your zone', cmd: '~zone', note: 'The 8x8 zone you are standing in.' },
    { id: 'players', cat: 'client', label: 'Players online', cmd: '~players', note: 'playercount.' },
    { id: 'busy', cat: 'client', label: 'Am I busy?', cmd: '~busy', note: 'The same flag that gates every if_close command.' },
    { id: 'lineofwalk', cat: 'client', label: 'Line of walk', cmd: '~lineofwalk', note: 'Which of the four neighbours you can walk to.' },
    { id: 'map_blocked', cat: 'client', label: 'Map blocked check', cmd: '~map_blocked', note: 'Which of the four neighbours are blocked tiles.' },
    { id: 'open', cat: 'client', label: 'Open an interface', cmd: '~open', note: 'Interface (component) NAME — if_openmain.', args: [A.name('interface', 'bank')] },
    { id: 'close', cat: 'client', label: 'Close open interfaces', cmd: '~close', note: 'if_close.' },
    { id: 'openmain', cat: 'client', label: 'Open a main interface', cmd: 'openmain', note: 'Engine command: component NAME.', args: [A.name('interface', 'bank')] },
    { id: 'openoverlay', cat: 'client', label: 'Open an overlay interface', cmd: 'openoverlay', note: 'Engine command: component NAME.', args: [A.name('interface', 'bank')] },
    { id: 'closeoverlay', cat: 'client', label: 'Close the overlay', cmd: 'closeoverlay', note: 'Engine command.' },
    { id: 'seq', cat: 'client', label: 'Play a seq (animation)', cmd: '~seq', note: 'Seq NAME, on your own player.', args: [A.name('seq', 'human_castteleport')] },
    { id: 'anim', cat: 'client', label: 'Play a seq (anim alias)', cmd: '~anim', note: 'Same as ::~seq.', args: [A.name('seq', 'human_castteleport')] },
    { id: 'spotanim', cat: 'client', label: 'Play a spotanim', cmd: '~spotanim', note: 'Spotanim NAME.', args: [A.name('spotanim', 'adamant_taxe_launch')] },
    { id: 'loc', cat: 'client', label: 'Spawn a loc under you', cmd: '~loc', note: 'Loc NAME, centrepiece_straight.', args: [A.name('loc', 'magic_tree')] },
    { id: 'npc', cat: 'client', label: 'Spawn an NPC under you', cmd: '~npc', note: 'NPC NAME, 500 ticks.', args: [A.name('npc', 'king_dragon')] },
    { id: 'loc_anim', cat: 'client', label: 'Animate nearby locs', cmd: '~loc_anim', note: 'Loc NAME + seq NAME, over the whole zone.', args: [A.name('loc', 'fire'), A.name('seq', 'roast')] },
    { id: 'npc_anim', cat: 'client', label: 'Animate a nearby NPC', cmd: '~npc_anim', note: 'NPC NAME + seq NAME, within 5 tiles.', args: [A.name('npc', 'chompy_bird'), A.name('seq', 'pog_terror_bird_walk')] },
    { id: 'npc_hasop', cat: 'client', label: 'Does a nearby NPC have op N?', cmd: '~npc_hasop', note: 'NPC NAME + op index.', args: [A.name('npc', 'man2'), A.number('op', 1, 1, 5)] },
    { id: 'transmogrify', cat: 'client', label: 'Transmogrify into an NPC', cmd: '~transmogrify', note: 'NPC NAME — your model becomes it.', args: [A.name('npc', 'monkey')] },
    { id: 'locadd', cat: 'client', label: 'Add a loc (engine)', cmd: 'locadd', note: 'Engine command: Loc NAME, 500 ticks, centrepiece.', args: [A.name('loc', 'tree')] },
    { id: 'npcadd', cat: 'client', label: 'Add an NPC (engine)', cmd: 'npcadd', note: 'Engine command: NPC NAME, 500 ticks.', args: [A.name('npc', 'man')] },
    { id: 'delay', cat: 'client', label: 'Delay yourself', cmd: '~delay', note: 'p_delay(N) — you are busy for N ticks.', args: [A.number('ticks', 5, 1)] },
    { id: 'antilog', cat: 'client', label: 'Prevent logout for N ticks', cmd: '~antilog', note: 'p_preventlogout("Antilog test", N).', args: [A.number('ticks', 100, 1)] },
    { id: 'speed', cat: 'client', label: 'World tick rate', cmd: 'speed', note: 'Engine command: the whole world\'s tick in ms (>= 20).', args: [A.number('ms', 600, 20)] },
    { id: 'fly', cat: 'client', label: 'Toggle fly movement', cmd: 'fly', note: 'Engine command: walk over anything (dev worlds).' },
    { id: 'naive', cat: 'client', label: 'Toggle naive pathing', cmd: 'naive', note: 'Engine command: the naive routefinder (dev worlds).' },
    { id: 'random', cat: 'client', label: 'Force a random event', cmd: '~random', note: 'Clears %macro_event so the next tick can roll one.' },
    { id: 'random_event', cat: 'client', label: 'Spawn a random event', cmd: '~random_event', note: 'macro_event_general_spawn(random).' },
    { id: 'macro_event', cat: 'client', label: 'Spawn a named random event', cmd: '~macro_event', note: 'Event index.', args: [A.number('event', 1, 1, 20)] },
    { id: 'getvar', cat: 'client', label: 'Read a varp/varbit', cmd: 'getvar', note: 'Engine command: varp or varbit debugname.', args: [A.name('name', 'heroquest')] },
    { id: 'setvar', cat: 'client', label: 'Write a varp/varbit', cmd: 'setvar', note: 'Engine command: debugname + value. Protected varps close your interfaces.', args: [A.name('name', 'heroquest'), A.number('value', 0)] },
    { id: 'com_vars', cat: 'client', label: 'Print combat vars', cmd: '~com_vars', note: 'cheat_com.rs2 — the combat formula inputs.' },
    { id: 'cat', cat: 'client', label: 'Print the kitten vars', cmd: '~cat', note: 'hunger / attention / growth / vermin.' },
    { id: 'wildy', cat: 'client', label: 'Print wilderness level', cmd: '~wildy', note: 'wilderness_level(coord).' },
    { id: 'singles', cat: 'client', label: 'Print PvP combat state', cmd: '~singles', note: 'Last attacker/victim, combat ticks, aggressive NPC.' },
    { id: 'music_lock', cat: 'client', label: 'Lock every music track', cmd: '~lockalltracks', note: 'Clears the musicmulti varps.' },
    { id: 'music_unlock', cat: 'client', label: 'Unlock every music track', cmd: '~unlockalltracks', note: 'Sets the musicmulti varps.' },
    { id: 'itest', cat: 'client', label: 'Interaction test', cmd: '~itest', note: 'Runs the itest gosub for a test index.', args: [A.number('test', 1, 1, 20)] },
    { id: 'obj_findallzone1', cat: 'client', label: 'Scan the zone for items', cmd: '~obj_findallzone1', note: 'Teleports to the test zone, then obj_findallzone.' },
    { id: 'loc_findallzone1', cat: 'client', label: 'Scan the zone for locs', cmd: '~loc_findallzone1', note: 'Teleports to the test zone, then loc_findallzone.' },
    { id: 'npc_find1', cat: 'client', label: 'Find nearby NPCs', cmd: '~npc_find1', note: 'npc_find around the test zone.' },
    { id: 'npc_hunt1', cat: 'client', label: 'Hunt nearby NPCs', cmd: '~npc_hunt1', note: 'npc_hunt around the test zone.' },
    { id: 'camreset', cat: 'client', label: 'Reset the camera', cmd: '~camreset', note: 'cam_reset after a cam_moveto test.' },
    { id: 'camtest', cat: 'client', label: 'Move the camera', cmd: '~camtest', note: 'cam_moveto(x, y, height) in the route quest room.', args: [A.number('x', 0), A.number('y', 0), A.number('height', 100)] },
    { id: 'camlook', cat: 'client', label: 'Point the camera', cmd: '~camlook', note: 'cam_lookat(x, y, height).', args: [A.number('x', 0), A.number('y', 0), A.number('height', 100)] },
    { id: 'cutcam', cat: 'client', label: 'Camera cutscene test', cmd: '~cutcam', note: 'debug_routequest.rs2 cutscene.' },
    { id: 'reload', cat: 'client', label: 'Reload scripts', cmd: 'reload', note: 'Engine command: World.reload().' },
    { id: 'rebuild', cat: 'client', label: 'Rebuild scripts', cmd: 'rebuild', note: 'Engine command: World.rebuild().' },
    { id: 'snapshot', cat: 'client', label: 'Heap snapshot (server)', cmd: 'snapshot', note: 'Engine command: writes a V8 heap snapshot on the server.' },
    { id: 'serverdrop', cat: 'client', label: 'Drop the connection', cmd: 'serverdrop', note: 'Engine command: terminate() — reconnection behaviour test.' },
    { id: 'fpson', cat: 'client', label: 'Show FPS', cmd: 'fpson', note: 'Client command (no ::~help equivalent — ::perf does not exist here).' },
    { id: 'fpsoff', cat: 'client', label: 'Hide FPS', cmd: 'fpsoff', note: 'Client command.' },
    { id: 'fps', cat: 'client', label: 'Set the target FPS', cmd: 'fps', note: 'Client command: ::fps N.', args: [A.number('fps', 50, 1, 500)] },
    { id: 'tcg', cat: 'client', label: 'Open the TCG album', cmd: 'tcg', note: 'The tcg mod\'s own chat command (client-side).' },

    // ------------------------------------------------------------------ staff
    { id: 'teleto', cat: 'staff', label: 'Teleport to a player', cmd: 'teleto', note: 'Live worlds only.', args: [A.player('player')] },
    { id: 'teleother', cat: 'staff', label: 'Teleport a player to you', cmd: 'teleother', note: 'Live worlds only.', args: [A.player('player')] },
    { id: 'kick', cat: 'staff', label: 'Kick a player', cmd: 'kick', note: 'Live worlds only.', args: [A.player('player')] },
    { id: 'mute', cat: 'staff', label: 'Mute a player', cmd: 'mute', note: 'Live worlds only: name + minutes.', args: [A.player('player'), A.number('minutes', 60, 0)] },
    { id: 'ban', cat: 'staff', label: 'Ban a player', cmd: 'ban', note: 'Live worlds only: name + minutes.', args: [A.player('player'), A.number('minutes', 60, 0)] },
    { id: 'setvis', cat: 'staff', label: 'Set your visibility', cmd: 'setvis', note: 'Live worlds only: 0 default, 1 soft, 2 hard.', args: [{ name: 'level', kind: 'select', def: '2', options: [['0', 'default'], ['1', 'soft'], ['2', 'hard']] }] },
    { id: 'broadcast', cat: 'staff', label: 'Broadcast a message', cmd: 'broadcast', note: 'Live worlds only.', args: [A.text('message', 'server restarting')] },
    { id: 'getvarother', cat: 'staff', label: 'Read another player\'s varp', cmd: 'getvarother', note: 'Live worlds only: player + varp name.', args: [A.player('player'), A.name('name', 'heroquest')] },
    { id: 'setvarother', cat: 'staff', label: 'Write another player\'s varp', cmd: 'setvarother', note: 'Live worlds only: player + varp name + value.', args: [A.player('player'), A.name('name', 'heroquest'), A.number('value', 0)] },
    { id: 'reboot', cat: 'staff', label: 'Reboot the world', cmd: 'reboot', note: 'Live worlds only — shuts the world down for maintenance.' },
    { id: 'slowreboot', cat: 'staff', label: 'Reboot with a timer', cmd: 'slowreboot', note: 'Live worlds only: seconds.', args: [A.number('seconds', 30, 1)] }
];

/** Entry lookup by id (favourites/recent restore). */
export function byId(id) {
    for (let i = 0; i < COMMANDS.length; i++) {
        if (COMMANDS[i].id === id) {
            return COMMANDS[i];
        }
    }
    return null;
}
