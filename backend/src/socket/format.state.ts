// Shared format state for Deals and Pool progress across the app

export type DealsProgress = { remaining: number; cumulative: Record<string, number> };
export type PoolProgress = { cumulative: Record<string, number>; eliminated: Set<string>; threshold: number };

export const dealsStateByTable = new Map<string, DealsProgress>();
export const poolStateByTable = new Map<string, PoolProgress>();


