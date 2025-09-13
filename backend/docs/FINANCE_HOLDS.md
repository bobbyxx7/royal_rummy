Finance & Holds Lifecycle
=========================

Overview
--------
This document explains how wallet holds are reserved and released across Points, Deals, and Pool tables, and how round settlements affect ledgers and balances.

Join Table (Reserve Hold)
-------------------------

```mermaid
flowchart TD
    A[Client emits join-table { user_id, token, table_id }] --> B{Validate token}
    B -- invalid --> E[[401 Unauthorized]]
    B -- valid --> C[Compute reserveMin via rules]
    C --> D{wallet >= reserveMin?}
    D -- no --> F[[402 Insufficient wallet]]
    D -- yes --> G[Place WalletHold(active=true) amount=reserveMin]
    G --> H[Ledger: hold delta = -reserveMin]
    H --> I[Update user wallet (-reserveMin)]
    I --> J[[200 Success: seat assigned]]
```

Points Rummy: Round End
-----------------------

```mermaid
flowchart TD
    R[RoundEnd] --> P[Compute deltas (points, rake%)]
    P --> L[Ledger entries per user]
    L --> W[Apply wallet updates per user]
    W --> H[Release all active WalletHold for table]
    H --> U[Ledger: hold_release delta = +reserve]
    U --> S[[Emit wallet-update; persist RoundResult]]
```

Deals Rummy: Round End & Match End
----------------------------------

```mermaid
flowchart TD
    R[RoundEnd] --> A[Accumulate points to match state]
    A --> B{Deals remaining > 0?}
    B -- yes --> C[Retain WalletHold; emit deals-progress]
    B -- no --> D[Compute final min-points winner]
    D --> E[Ledger entries per user]
    E --> F[Apply wallet updates per user]
    F --> G[Release all active WalletHold]
    G --> H[[Emit wallet-update; persist RoundResult]]
```

Pool Rummy: Round End & Final Settlement
---------------------------------------

```mermaid
flowchart TD
    R[RoundEnd] --> A[Accumulate points to pool state]
    A --> B[Mark eliminated >= threshold]
    B --> C{More than 1 remaining?}
    C -- yes --> D[Chain next round; retain WalletHold]
    C -- no --> E[Compute final winner]
    E --> F[Ledger entries per user]
    F --> G[Apply wallet updates per user]
    G --> H[Release all active WalletHold]
    H --> I[[Emit wallet-update; persist RoundResult]]
```

Leave Table (Before Start)
--------------------------

```mermaid
flowchart TD
    A[Client emits leave-table] --> B{Table status == waiting?}
    B -- no --> C[[200 Success; may mark packed if in-game]]
    B -- yes --> D[Release active WalletHold for user+table]
    D --> E[Ledger: hold_release delta = +reserve]
    E --> F[[200 Success; emit wallet-update]]
```

Notes
-----
- Holds are placed only when DB is connected. In-memory/dev runs skip holds but still simulate flows.
- Rake is credited to `RAKE_WALLET_USER_ID` if configured and `RAKE_PERCENT > 0`.
- Ledgering ensures an auditable trail for both round settlements and hold movements.


