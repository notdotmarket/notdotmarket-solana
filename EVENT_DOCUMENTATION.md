# Event System Documentation

This document describes all the events emitted by the NotMarket Solana smart contract for efficient integration and monitoring.

## Overview

The contract emits comprehensive events for all major operations, enabling:
- **Real-time tracking** of token launches, trades, and user activity
- **Analytics** via indexed event data (price per token, volumes, etc.)
- **User notifications** for trades, graduations, and status changes
- **Historical data** reconstruction without scanning all transactions

## Event Types

### 1. LaunchpadInitialized
Emitted when the launchpad configuration is initialized.

```rust
pub struct LaunchpadInitialized {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
}
```

**When**: `initialize_launchpad()`  
**Use case**: Track launchpad configuration for fee calculations

---

### 2. TokenLaunchCreated
Emitted when a new token launch with bonding curve is created.

```rust
pub struct TokenLaunchCreated {
    pub launch: Pubkey,           // Token launch PDA
    pub mint: Pubkey,              // Token mint address
    pub creator: Pubkey,           // Launch creator
    pub bonding_curve: Pubkey,     // Bonding curve PDA
    pub name: String,              // Token name
    pub symbol: String,            // Token symbol
    pub uri: String,               // Metadata URI
    pub total_supply: u64,         // 1B tokens (1,000,000,000,000,000,000 with decimals)
    pub curve_supply: u64,         // 800M tokens on curve
    pub creator_allocation: u64,   // 200M tokens for LP
    pub initial_price_usd: u64,    // SOL price in USD (scaled by 1e8)
    pub timestamp: i64,
}
```

**When**: `create_token_launch()`  
**Use case**: Index new launches, display in marketplace, track launch history

---

### 3. TokensPurchased
Emitted when tokens are bought from the bonding curve.

```rust
pub struct TokensPurchased {
    pub buyer: Pubkey,
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub token_amount: u64,          // Tokens purchased (with decimals)
    pub sol_amount: u64,            // SOL cost (lamports)
    pub platform_fee: u64,          // Fee paid (lamports)
    pub tokens_sold_after: u64,     // Total tokens sold after this trade
    pub sol_reserve_after: u64,     // Total SOL in curve after this trade
    pub price_per_token: u64,       // Price per token (lamports, scaled by 1e9)
    pub timestamp: i64,
}
```

**When**: `buy_tokens()`  
**Use case**: 
- Track buy pressure and price trends
- Calculate volume and transaction count
- Display trade history
- Update chart data in real-time

**Key metric**: `price_per_token` = (sol_amount * 1e9) / token_amount

---

### 4. TokensSold
Emitted when tokens are sold back to the bonding curve.

```rust
pub struct TokensSold {
    pub seller: Pubkey,
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub token_amount: u64,          // Tokens sold (with decimals)
    pub sol_amount: u64,            // SOL received (lamports)
    pub platform_fee: u64,          // Fee paid (lamports)
    pub tokens_sold_after: u64,     // Total tokens sold after this trade
    pub sol_reserve_after: u64,     // Total SOL in curve after this trade
    pub price_per_token: u64,       // Price per token (lamports, scaled by 1e9)
    pub timestamp: i64,
}
```

**When**: `sell_tokens()`  
**Use case**:
- Track sell pressure and price trends
- Monitor user exits
- Display trade history
- Alert on large sells

---

### 5. UserPositionUpdated
Emitted when a user's position changes (buy or sell).

```rust
pub struct UserPositionUpdated {
    pub user: Pubkey,
    pub launch: Pubkey,
    pub token_amount: u64,          // Current token holdings
    pub sol_invested: u64,          // Total SOL invested (cumulative)
    pub sol_received: u64,          // Total SOL received from sells (cumulative)
    pub buy_count: u32,             // Number of buy transactions
    pub sell_count: u32,            // Number of sell transactions
    pub timestamp: i64,
}
```

**When**: After `buy_tokens()` or `sell_tokens()`  
**Use case**:
- Track user portfolio
- Calculate user P&L
- Display user trading history
- Identify top holders

**P&L Calculation**: `sol_received - sol_invested` (negative = loss, positive = profit)

---

### 6. CurveGraduated
Emitted when a bonding curve reaches graduation threshold (800M tokens sold + $12k raised).

```rust
pub struct CurveGraduated {
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub tokens_sold: u64,           // Should be 800,000,000,000,000,000
    pub sol_raised: u64,            // Total SOL in curve (lamports)
    pub timestamp: i64,
}
```

