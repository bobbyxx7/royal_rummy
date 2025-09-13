"use strict";
// Simple rummy validation utilities for server-side checks
Object.defineProperty(exports, "__esModule", { value: true });
exports.codeToSuitAndRank = codeToSuitAndRank;
exports.cardPointValue = cardPointValue;
exports.evaluateGroup = evaluateGroup;
exports.validateDeclare = validateDeclare;
exports.computeHandPoints = computeHandPoints;
const suitMap = {
    RP: 'hearts',
    BP: 'spades',
    BL: 'clubs',
    RS: 'diamonds',
};
function codeToSuitAndRank(code) {
    if (!code)
        return { isJoker: false };
    if (code.startsWith('JKR'))
        return { isJoker: true };
    const suitCode = code.slice(0, 2).toUpperCase();
    const rankCode = code.slice(2).toUpperCase();
    const suit = suitMap[suitCode];
    let rank = rankCode;
    if (rank === 'A')
        rank = '1';
    if (rank === 'J')
        rank = '11';
    if (rank === 'Q')
        rank = '12';
    if (rank === 'K')
        rank = '13';
    return { suit, rank, isJoker: false };
}
function isConsecutive(nums) {
    if (nums.length < 2)
        return false;
    for (let i = 1; i < nums.length; i++)
        if (nums[i] !== nums[i - 1] + 1)
            return false;
    return true;
}
function normalizeRank(rank) {
    if (!rank)
        return undefined;
    const r = parseInt(rank, 10);
    return isNaN(r) ? undefined : r;
}
function isWildJoker(code, wildRank) {
    if (!wildRank)
        return false;
    if (!code || code.startsWith('JKR'))
        return false;
    const r = code.slice(2).toUpperCase();
    return r === wildRank.toUpperCase();
}
function cardPointValue(code, wildRank) {
    if (!code)
        return 0;
    if (code.startsWith('JKR'))
        return 0;
    if (isWildJoker(code, wildRank))
        return 0;
    const r = code.slice(2).toUpperCase();
    if (r === 'A')
        return 10;
    if (r === 'K' || r === 'Q' || r === 'J')
        return 10;
    const n = parseInt(r, 10);
    if (Number.isFinite(n))
        return Math.min(10, Math.max(2, n));
    return 0;
}
function evaluateGroup(codes, wildRank) {
    if (!codes || codes.length < 3)
        return 'Invalid';
    const cards = codes.map((c) => ({ code: c, ...codeToSuitAndRank(c), isWild: isWildJoker(c, wildRank) }));
    const jokers = cards.filter((c) => c.isJoker || c.isWild);
    const nonJokers = cards.filter((c) => !c.isJoker && !c.isWild);
    const suits = new Set(nonJokers.map((c) => c.suit));
    const ranks = nonJokers
        .map((c) => normalizeRank(c.rank))
        .filter((n) => n != null)
        .sort((a, b) => a - b);
    if (jokers.length === 0 && suits.size === 1 && isConsecutive(ranks))
        return 'Pure Sequence';
    const uniqueRanks = new Set(ranks);
    // Set: same rank across different suits; allow jokers to fill
    if (uniqueRanks.size === 1 && suits.size === nonJokers.length)
        return 'Set';
    if (suits.size === 1) {
        let gaps = 0;
        for (let i = 1; i < ranks.length; i++)
            gaps += ranks[i] - ranks[i - 1] - 1;
        if (gaps <= jokers.length)
            return 'Impure Sequence';
    }
    return 'Invalid';
}
function validateDeclare(groups, wildRank) {
    let pureSeq = 0;
    let totalSeq = 0;
    for (const g of groups) {
        const r = evaluateGroup(g, wildRank);
        if (r === 'Pure Sequence') {
            pureSeq++;
            totalSeq++;
        }
        else if (r === 'Impure Sequence') {
            totalSeq++;
        }
    }
    const valid = pureSeq >= 1 && totalSeq >= 2;
    return { valid, pureSeq, totalSeq };
}
// Compute points for a hand given optional arranged groups; counts all leftover cards as points
function computeHandPoints(hand, groups, wildRank) {
    const used = new Set();
    if (Array.isArray(groups)) {
        for (const g of groups) {
            const r = evaluateGroup(g, wildRank);
            if (r === 'Pure Sequence' || r === 'Impure Sequence' || r === 'Set') {
                for (const c of g)
                    used.add(c);
            }
        }
    }
    const leftovers = [];
    let total = 0;
    for (const c of hand) {
        if (used.has(c))
            continue;
        leftovers.push(c);
        // If wild rank disabled, only printed jokers are 0 points; otherwise both printed and wild rank are 0
        total += cardPointValue(c, wildRank);
    }
    return { points: total, leftovers };
}
