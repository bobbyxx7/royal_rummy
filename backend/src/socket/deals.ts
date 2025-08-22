export type DealsState = {
  remaining: number;
  cumulative: Record<string, number>;
};

export type DealsRoundPoint = { user_id: string; points: number };

export function createInitialDealsState(dealsCount: number): DealsState {
  return { remaining: Math.max(1, dealsCount), cumulative: {} };
}

export function applyRoundToDealsState(state: DealsState, roundPoints: DealsRoundPoint[], winnerUserId: string): DealsState {
  const next: DealsState = { remaining: Math.max(0, state.remaining - 1), cumulative: { ...state.cumulative } };
  for (const rp of roundPoints) {
    if (!rp?.user_id) continue;
    const add = rp.user_id === winnerUserId ? 0 : Math.max(0, Number(rp.points || 0));
    next.cumulative[rp.user_id] = (next.cumulative[rp.user_id] || 0) + add;
  }
  return next;
}

export function isDealsMatchOver(state: DealsState): boolean {
  return state.remaining <= 0;
}

export function getDealsWinnerByMinPoints(state: DealsState): string | undefined {
  const entries = Object.entries(state.cumulative);
  if (entries.length === 0) return undefined;
  return entries.reduce((min, cur) => (cur[1] < min[1] ? cur : min), entries[0])[0];
}


