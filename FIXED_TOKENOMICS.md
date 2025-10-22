# Fixed Tokenomics Implementation

## Overview

The bonding curve has been updated to implement fixed tokenomics for all token launches:

### Fixed Parameters

- **Total Supply**: 1,000,000,000 tokens (1 billion with 9 decimals)
- **Tokens on Bonding Curve**: 800,000,000 tokens (800M for sale)
- **Tokens Reserved for LP**: 200,000,000 tokens (200M)
- **Graduation Threshold**: $12,000 USD raised

### Price Range

- **Starting Price**: $0.00000420 per token
- **Ending Price**: $0.00006900 per token
- **Curve Type**: Exponential growth

## Mathematical Implementation

### Exponential Bonding Curve Formula

```
price(tokens_sold) = START_PRICE * e^(k * tokens_sold)
```

Where:
- `k` is the exponential growth constant
- `k = ln(END_PRICE / START_PRICE) / CURVE_SUPPLY`
- `k ≈ 2.798 / 800,000,000 ≈ 3.4975 × 10^-9`

### Cost Calculation

The cost to buy `amount` tokens is the integral of the price function:

```
cost = ∫[tokens_sold to tokens_sold+amount] START_PRICE * e^(k*x) dx
     = (START_PRICE/k) * [e^(k*(tokens_sold+amount)) - e^(k*tokens_sold)]
```

### USD to SOL Conversion

All calculations are done in USD, then converted to SOL lamports:

```
lamports = (cost_usd / sol_price_usd) * 1_000_000_000
```

## Graduation Logic

A token graduates to DEX when **BOTH** conditions are met:

1. **800 million tokens sold** (full bonding curve)
2. **$12,000 USD raised** in the SOL reserves

The `BondingCurve::should_graduate()` function checks both conditions automatically.

## Key Changes

### 1. State Module (`state.rs`)

**Added Constants:**
```rust
pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000_000; // 1B with decimals
pub const CURVE_SUPPLY: u64 = 800_000_000_000_000_000;   // 800M
pub const LP_SUPPLY: u64 = 200_000_000_000_000_000;      // 200M
pub const GRADUATION_USD: u64 = 12_000;                  // $12k
pub const START_PRICE_USD: u64 = 420;                    // $0.00000420 scaled
pub const END_PRICE_USD: u64 = 6_900;                    // $0.00006900 scaled
```

**Updated BondingCurve Structure:**
- Removed: `base_price`, `curve_coefficient`, `graduation_threshold`
- Added: `tokens_sold`, `sol_price_usd`
- Added method: `should_graduate()` - checks both token and USD thresholds

### 2. Bonding Curve Module (`bonding_curve.rs`)

**Updated Functions:**
- `calculate_k()` - Computes exponential constant from fixed price range
- `calculate_buy_price(tokens_sold, amount, sol_price_usd)` - Simplified parameters
- `calculate_sell_price(tokens_sold, amount, sol_price_usd)` - Matches buy signature
- `get_spot_price(tokens_sold, sol_price_usd)` - Current price at any point
- `calculate_slippage(tokens_sold, amount, sol_price_usd)` - Price impact
- `calculate_usd_raised(sol_reserve, sol_price_usd)` - Total USD raised

**New Implementation:**
- Uses Taylor series for e^x calculation (20 terms for precision)
- All calculations in USD, converted to SOL at the end
- Fixed 1e12 scaling factor for precision

### 3. Token Creation Module (`token_creation.rs`)

**Simplified `create()` Function:**
- Removed parameters: `total_supply`, `base_price`, `curve_coefficient`, `graduation_threshold`
- Added parameter: `sol_price_usd` (only dynamic parameter needed)
- Automatically sets: 1B total supply, 800M on curve, 200M for LP

**Updated `mint_initial_supply()`:**
- No longer takes amount parameter
- Always mints exactly 1 billion tokens
- Logs: "Minted 1B tokens (800M for sale, 200M reserved for LP)"

### 4. Trading Module (`trading.rs`)

**BuyTokens Updates:**
- Uses `tokens_sold` instead of `circulating_supply`
- Tracks `tokens_sold` separately from `token_reserve`
- Checks `should_graduate()` after each purchase
- Sets `is_graduated = true` when threshold met

**SellTokens Updates:**
- Uses new bonding curve API
- Decrements `tokens_sold` on sells
- Updates both `token_reserve` and `tokens_sold`

**GetBuyQuote Updates:**
- Uses simplified bonding curve parameters
- Returns (cost, spot_price, slippage)

### 5. Main Program (`lib.rs`)

**Updated `create_token_launch` Signature:**
```rust
pub fn create_token_launch(
    ctx: Context<CreateTokenLaunch>,
    name: String,
    symbol: String,
    metadata_uri: String,
    sol_price_usd: u64, // Only dynamic parameter
) -> Result<()>
```

## Usage Example

### Creating a Token Launch

```typescript
await program.methods
  .createTokenLaunch(
    "MyToken",                  // name
    "MTK",                      // symbol
    "https://...",              // metadata_uri
    new BN(15_000_000_000)      // sol_price_usd ($150 scaled by 1e8)
  )
  .accounts({
    // ... accounts
  })
  .rpc();
```

### Buying Tokens

```typescript
// Buy 1 million tokens
const amount = new BN(1_000_000_000_000_000); // 1M with decimals
const maxSolCost = new BN(5_000_000_000);     // 5 SOL max

await program.methods
  .buyTokens(amount, maxSolCost)
  .accounts({
    // ... accounts
  })
  .rpc();
```

### Price at Different Points

**At Start (0 tokens sold):**
- Price: $0.00000420 per token
- To buy 1M tokens: ~$4.20 (varies with actual integral)

**At 400M tokens sold (halfway):**
- Price: ~$0.00001376 per token (grows exponentially)
- Approximately: $0.00000420 * e^(k * 400M)

**At 800M tokens sold (end):**
- Price: $0.00006900 per token
- Graduation triggered if $12k raised

## Graduation Flow

1. User buys tokens
2. After state updates, check `bonding_curve.should_graduate()`
3. If true:
   - Set `is_graduated = true`
   - Log graduation message
   - (In production: trigger LP creation instruction)
4. 200M tokens + $12k SOL moved to DEX liquidity pool
5. Trading continues on DEX

## SOL Price Oracle

The `sol_price_usd` parameter should be updated via:
- Pyth Network oracle
- Switchboard oracle
- Admin instruction (for testing)

**Important:** The price affects lamports calculations but not USD pricing. If SOL = $150, users pay less SOL for the same USD amount of tokens.

## Benefits

1. **Predictable**: Every token has same curve ($0.00000420 → $0.00006900)
2. **Fair Launch**: No pre-mine, all tokens sold through curve or LP
3. **Automatic Graduation**: No manual intervention needed
4. **Protection**: Can't graduate without reaching both thresholds
5. **Transparency**: Fixed supply and pricing model

## Testing

Run tests:
```bash
anchor test
```

Test scenarios include:
- First 1M tokens purchase
- Starting spot price
- Ending spot price (near 800M)
- Graduation condition check
- USD raised calculation

## Future Enhancements

- [ ] Pyth/Switchboard oracle integration for SOL price
- [ ] Automatic LP creation instruction on graduation
- [ ] Raydium/Orca pool setup
- [ ] Migration of 200M + $12k to LP
- [ ] Trading disable after graduation
- [ ] LP token distribution to bonding curve participants
