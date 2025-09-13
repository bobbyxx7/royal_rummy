"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialDealsState = createInitialDealsState;
exports.applyRoundToDealsState = applyRoundToDealsState;
exports.isDealsMatchOver = isDealsMatchOver;
exports.getDealsWinnerByMinPoints = getDealsWinnerByMinPoints;
function createInitialDealsState(dealsCount) {
    return { remaining: Math.max(1, dealsCount), cumulative: {} };
}
function applyRoundToDealsState(state, roundPoints, winnerUserId) {
    const next = { remaining: Math.max(0, state.remaining - 1), cumulative: { ...state.cumulative } };
    for (const rp of roundPoints) {
        if (!rp?.user_id)
            continue;
        const add = rp.user_id === winnerUserId ? 0 : Math.max(0, Number(rp.points || 0));
        next.cumulative[rp.user_id] = (next.cumulative[rp.user_id] || 0) + add;
    }
    return next;
}
function isDealsMatchOver(state) {
    return state.remaining <= 0;
}
function getDealsWinnerByMinPoints(state) {
    const entries = Object.entries(state.cumulative);
    if (entries.length === 0)
        return undefined;
    return entries.reduce((min, cur) => (cur[1] < min[1] ? cur : min), entries[0])[0];
}