**When**: During `buy_tokens()` when threshold is reached  
**Use case**:
- Alert users of graduation
- Trigger LP creation flow
- Display "Graduated" badge
- Track success rate

---

### 7. LaunchStatusToggled
Emitted when a token launch is activated or deactivated.

```rust
pub struct LaunchStatusToggled {
    pub launch: Pubkey,
    pub is_active: bool,            // true = active, false = paused
    pub toggled_by: Pubkey,         // Creator address
    pub timestamp: i64,
}
```

**When**: `toggle_token_launch_active()`  
**Use case**:
- Show pause/resume notifications
- Filter inactive launches
- Track creator actions

---

### 8. MetadataUpdated
Emitted when metadata URI is updated.

```rust
pub struct MetadataUpdated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub new_uri: String,            // New metadata URI
    pub updated_by: Pubkey,         // Creator address
    pub timestamp: i64,
}
```

**When**: `update_metadata_uri()`  
**Use case**:
- Refresh token metadata
- Track metadata changes
- Audit trail

---

### 9. PriceQuoteRequested
Emitted when a price quote is requested (analytics event).

```rust
pub struct PriceQuoteRequested {
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub token_amount: u64,          // Amount quoted
    pub estimated_cost: u64,        // Estimated SOL cost
    pub estimated_fee: u64,         // Estimated fee
    pub tokens_sold_current: u64,   // Current bonding curve state
    pub timestamp: i64,
}
```

**When**: `get_buy_quote()`  
**Use case**:
- Track price quote requests (user interest)
- Identify potential buyers
- Analytics on quote vs. execution rate

---

## Integration Examples

### Listening for Events (TypeScript/Anchor)

```typescript
import { Program } from "@coral-xyz/anchor";

// Subscribe to all TokensPurchased events
const listener = program.addEventListener("tokensPurchased", (event, slot) => {
  console.log("Buy trade:", {
    buyer: event.buyer.toString(),
    tokenAmount: event.tokenAmount.toString(),
    solAmount: event.solAmount.toString(),
    pricePerToken: event.pricePerToken.toString(),
    timestamp: new Date(event.timestamp.toNumber() * 1000),
  });
});

// Subscribe to graduations
const gradListener = program.addEventListener("curveGraduated", (event, slot) => {
  console.log("🎓 Curve graduated:", {
    launch: event.launch.toString(),
    tokensold: event.tokensSold.toString(),
    solRaised: event.solRaised.toString(),
  });
});

// Cleanup
program.removeEventListener(listener);
program.removeEventListener(gradListener);
```

### Querying Historical Events

```typescript
// Get all TokenLaunchCreated events
const signatures = await connection.getSignaturesForAddress(
  programId,
  { limit: 100 }
);

for (const sig of signatures) {
  const tx = await connection.getTransaction(sig.signature, {
    maxSupportedTransactionVersion: 0,
  });
  
  // Parse events from transaction
  const events = program.coder.events.decode(tx.meta.logMessages);
  const launches = events.filter(e => e.name === "tokenLaunchCreated");
  
  for (const event of launches) {
    console.log("Launch:", event.data.name, event.data.symbol);
  }
}
```

### Building a Price Chart

```typescript
// Subscribe to buy/sell events for price tracking
program.addEventListener("tokensPurchased", (event) => {
  updateChart({
    timestamp: event.timestamp.toNumber(),
    price: event.pricePerToken.toNumber() / 1e9, // Convert to lamports per token
    type: "buy",
    volume: event.solAmount.toNumber(),
  });
});

program.addEventListener("tokensSold", (event) => {
  updateChart({
    timestamp: event.timestamp.toNumber(),
    price: event.pricePerToken.toNumber() / 1e9,
    type: "sell",
    volume: event.solAmount.toNumber(),
  });
});
```

---

## Event Data Encoding

All events are encoded in transaction logs as:
```
Program data: <base64_encoded_event_data>
```

The Anchor framework automatically decodes these events when using the SDK.

## Compute Unit Impact

Event emissions add minimal compute overhead:
- Each event: ~200-500 compute units
- Total added with all events: ~2,000-3,000 CU
- New totals: ~84k CU (well under 200k limit)

All tests passing ✅

---

## Notes

- All lamport values are u64 (max: 18.4 quintillion)
- Token amounts include 9 decimals (1 token = 1,000,000,000)
- Timestamps are Unix timestamps (i64)
- All Pubkeys are 32-byte addresses
- Events are immutable once emitted (blockchain permanent record)
