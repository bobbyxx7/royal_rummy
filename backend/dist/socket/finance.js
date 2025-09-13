"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeReserveHold = computeReserveHold;
exports.computeRoundDeltasByFormat = computeRoundDeltasByFormat;
const rules_1 = require("./rules");
// Compute reserve hold amount per table format
function computeReserveHold(table, rules) {
    const boot = Number(table.bootValue || '0');
    const format = table.format || 'points';
    if (format === 'points') {
        const reserveByPoints = rules.maxPoints * (table.pointValue || rules.pointValue);
        return Math.max(0, Math.max(boot, reserveByPoints));
    }
    if (format === 'deals') {
        // Reserve full boot for deals format by default
        return Math.max(0, boot);
    }
    if (format === 'pool') {
        // Reserve boot + one points reserve to cover at least one round (tunable)
        const reserveByPoints = rules.maxPoints * (table.pointValue || rules.pointValue);
        return Math.max(0, boot + reserveByPoints);
    }
    return Math.max(0, boot);
}
// Compute round deltas by format. Currently points format implemented; others return zero deltas (placeholder)
function computeRoundDeltasByFormat(table, players, packed, playersHands, playersGroups, winnerUserId, wildRank, rules) {
    const format = table.format || 'points';
    if (format === 'points') {
        const MAX_POINTS = rules.maxPoints;
        const FIRST_DROP = rules.firstDrop;
        const MIDDLE_DROP = rules.middleDrop;
        const pointValue = table.pointValue || rules.pointValue;
        const rakePercent = rules.rakePercent;
        const points = players.map((uid, seat) => {
            if (!uid)
                return { user_id: uid, seat, points: 0 };
            if (uid === winnerUserId)
                return { user_id: uid, seat, points: 0 };
            if (packed[seat]) {
                const p = (playersHands[seat]?.length ?? 0) > 0 ? MIDDLE_DROP : FIRST_DROP;
                return { user_id: uid, seat, points: Math.min(p, MAX_POINTS) };
            }
            const hand = playersHands[seat] || [];
            const { points: deadwood } = (0, rules_1.computeHandPoints)(hand, playersGroups[seat], wildRank);
            return { user_id: uid, seat, points: Math.min(deadwood, MAX_POINTS) };
        });
        const totalLoserPoints = points.filter(p => p.user_id !== winnerUserId).reduce((acc, p) => acc + (p.points || 0), 0);
        const grossWinnerAmount = totalLoserPoints * pointValue;
        const rakeAmount = Math.round((grossWinnerAmount * rakePercent)) / 100;
        const netWinnerAmount = grossWinnerAmount - rakeAmount;
        const deltas = points.map((p) => ({
            ...p,
            delta: p.user_id === winnerUserId ? netWinnerAmount : -(p.points * pointValue),
        }));
        return { deltas, rakePercent };
    }
    if (format === 'deals') {
        const MAX_POINTS = rules.maxPoints;
        const FIRST_DROP = rules.firstDrop;
        const MIDDLE_DROP = rules.middleDrop;
        const rakePercent = rules.rakePercent;
        const points = players.map((uid, seat) => {
            if (!uid)
                return { user_id: uid, seat, points: 0 };
            if (uid === winnerUserId)
                return { user_id: uid, seat, points: 0 };
            if (packed[seat]) {
                const p = (playersHands[seat]?.length ?? 0) > 0 ? MIDDLE_DROP : FIRST_DROP;
                return { user_id: uid, seat, points: Math.min(p, MAX_POINTS) };
            }
            const hand = playersHands[seat] || [];
            const { points: deadwood } = (0, rules_1.computeHandPoints)(hand, playersGroups[seat], wildRank);
            return { user_id: uid, seat, points: Math.min(deadwood, MAX_POINTS) };
        });
        const deltas = points.map((p) => ({ ...p, delta: 0 }));
        return { deltas, rakePercent };
    }
    if (format === 'pool') {
        const MAX_POINTS = rules.maxPoints;
        const FIRST_DROP = rules.firstDrop;
        const MIDDLE_DROP = rules.middleDrop;
        const rakePercent = rules.rakePercent;
        // Per-round points computed like Points Rummy; elimination/retention handled by caller
        const points = players.map((uid, seat) => {
            if (!uid)
                return { user_id: uid, seat, points: 0 };
            if (uid === winnerUserId)
                return { user_id: uid, seat, points: 0 };
            if (packed[seat]) {
                const p = (playersHands[seat]?.length ?? 0) > 0 ? MIDDLE_DROP : FIRST_DROP;
                return { user_id: uid, seat, points: Math.min(p, MAX_POINTS) };
            }
            const hand = playersHands[seat] || [];
            const { points: deadwood } = (0, rules_1.computeHandPoints)(hand, playersGroups[seat], wildRank);
            return { user_id: uid, seat, points: Math.min(deadwood, MAX_POINTS) };
        });
        const deltas = points.map((p) => ({ ...p, delta: 0 }));
        return { deltas, rakePercent };
    }
    return { deltas: players.map((uid, seat) => ({ user_id: uid, seat, points: 0, delta: 0 })), rakePercent: rules.rakePercent };
}
