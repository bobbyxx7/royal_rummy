export type PoolState = {
  cumulative: Record<string, number>;
  eliminated: Set<string>;
  threshold: number; // e.g., 101 or 201
};

export type PoolRoundPoint = { user_id: string; points: number };

export function createInitialPoolState(threshold: number): PoolState {
  return { cumulative: {}, eliminated: new Set<string>(), threshold: Math.max(1, threshold) };
}

// Update pool state after a round. Winner gets 0, others add their points.
export function applyRoundToPoolState(state: PoolState, roundPoints: PoolRoundPoint[], winnerUserId: string): PoolState {
  const next: PoolState = {
    cumulative: { ...state.cumulative },
    eliminated: new Set<string>(state.eliminated),
    threshold: state.threshold,
  };
  for (const rp of roundPoints) {
    if (!rp?.user_id) continue;
    const add = rp.user_id === winnerUserId ? 0 : Math.max(0, Number(rp.points || 0));
    next.cumulative[rp.user_id] = (next.cumulative[rp.user_id] || 0) + add;
  }
  // Eliminate users meeting/exceeding threshold
  for (const [uid, pts] of Object.entries(next.cumulative)) {
    if (pts >= next.threshold) next.eliminated.add(uid);
  }
  return next;
}

export function getRemainingPlayers(allPlayers: string[], state: PoolState): string[] {
  return allPlayers.filter((uid) => !!uid && !state.eliminated.has(uid));
}

export function isPoolMatchOver(allPlayers: string[], state: PoolState): boolean {
  return getRemainingPlayers(allPlayers, state).length <= 1;
}

export function getPoolWinner(allPlayers: string[], state: PoolState): string | undefined {
  const remaining = getRemainingPlayers(allPlayers, state);
  return remaining.length === 1 ? remaining[0] : undefined;
}


