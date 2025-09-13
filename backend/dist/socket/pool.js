"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialPoolState = createInitialPoolState;
exports.applyRoundToPoolState = applyRoundToPoolState;
exports.getRemainingPlayers = getRemainingPlayers;
exports.isPoolMatchOver = isPoolMatchOver;
exports.getPoolWinner = getPoolWinner;
function createInitialPoolState(threshold) {
    return { cumulative: {}, eliminated: new Set(), threshold: Math.max(1, threshold) };
}
// Update pool state after a round. Winner gets 0, others add their points.
function applyRoundToPoolState(state, roundPoints, winnerUserId) {
    const next = {
        cumulative: { ...state.cumulative },
        eliminated: new Set(state.eliminated),
        threshold: state.threshold,
    };
    for (const rp of roundPoints) {
        if (!rp?.user_id)
            continue;
        const add = rp.user_id === winnerUserId ? 0 : Math.max(0, Number(rp.points || 0));
        next.cumulative[rp.user_id] = (next.cumulative[rp.user_id] || 0) + add;
    }
    // Eliminate users meeting/exceeding threshold
    for (const [uid, pts] of Object.entries(next.cumulative)) {
        if (pts >= next.threshold)
            next.eliminated.add(uid);
    }
    return next;
}
function getRemainingPlayers(allPlayers, state) {
    return allPlayers.filter((uid) => !!uid && !state.eliminated.has(uid));
}
function isPoolMatchOver(allPlayers, state) {
    return getRemainingPlayers(allPlayers, state).length <= 1;
}
function getPoolWinner(allPlayers, state) {
    const remaining = getRemainingPlayers(allPlayers, state);
    return remaining.length === 1 ? remaining[0] : undefined;
}
