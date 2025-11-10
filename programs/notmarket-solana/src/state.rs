use anchor_lang::prelude::*;

/// Fixed tokenomics constants
pub const TOTAL_SUPPLY: u64 = 1_000_000_000_000_000_000; // 1 billion tokens (with 9 decimals)
pub const CURVE_SUPPLY: u64 = 800_000_000_000_000_000;   // 800 million on bonding curve
pub const LP_SUPPLY: u64 = 200_000_000_000_000_000;      // 200 million for LP
pub const GRADUATION_USD: u64 = 12_000;                  // $12,000 USD threshold

// Bonding curve price range (in lamports per token with decimals)
// Starting price: $0.00000420 
// Ending price: $0.00006900
// Assuming SOL = $150 USD (can be adjusted)
pub const START_PRICE_USD: u64 = 420;        // $0.00000420 * 100_000_000 (scaled)
pub const END_PRICE_USD: u64 = 6_900;        // $0.00006900 * 100_000_000 (scaled)
pub const USD_SCALE: u64 = 100_000_000;      // Scale factor for USD calculations

/// Main configuration account for the launchpad
#[account]
pub struct LaunchpadConfig {
    /// Authority that can update launchpad settings
    pub authority: Pubkey,
    /// Fee recipient for platform fees
    pub fee_recipient: Pubkey,
    /// Platform fee in basis points (e.g., 100 = 1%)
    pub platform_fee_bps: u16,
    /// Bump seed for PDA
    pub bump: u8,
}

impl LaunchpadConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // fee_recipient
        2 +  // platform_fee_bps
        1;   // bump
}

/// Represents a token launch on the platform
#[account]
pub struct TokenLaunch {
    /// Creator of the token
    pub creator: Pubkey,
    /// Mint address of the token
    pub mint: Pubkey,
    /// Associated bonding curve
    pub bonding_curve: Pubkey,
    /// Token metadata URI
    pub metadata_uri: String,
    /// Token name
    pub name: String,
    /// Token symbol
    pub symbol: String,
    /// Total supply
    pub total_supply: u64,
    /// Current circulating supply
    pub circulating_supply: u64,
    /// Timestamp of launch
    pub launch_timestamp: i64,
    /// Whether trading is active
    pub is_active: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl TokenLaunch {
    pub const MAX_URI_LEN: usize = 200;
    pub const MAX_NAME_LEN: usize = 32;
    pub const MAX_SYMBOL_LEN: usize = 10;
    
    pub const LEN: usize = 8 + // discriminator
        32 + // creator
        32 + // mint
        32 + // bonding_curve
        4 + Self::MAX_URI_LEN + // metadata_uri (String)
        4 + Self::MAX_NAME_LEN + // name (String)
        4 + Self::MAX_SYMBOL_LEN + // symbol (String)
        8 +  // total_supply
        8 +  // circulating_supply
        8 +  // launch_timestamp
        1 +  // is_active
        1;   // bump
}

/// Bonding curve state for pricing
#[account]
pub struct BondingCurve {
    /// Associated token launch
    pub token_launch: Pubkey,
    /// Reserve of SOL in the curve
    pub sol_reserve: u64,
    /// Reserve of tokens in the curve (remaining to sell)
    pub token_reserve: u64,
    /// Tokens sold so far
    pub tokens_sold: u64,
    /// SOL price in USD (scaled by 1e8) - updated via oracle
    pub sol_price_usd: u64,
    /// Total volume traded (in lamports)
    pub total_volume: u64,
    /// Number of trades
    pub trade_count: u64,
    /// Whether the curve has graduated to DEX
    pub is_graduated: bool,
    /// Bump seed for PDA
    pub bump: u8,
}

impl BondingCurve {
    pub const LEN: usize = 8 + // discriminator
        32 + // token_launch
        8 +  // sol_reserve
        8 +  // token_reserve
        8 +  // tokens_sold
        8 +  // sol_price_usd
        8 +  // total_volume
        8 +  // trade_count
        1 +  // is_graduated
        1;   // bump
    
    /// Check if curve has reached graduation (800M tokens sold, $12k raised)
    pub fn should_graduate(&self) -> bool {
        if self.is_graduated {
            return false;
        }
        
        // Check if 800M tokens sold
        let tokens_sold_check = self.tokens_sold >= CURVE_SUPPLY;
        
        // Check if $12k USD raised (sol_reserve * sol_price_usd / scale >= 12000 * scale)
        let usd_raised = (self.sol_reserve as u128)
            .checked_mul(self.sol_price_usd as u128)
            .unwrap_or(0)
            / (1_000_000_000u128); // Divide by 1e9 (SOL decimals)
        
        let usd_threshold = (GRADUATION_USD as u128)
            .checked_mul(USD_SCALE as u128)
            .unwrap_or(0);
        
        tokens_sold_check && usd_raised >= usd_threshold
    }
}

/// User position in a token launch
#[account]
pub struct UserPosition {
    /// User's wallet address
    pub user: Pubkey,
    /// Token launch this position is for
    pub token_launch: Pubkey,
    /// Amount of tokens held
    pub token_amount: u64,
    /// Total SOL invested
    pub sol_invested: u64,
    /// Total SOL received from sells
    pub sol_received: u64,
    /// Number of buys
    pub buy_count: u32,
    /// Number of sells
    pub sell_count: u32,
    /// Last interaction timestamp
    pub last_interaction: i64,
    /// Bump seed for PDA
    pub bump: u8,
}

impl UserPosition {
    pub const LEN: usize = 8 + // discriminator
        32 + // user
        32 + // token_launch
        8 +  // token_amount
        8 +  // sol_invested
        8 +  // sol_received
        4 +  // buy_count
        4 +  // sell_count
        8 +  // last_interaction
        1;   // bump
}

/// Return type for buy quote view function
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct BuyQuote {
    /// Total cost in lamports to buy the tokens
    pub cost: u64,
    /// Current spot price per token in lamports
    pub spot_price: u64,
    /// Slippage in basis points (e.g., 100 = 1%)
    pub slippage: u16,
}

/// Return type for spot price view function
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SpotPrice {
    /// Current spot price per token in lamports
    pub spot_price: u64,
    /// Total tokens sold so far
    pub tokens_sold: u64,
    /// Current SOL reserve in the bonding curve
    pub sol_reserve: u64,
}
