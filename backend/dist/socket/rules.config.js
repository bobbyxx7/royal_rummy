"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRulesConfig = loadRulesConfig;
function loadRulesConfig() {
    const turnMs = Math.max(5000, Number(process.env.TURN_MS || 30000));
    const declareMs = Math.max(10000, Number(process.env.DECLARE_MS || 45000));
    const reconnectGraceMs = Math.max(5000, Number(process.env.RECONNECT_GRACE_MS || 15000));
    const pointValue = Number(process.env.POINT_VALUE || 1);
    const maxPoints = Number(process.env.MAX_POINTS || 80);
    const firstDrop = Number(process.env.FIRST_DROP || 20);
    const middleDrop = Number(process.env.MIDDLE_DROP || 40);
    const rakePercent = Math.max(0, Math.min(100, Number(process.env.RAKE_PERCENT || 0)));
    const wildEnabled = (process.env.WILD_RANK_ENABLED ?? '1') !== '0';
    return { turnMs, declareMs, reconnectGraceMs, pointValue, maxPoints, firstDrop, middleDrop, rakePercent, wildEnabled };
}
