# NotMarket Solana - Token Launchpad

A comprehensive Solana-based token launchpad with bonding curve mechanics built using Anchor framework.

## Architecture Overview

This project implements a modular token launchpad with the following key features:

### Module Structure

```
src/
├── lib.rs                 # Main program entry point
├── state.rs              # Account structures and state management
├── bonding_curve.rs      # Exponential bonding curve mathematics
├── token_creation.rs     # Token launch and initialization
├── trading.rs            # Buy/sell trading logic
└── errors.rs             # Custom error definitions
```

## Core Modules

### 1. State Module (`state.rs`)
Defines all account structures for the launchpad:

- **LaunchpadConfig**: Platform-wide configuration
  - Authority management
  - Fee recipient
  - Platform fee in basis points

- **TokenLaunch**: Individual token launch data
  - Creator, mint, and bonding curve references
  - Metadata (name, symbol, URI)
  - Supply tracking (total, circulating)
  - Active status

- **BondingCurve**: Price discovery mechanism
  - SOL and token reserves
  - Base price and curve coefficient
  - Volume and trade statistics
  - Graduation threshold for DEX listing

- **UserPosition**: User-specific tracking
  - Token holdings
  - Investment tracking (SOL in/out)
  - Trade history

### 2. Bonding Curve Module (`bonding_curve.rs`)
Implements exponential bonding curve using fixed-point arithmetic:

**Formula**: `price = base_price * e^(coefficient * supply)`

**Key Functions**:
- `calculate_buy_price()`: Calculate cost for buying tokens
- `calculate_sell_price()`: Calculate proceeds from selling tokens
- `get_spot_price()`: Current price at supply level
- `calculate_slippage()`: Slippage estimation
- `exp_taylor()`: Taylor series approximation for e^x

**Note**: Uses custom fixed-point math (scale: 1e12) to avoid dependency conflicts with spl-math 0.3.0.

### 3. Token Creation Module (`token_creation.rs`)
Handles token launch lifecycle:

**Instructions**:
- `InitializeLaunchpad`: Setup platform configuration
- `CreateTokenLaunch`: Create new token with bonding curve
  - Initializes mint with bonding curve as authority
  - Creates bonding curve account
  - Mints initial supply to curve
- `UpdateTokenLaunch`: Toggle active status or update metadata

**Account Management**:
- PDA-based account creation
- Automatic token account setup
- SOL vault for curve reserves

### 4. Trading Module (`trading.rs`)
Implements buy/sell functionality:

**Instructions**:
- `BuyTokens`: Purchase tokens from bonding curve
  - Price calculation via bonding curve
  - Slippage protection (max_sol_cost)
  - Platform fee deduction
  - User position tracking
  - Graduation threshold monitoring

- `SellTokens`: Sell tokens back to curve
  - Reverse price calculation
  - Slippage protection (min_sol_output)
  - Platform fee on proceeds
  - Position updates

- `GetBuyQuote`: View-only price quote

**Features**:
- Automatic user position creation (`init_if_needed`)
- Associated token account management
- Fee distribution to platform
- Volume and trade count tracking

### 5. Errors Module (`errors.rs`)
Comprehensive error handling:
- Input validation errors
- Math overflow protection
- Liquidity constraints
- Authorization checks
- Slippage protection

## Key Design Decisions

### 1. Exponential Bonding Curve
- Provides natural price discovery
- Early buyers rewarded with lower prices
- Price increases exponentially with supply
- Encourages gradual token distribution

### 2. PDA-Based Architecture
- Deterministic account addresses
- Security through program-derived addresses
- Seeds: `[b"prefix", reference_key, bump]`

### 3. Graduation Mechanism
- Tokens "graduate" to DEX when threshold reached
- Prevents manipulation on bonding curve
- Provides liquidity exit strategy

### 4. User Position Tracking
- Transparent investment history
- P&L calculation capability
- Trade frequency monitoring

## Dependencies

```toml
anchor-lang = { version = "0.31.1", features = ["init-if-needed"] }
anchor-spl = "0.31.1"
spl-math = { version = "0.3.0", features = ["no-entrypoint"] }
```

## Usage Example

### 1. Initialize Launchpad
```rust
initialize_launchpad(
    ctx,
    platform_fee_bps: 100, // 1%
)
```

### 2. Create Token Launch
```rust
create_token_launch(
    ctx,
    name: "MyToken",
    symbol: "MTK",
    metadata_uri: "https://...",
    total_supply: 1_000_000_000, // 1B tokens
    base_price: 1_000_000,      // 0.001 SOL
    curve_coefficient: 100_000,  // Exponential factor
    graduation_threshold: 100_000_000_000, // 100 SOL
)
```

### 3. Buy Tokens
```rust
buy_tokens(
    ctx,
    amount: 1000,
    max_sol_cost: 5_000_000, // Slippage protection
)
```

### 4. Sell Tokens
```rust
sell_tokens(
    ctx,
    amount: 500,
    min_sol_output: 2_000_000, // Slippage protection
)
```

## Security Considerations

1. **Slippage Protection**: Users specify max/min amounts
2. **Authority Checks**: Creator-only operations
3. **Overflow Protection**: Checked math throughout
4. **Graduation Locks**: Trading disabled after graduation
5. **PDA Security**: Program-controlled accounts

## Testing

Run tests:
```bash
anchor test
```

Build:
```bash
anchor build
```

## Bonding Curve Parameters

**Recommended Starting Values**:
- `base_price`: 1_000_000 lamports (0.001 SOL)
- `curve_coefficient`: 50_000 - 200_000
  - Lower = gradual price increase
  - Higher = steeper curve
- `graduation_threshold`: 50-200 SOL

**Formula Visualization**:
- At supply = 0: price = base_price
- At supply = 1000: price = base_price * e^(k * 1000)
- Integral pricing for fair buys/sells

## Future Enhancements

- [ ] Metaplex metadata integration
- [ ] DEX graduation automation (Raydium/Orca)
- [ ] Referral system
- [ ] Time-locked launches
- [ ] Anti-bot mechanisms
- [ ] Treasury management for graduated tokens
- [ ] Analytics dashboard integration

## License

MIT

## Contributing

Pull requests welcome! Please ensure:
1. Code compiles without errors
2. Tests pass
3. Documentation updated
4. Security considerations addressed
