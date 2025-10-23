# Fee Distribution & Liquidity Transfer Analysis

## Current State Analysis

### 1. Trading Fees Distribution

**Where fees go:**
- **Fee Recipient**: `config.fee_recipient` (set during initialization)
- **Fee Rate**: `platform_fee_bps` (100 bps = 1%)

**Buy Transaction:**
```
User pays: token_cost + fee
├── token_cost → sol_vault (bonding curve reserve)
└── fee → fee_recipient (platform treasury)
```

**Sell Transaction:**
```
SOL from sol_vault:
├── net_proceeds → seller
└── fee → fee_recipient (platform treasury)
```

**Code Location:** `programs/notmarket-solana/src/trading.rs`
- Lines 225-242 (buy fees)
- Lines 421-439 (sell fees)

### 2. Current Assets in PDAs

After graduation (800M tokens sold + $12k raised):

**sol_vault PDA** holds:
- ~$12,000 worth of SOL (actual lamports based on trades)
- Used for: Bonding curve buy/sell operations

**curve_token_account** holds:
- 200M tokens reserved for LP (never sold on curve)
- 0-800M tokens still available (depending on sales)

**Note**: Currently there's NO automated LP creation - just graduation flag!

---

## What Needs to Be Implemented

### LP Creation Instruction

Create a new instruction to transfer assets from PDAs to DEX after graduation:

```rust
pub struct CreateLiquidityPool<'info> {
    #[account(
        constraint = bonding_curve.is_graduated @ LaunchpadError::NotGraduated
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(mut)]
    pub sol_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub curve_token_account: Account<'info, TokenAccount>,
    
    // DEX accounts (Raydium/Orca)
    pub dex_pool: AccountInfo<'info>,
    pub dex_sol_vault: AccountInfo<'info>,
    pub dex_token_vault: AccountInfo<'info>,
    
    // ... other DEX-specific accounts
}
```

**Assets to Transfer:**
1. **SOL**: All from `sol_vault` → DEX SOL side
2. **Tokens**: 200M from `curve_token_account` → DEX token side

---

## Test Implementation

I'll create a comprehensive test that:
1. Simulates graduation (800M tokens + $12k)
2. Tests transferring SOL from sol_vault PDA
3. Tests transferring tokens from curve_token_account PDA
4. Verifies PDA signing works correctly
5. Checks fee recipient accumulated fees

Would you like me to:
1. ✅ Create the LP creation instruction in the contract
2. ✅ Add tests for PDA → DEX transfer logic
3. ✅ Verify fee recipient tracking
