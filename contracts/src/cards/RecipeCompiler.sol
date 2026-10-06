// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {RecipeDealer} from "./RecipeDealer.sol";

/**
 * @title RecipeCompiler
 * @notice RecipeDealer's recipe checker, compiler and pool math, as its own contract (pure, no state, no owner) so the
 *         dealer stays under the contract size limit. `compile` checks a recipe and turns it into the plan the dealer
 *         reads while dealing; `pool` works out a Series' pool from a plan, its pack count and its characters.
 */
contract RecipeCompiler {
    uint256 public constant SHARE_SCALE = 1e9;
    uint256 public constant HOLO_ONE = 1e18;
    uint256 public constant MAX_NAME_BYTES = 64;
    uint256 public constant MAX_SLUG_BYTES = 32;
    /// @dev A type dealt per character holds at most this many per character (per-character counts are 16-bit).
    uint256 public constant MAX_PER_CHARACTER = 65_535;

    error BadText();
    error BadFiller();
    error BadType(uint256 index, string why);
    error BadSlot(uint256 index, string why);
    error NotNested(uint256 slotA, uint256 slotB);
    error TypeNeverDealt(uint256 index);
    error NeverHolo(uint256 slot, uint256 typeIndex);
    error Infeasible();

    /// @notice Check a recipe and compile it. Reverts with the reason if it isn't valid.
    function compile(RecipeDealer.Recipe memory r) external pure returns (bytes memory plan, uint256 perPack) {
        uint256[] memory p;
        (p, perPack) = _compile(r);
        plan = abi.encodePacked(p);
    }

    /// @notice The pool for `packs` packs and `chars` characters: cards per type, and per nested set.
    function pool(bytes memory p, uint256 packs, uint256 chars) external pure returns (int256[] memory c, int256[] memory sums) {
        return _pool(p, packs, chars);
    }

    // ================================================================ the compiled recipe

    // Header words of the compiled plan
    uint256 private constant H_T = 0; // types
    uint256 private constant H_NODES = 1; // nested sets (node 0 = every type)
    uint256 private constant H_STEPS = 2; // slot groups
    uint256 private constant H_S = 3; // cards per pack
    uint256 private constant H_FILLER = 4;
    uint256 private constant H_TYPES = 5; // where the type records start
    uint256 private constant H_NODETAB = 6; // node n's record starts at word plan[H_NODETAB + n]
    uint256 private constant H_STEPTAB = 7; // groups in dealing order, 4 words each: node, count, mustHolo, slot
    uint256 private constant H_TRIM = 8; // types the floor takes back from, in order
    uint256 private constant H_DEPTH = 9; // nodes, deepest first
    // filled in memory while dealing (0 in the stored plan)
    uint256 private constant H_RT_CELLS = 10; // the Series' first cell slot
    uint256 private constant H_RT_CHARS = 11; // characters
    uint256 private constant H_RT_LEFT = 12; // packs still to come after the one being dealt
    uint256 private constant HEADER = 13;
    // Type record
    uint256 private constant TW = 10;
    uint256 private constant T_INNER = 0; // smallest node holding the type
    uint256 private constant T_SUPPLY = 2;
    uint256 private constant T_AMOUNT = 3;
    uint256 private constant T_CAP = 4;
    uint256 private constant T_HOLOMODE = 5;
    uint256 private constant T_HOLO = 6;
    // Node record
    uint256 private constant N_PARENT = 0;
    uint256 private constant N_DEPTH = 1;
    uint256 private constant N_K = 2; // slots per pack inside the set
    uint256 private constant N_SINGLE = 3; // type + 1 for a one-type set, else 0
    uint256 private constant N_CELL = 4; // its count's cell (a one-type set: the type's own cell)
    uint256 private constant N_LOWEST = 5; // lowest-ranked type
    uint256 private constant N_FILLER = 6; // holds the filler
    uint256 private constant N_NCHILD = 7;
    uint256 private constant N_NBARE = 8;
    uint256 private constant N_LIST = 9; // child nodes, then types in no child

    struct Build {
        uint256 T;
        uint256 W; // bitmap words
        uint256 nn;
        uint256 S;
        uint256 filler;
        uint256[][] sets;
        uint256[] size;
        uint256[] slotNode;
        uint256[] parent;
        uint256[] depth;
        uint256[] k;
        uint256[] inner;
        uint256[] cell;
    }

    function _compile(RecipeDealer.Recipe memory r) internal pure returns (uint256[] memory plan, uint256 perPack) {
        Build memory b;
        b.T = r.types.length;
        b.filler = _checkTypes(r.types);
        b.W = (b.T + 255) / 256;
        _buildSets(r, b);
        _buildTree(r, b);
        plan = _serialize(r, b);
        perPack = b.S;
    }

    function _checkTypes(RecipeDealer.CardType[] memory ts) internal pure returns (uint256 filler) {
        uint256 n = ts.length;
        if (n == 0 || n > type(uint32).max) revert BadFiller();
        uint256 fillers;
        bytes32[] memory slugs = new bytes32[](n);
        for (uint256 t; t < n; t++) {
            RecipeDealer.CardType memory c = ts[t];
            uint256 len = bytes(c.name).length;
            if (len == 0 || len > MAX_NAME_BYTES) revert BadType(t, "name length");
            _checkText(bytes(c.name));
            bytes memory s = bytes(c.slug);
            if (s.length == 0 || s.length > MAX_SLUG_BYTES) revert BadType(t, "slug length");
            for (uint256 i; i < s.length; i++) {
                bytes1 ch = s[i];
                if (!((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch == "-")) revert BadType(t, "slug characters");
            }
            slugs[t] = keccak256(s);
            for (uint256 u; u < t; u++) if (slugs[u] == slugs[t]) revert BadType(t, "slug repeated");
            if (c.supply == RecipeDealer.Supply.Filler) {
                fillers++;
                filler = t;
            } else if (c.supply == RecipeDealer.Supply.Share && c.amount > SHARE_SCALE) {
                revert BadType(t, "share above 100%");
            } else if (c.supply == RecipeDealer.Supply.PerCharacter && (c.amount == 0 || c.amount > MAX_PER_CHARACTER)) {
                revert BadType(t, "per character");
            }
            if (c.holoMode == RecipeDealer.HoloMode.Independent) {
                if (c.holo[0] > HOLO_ONE || c.holo[1] > HOLO_ONE || c.holo[2] != 0 || c.holo[3] != 0) revert BadType(t, "holo chances");
            } else if (uint256(c.holo[0]) + c.holo[1] + c.holo[2] + c.holo[3] == 0) {
                revert BadType(t, "holo weights");
            }
        }
        if (fillers != 1) revert BadFiller();
    }

    function _buildSets(RecipeDealer.Recipe memory r, Build memory b) internal pure {
        uint256 G = r.slots.length;
        if (G == 0) revert BadSlot(0, "no slots");
        b.sets = new uint256[][](G + 1);
        b.slotNode = new uint256[](G);
        uint256[] memory all = new uint256[](b.W);
        for (uint256 t; t < b.T; t++) all[t >> 8] |= 1 << (t & 255);
        b.sets[0] = all;
        b.nn = 1;
        bool rootUsed;
        uint256[] memory covered = new uint256[](b.W);
        for (uint256 s; s < G; s++) {
            RecipeDealer.Slot memory sl = r.slots[s];
            if (sl.count == 0) revert BadSlot(s, "count");
            b.S += sl.count;
            uint256[] memory bm = new uint256[](b.W);
            if (sl.types.length > 0) {
                for (uint256 i; i < sl.types.length; i++) {
                    uint256 t = sl.types[i];
                    if (t >= b.T) revert BadSlot(s, "type index");
                    if (bm[t >> 8] & (1 << (t & 255)) != 0) revert BadSlot(s, "type repeated");
                    bm[t >> 8] |= 1 << (t & 255);
                }
            } else {
                if (sl.minRank > sl.maxRank) revert BadSlot(s, "rank range");
                bool any;
                for (uint256 t; t < b.T; t++) {
                    uint256 rk = r.types[t].rank;
                    if (rk >= sl.minRank && rk <= sl.maxRank) {
                        bm[t >> 8] |= 1 << (t & 255);
                        any = true;
                    }
                }
                if (!any) revert BadSlot(s, "no type in rank range");
            }
            for (uint256 w; w < b.W; w++) covered[w] |= bm[w];
            uint256 j;
            while (j < b.nn && !_same(b.sets[j], bm)) j++;
            if (j == b.nn) b.sets[b.nn++] = bm;
            if (j == 0) rootUsed = true;
            b.slotNode[s] = j;
            if (sl.mustHolo) {
                for (uint256 t; t < b.T; t++) {
                    if (bm[t >> 8] & (1 << (t & 255)) != 0 && !_canHolo(r.types[t])) revert NeverHolo(s, t);
                }
            }
        }
        if (b.S > type(uint32).max) revert BadSlot(G - 1, "too many cards per pack");
        if (!rootUsed) {
            for (uint256 t; t < b.T; t++) if (covered[t >> 8] & (1 << (t & 255)) == 0) revert TypeNeverDealt(t);
        }
    }

    function _buildTree(RecipeDealer.Recipe memory r, Build memory b) internal pure {
        uint256 nn = b.nn;
        b.size = new uint256[](nn);
        for (uint256 i; i < nn; i++) b.size[i] = _popcount(b.sets[i]);
        // nested or disjoint; each set's parent is the smallest set holding it
        b.parent = new uint256[](nn);
        for (uint256 i = 1; i < nn; i++) {
            uint256 best;
            for (uint256 j = 1; j < nn; j++) {
                if (i == j) continue;
                (bool disjoint, bool iInJ, bool jInI) = _relation(b.sets[i], b.sets[j]);
                if (!disjoint && !iInJ && !jInI) revert NotNested(_slotOf(b, i), _slotOf(b, j));
                if (iInJ && b.size[j] < b.size[best]) best = j;
            }
            b.parent[i] = best;
        }
        b.depth = new uint256[](nn);
        for (uint256 i = 1; i < nn; i++) {
            uint256 d;
            for (uint256 x = i; x != 0; x = b.parent[x]) d++;
            b.depth[i] = d;
        }
        b.k = new uint256[](nn);
        for (uint256 s; s < r.slots.length; s++) {
            uint256 x = b.slotNode[s];
            while (true) {
                b.k[x] += r.slots[s].count;
                if (x == 0) break;
                x = b.parent[x];
            }
        }
        b.inner = new uint256[](b.T);
        for (uint256 t; t < b.T; t++) {
            uint256 best;
            for (uint256 i = 1; i < nn; i++) {
                if (b.sets[i][t >> 8] & (1 << (t & 255)) != 0 && b.size[i] < b.size[best]) best = i;
            }
            b.inner[t] = best;
        }
        b.cell = new uint256[](nn);
        uint256 c = b.T;
        for (uint256 i = 1; i < nn; i++) {
            if (b.size[i] > 1) b.cell[i] = c++;
        }
        for (uint256 t; t < b.T; t++) if (b.size[b.inner[t]] == 1) b.cell[b.inner[t]] = t;
    }

    function _serialize(RecipeDealer.Recipe memory r, Build memory b) internal pure returns (uint256[] memory p) {
        uint256 T = b.T;
        uint256 nn = b.nn;
        uint256 G = r.slots.length;
        uint256 nodeWords = N_LIST * nn + (nn - 1) + T;
        p = new uint256[](HEADER + T * TW + nn + nodeWords + 4 * G + (T - 1) + nn);
        p[H_T] = T;
        p[H_NODES] = nn;
        p[H_STEPS] = G;
        p[H_S] = b.S;
        p[H_FILLER] = b.filler;
        uint256 at = HEADER;
        p[H_TYPES] = at;
        for (uint256 t; t < T; t++) {
            RecipeDealer.CardType memory c = r.types[t];
            p[at + T_INNER] = b.inner[t];
            p[at + 1] = c.rank;
            p[at + T_SUPPLY] = uint256(c.supply);
            p[at + T_AMOUNT] = c.amount;
            p[at + T_CAP] = c.maxPerPack;
            p[at + T_HOLOMODE] = uint256(c.holoMode);
            for (uint256 i; i < 4; i++) p[at + T_HOLO + i] = c.holo[i];
            at += TW;
        }
        p[H_NODETAB] = at;
        at += nn;
        for (uint256 x; x < nn; x++) {
            p[p[H_NODETAB] + x] = at;
            at = _writeNode(r, b, p, x, at);
        }
        p[H_STEPTAB] = at;
        // groups, most specific (deepest) first; ties keep recipe order
        for (uint256 d = _maxDepth(b) + 1; d > 0; d--) {
            for (uint256 s; s < G; s++) {
                if (b.depth[b.slotNode[s]] != d - 1) continue;
                p[at++] = b.slotNode[s];
                p[at++] = r.slots[s].count;
                p[at++] = r.slots[s].mustHolo ? 1 : 0;
                p[at++] = s;
            }
        }
        // the floor takes cards back from: rule-by-share / per-pack types first, then exact counts; lowest rank first
        p[H_TRIM] = at;
        for (uint256 pass; pass < 2; pass++) {
            uint256 start = at;
            for (uint256 t; t < T; t++) {
                RecipeDealer.Supply su = r.types[t].supply;
                bool exact = su == RecipeDealer.Supply.Count || su == RecipeDealer.Supply.PerCharacter;
                if (t == b.filler || exact != (pass == 1)) continue;
                uint256 i = at++;
                while (i > start && r.types[p[i - 1]].rank > r.types[t].rank) {
                    p[i] = p[i - 1];
                    i--;
                }
                p[i] = t;
            }
        }
        p[H_DEPTH] = at;
        for (uint256 d = _maxDepth(b) + 1; d > 0; d--) {
            for (uint256 x; x < nn; x++) if (b.depth[x] == d - 1) p[at++] = x;
        }
    }

    function _writeNode(RecipeDealer.Recipe memory r, Build memory b, uint256[] memory p, uint256 x, uint256 at)
        internal
        pure
        returns (uint256)
    {
        p[at + N_PARENT] = b.parent[x];
        p[at + N_DEPTH] = b.depth[x];
        p[at + N_K] = b.k[x];
        p[at + N_CELL] = b.cell[x];
        uint256 lowest = type(uint256).max;
        for (uint256 t; t < b.T; t++) {
            if (b.sets[x][t >> 8] & (1 << (t & 255)) == 0) continue;
            if (b.size[x] == 1) p[at + N_SINGLE] = t + 1;
            if (lowest == type(uint256).max || r.types[t].rank < r.types[lowest].rank) lowest = t;
        }
        p[at + N_LOWEST] = lowest;
        p[at + N_FILLER] = b.sets[x][b.filler >> 8] & (1 << (b.filler & 255)) != 0 ? 1 : 0;
        uint256 i = at + N_LIST;
        for (uint256 y = 1; y < b.nn; y++) {
            if (b.parent[y] == x && y != x) {
                p[i++] = y;
                p[at + N_NCHILD]++;
            }
        }
        for (uint256 t; t < b.T; t++) {
            if (b.inner[t] == x) {
                p[i++] = t;
                p[at + N_NBARE]++;
            }
        }
        return i;
    }

    function _maxDepth(Build memory b) internal pure returns (uint256 m) {
        for (uint256 i; i < b.nn; i++) if (b.depth[i] > m) m = b.depth[i];
    }

    function _slotOf(Build memory b, uint256 node) internal pure returns (uint256) {
        for (uint256 s; s < b.slotNode.length; s++) if (b.slotNode[s] == node) return s;
        return type(uint256).max;
    }

    function _canHolo(RecipeDealer.CardType memory t) internal pure returns (bool) {
        if (t.holoMode == RecipeDealer.HoloMode.Independent) return t.holo[0] > 0 || t.holo[1] > 0;
        return uint256(t.holo[1]) + t.holo[2] + t.holo[3] > 0;
    }

    function _same(uint256[] memory a, uint256[] memory c) internal pure returns (bool) {
        for (uint256 w; w < a.length; w++) if (a[w] != c[w]) return false;
        return true;
    }

    function _relation(uint256[] memory a, uint256[] memory c) internal pure returns (bool disjoint, bool aInC, bool cInA) {
        disjoint = true;
        aInC = true;
        cInA = true;
        for (uint256 w; w < a.length; w++) {
            if (a[w] & c[w] != 0) disjoint = false;
            if (a[w] & ~c[w] != 0) aInC = false;
            if (c[w] & ~a[w] != 0) cInA = false;
        }
    }

    function _popcount(uint256[] memory a) internal pure returns (uint256 n) {
        for (uint256 w; w < a.length; w++) {
            uint256 x = a[w];
            while (x != 0) {
                x &= x - 1;
                n++;
            }
        }
    }

    // ================================================================ the pool

    /**
     * @dev Pool for `packs` packs, from the compiled plan. 1. Each type's rule (cap applied), the filler the rest.
     *      2. Sets without the filler, deepest first: if short of their slots, top up their lowest-ranked type from the
     *      filler. 3. Sets holding the filler, from the filler up: if short, take cards back from types outside the set
     *      that have more than their own sets need (trim order), into the filler. Returns counts per type and per set.
     */
    function _pool(bytes memory p, uint256 packs, uint256 chars) internal pure returns (int256[] memory c, int256[] memory sums) {
        c = _rules(p, packs, chars);
        uint256 nn = _at(p, H_NODES);
        sums = new int256[](nn);
        for (uint256 t; t < c.length; t++) {
            for (uint256 x = _inner(p, t);; x = _nodeAt(p, x, N_PARENT)) {
                sums[x] += c[t];
                if (x == 0) break;
            }
        }
        _topUp(p, c, sums, packs);
        _takeBack(p, c, sums, packs);
        for (uint256 t; t < c.length; t++) if (c[t] < 0) revert Infeasible();
        for (uint256 x; x < nn; x++) if (sums[x] < int256(packs * _nodeAt(p, x, N_K))) revert Infeasible();
    }

    /// @dev Each type's rule (cap applied); the filler gets the rest (can be negative here).
    function _rules(bytes memory p, uint256 packs, uint256 chars) internal pure returns (int256[] memory c) {
        uint256 T = _at(p, H_T);
        uint256 f = _at(p, H_FILLER);
        uint256 n = packs * _at(p, H_S);
        c = new int256[](T);
        int256 used;
        for (uint256 t; t < T; t++) {
            if (t == f) continue;
            uint256 base = _at(p, H_TYPES) + t * TW;
            uint256 rule = _at(p, base + T_SUPPLY);
            uint256 amt = _at(p, base + T_AMOUNT);
            uint256 x;
            if (rule == uint256(RecipeDealer.Supply.Share)) x = (amt * n + SHARE_SCALE / 2) / SHARE_SCALE;
            else if (rule == uint256(RecipeDealer.Supply.PerPack)) x = amt * packs;
            else if (rule == uint256(RecipeDealer.Supply.PerCharacter)) x = amt * chars;
            else x = amt;
            uint256 cap = _at(p, base + T_CAP);
            if (cap != 0 && x > cap * packs) x = cap * packs;
            c[t] = int256(x);
            used += int256(x);
        }
        c[f] = int256(n) - used;
    }

    /// @dev Sets without the filler, deepest first: if short of their slots, top up their lowest-ranked type.
    function _topUp(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs) internal pure {
        uint256 nn = sums.length;
        uint256 order = _at(p, H_DEPTH);
        for (uint256 i; i < nn; i++) {
            uint256 x = _at(p, order + i);
            if (_nodeAt(p, x, N_FILLER) != 0) continue;
            int256 short = int256(packs * _nodeAt(p, x, N_K)) - sums[x];
            if (short > 0) _move(p, c, sums, _at(p, H_FILLER), _nodeAt(p, x, N_LOWEST), short);
        }
    }

    /// @dev The filler can't go below 0, and sets holding it, from the filler up, take cards back if short.
    function _takeBack(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs) internal pure {
        uint256 f = _at(p, H_FILLER);
        uint256 fi = _inner(p, f);
        if (_nodeAt(p, fi, N_SINGLE) == 0 && c[f] < 0) _pull(p, c, sums, packs, type(uint256).max, -c[f]);
        for (uint256 x = fi;; x = _nodeAt(p, x, N_PARENT)) {
            int256 short = int256(packs * _nodeAt(p, x, N_K)) - sums[x];
            if (short > 0) _pull(p, c, sums, packs, x, short);
            if (x == 0) break;
        }
    }

    /// @dev Move `deficit` cards into the filler from types outside set `a`, without leaving any set short.
    function _pull(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs, uint256 a, int256 deficit)
        internal
        pure
    {
        uint256 last = _at(p, H_TRIM) + _at(p, H_T) - 1;
        for (uint256 i = _at(p, H_TRIM); i < last; i++) {
            uint256 t = _at(p, i);
            if (a != type(uint256).max && _inNode(p, t, a)) continue;
            int256 amt = _spare(p, c, sums, packs, t);
            if (amt <= 0) continue;
            if (amt > deficit) amt = deficit;
            _move(p, c, sums, t, _at(p, H_FILLER), amt);
            deficit -= amt;
            if (deficit == 0) return;
        }
        revert Infeasible();
    }

    /// @dev Cards of type `t` that can go to the filler without leaving a set short (sets not holding the filler).
    function _spare(bytes memory p, int256[] memory c, int256[] memory sums, uint256 packs, uint256 t)
        internal
        pure
        returns (int256 amt)
    {
        amt = c[t];
        for (uint256 x = _inner(p, t); _nodeAt(p, x, N_FILLER) == 0; x = _nodeAt(p, x, N_PARENT)) {
            int256 spare = sums[x] - int256(packs * _nodeAt(p, x, N_K));
            if (spare < amt) amt = spare;
        }
    }

    function _move(bytes memory p, int256[] memory c, int256[] memory sums, uint256 from, uint256 to, int256 amt)
        internal
        pure
    {
        c[from] -= amt;
        c[to] += amt;
        uint256 a = _inner(p, from);
        uint256 b = _inner(p, to);
        uint256 x = a;
        uint256 y = b;
        while (_nodeAt(p, x, N_DEPTH) > _nodeAt(p, y, N_DEPTH)) x = _nodeAt(p, x, N_PARENT);
        while (_nodeAt(p, y, N_DEPTH) > _nodeAt(p, x, N_DEPTH)) y = _nodeAt(p, y, N_PARENT);
        while (x != y) {
            x = _nodeAt(p, x, N_PARENT);
            y = _nodeAt(p, y, N_PARENT);
        }
        for (uint256 z = b; z != x; z = _nodeAt(p, z, N_PARENT)) sums[z] += amt;
        for (uint256 z = a; z != x; z = _nodeAt(p, z, N_PARENT)) sums[z] -= amt;
    }

    function _inNode(bytes memory p, uint256 t, uint256 a) internal pure returns (bool) {
        uint256 x = _inner(p, t);
        while (x != a) {
            if (x == 0) return false;
            x = _nodeAt(p, x, N_PARENT);
        }
        return true;
    }

    function _toUint(int256[] memory c) internal pure returns (uint256[] memory u) {
        u = new uint256[](c.length);
        for (uint256 i; i < c.length; i++) u[i] = uint256(c[i]);
    }

    /// @dev Text that goes into the token JSON as-is: valid UTF-8, no quotes, backslashes or control characters.
    function _checkText(bytes memory b) internal pure {
        uint256 i;
        while (i < b.length) {
            uint8 c = uint8(b[i]);
            if (c < 0x80) {
                if (c < 0x20 || c == 0x22 || c == 0x5c || c == 0x7f) revert BadText();
                i++;
                continue;
            }
            uint256 n = c >= 0xc2 && c <= 0xdf ? 1 : c >= 0xe0 && c <= 0xef ? 2 : c >= 0xf0 && c <= 0xf4 ? 3 : 0;
            if (n == 0 || i + n >= b.length) revert BadText(); // a lead byte with its continuation bytes missing
            uint8 lo = 0x80;
            uint8 hi = 0xbf;
            if (c == 0xe0) lo = 0xa0; // no overlong 3-byte forms
            else if (c == 0xed) hi = 0x9f; // no UTF-16 surrogates
            else if (c == 0xf0) lo = 0x90; // no overlong 4-byte forms
            else if (c == 0xf4) hi = 0x8f; // nothing past U+10FFFF
            uint8 c1 = uint8(b[i + 1]);
            if (c1 < lo || c1 > hi) revert BadText();
            for (uint256 k = 2; k <= n; k++) if (uint8(b[i + k]) & 0xc0 != 0x80) revert BadText();
            i += n + 1;
        }
    }


    // ================================================================ low level

    function _at(bytes memory p, uint256 i) internal pure returns (uint256 v) {
        assembly {
            v := mload(add(add(p, 32), shl(5, i)))
        }
    }

    function _inner(bytes memory p, uint256 t) internal pure returns (uint256) {
        return _at(p, _at(p, H_TYPES) + t * TW + T_INNER);
    }

    function _nodeAt(bytes memory p, uint256 x, uint256 field) internal pure returns (uint256) {
        return _at(p, _at(p, _at(p, H_NODETAB) + x) + field);
    }

}
