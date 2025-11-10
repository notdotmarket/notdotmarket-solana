use anchor_lang::prelude::*;

/// Emitted when the launchpad configuration is initialized
#[event]
pub struct LaunchpadInitialized {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
}

/// Emitted when the fee recipient is updated
#[event]
pub struct FeeRecipientUpdated {
    pub authority: Pubkey,
    pub old_fee_recipient: Pubkey,
    pub new_fee_recipient: Pubkey,
}

/// Emitted when a new token launch is created
#[event]
pub struct TokenLaunchCreated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub bonding_curve: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub total_supply: u64,
    pub curve_supply: u64,
    pub creator_allocation: u64,
    pub initial_price_usd: u64,
    pub timestamp: i64,
}

/// Emitted when tokens are purchased from the bonding curve
#[event]
pub struct TokensPurchased {
    pub buyer: Pubkey,
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub token_amount: u64,
    pub sol_amount: u64,
    pub platform_fee: u64,
    pub tokens_sold_after: u64,
    pub sol_reserve_after: u64,
    pub price_per_token: u64, // in lamports per token (with decimals)
    pub timestamp: i64,
}

/// Emitted when tokens are sold back to the bonding curve
#[event]
pub struct TokensSold {
    pub seller: Pubkey,
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub token_amount: u64,
    pub sol_amount: u64,
    pub platform_fee: u64,
    pub tokens_sold_after: u64,
    pub sol_reserve_after: u64,
    pub price_per_token: u64, // in lamports per token (with decimals)
    pub timestamp: i64,
}

/// Emitted when a bonding curve graduates to liquidity pool
#[event]
pub struct CurveGraduated {
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub tokens_sold: u64,
    pub sol_raised: u64,
    pub timestamp: i64,
}

/// Emitted when a token launch is toggled active/inactive
#[event]
pub struct LaunchStatusToggled {
    pub launch: Pubkey,
    pub is_active: bool,
    pub toggled_by: Pubkey,
    pub timestamp: i64,
}

/// Emitted when metadata URI is updated
#[event]
pub struct MetadataUpdated {
    pub launch: Pubkey,
    pub mint: Pubkey,
    pub new_uri: String,
    pub updated_by: Pubkey,
    pub timestamp: i64,
}

/// Emitted when user position is created or updated
#[event]
pub struct UserPositionUpdated {
    pub user: Pubkey,
    pub launch: Pubkey,
    pub token_amount: u64,
    pub sol_invested: u64,
    pub sol_received: u64,
    pub buy_count: u32,
    pub sell_count: u32,
    pub timestamp: i64,
}

/// Emitted when price quote is requested (for analytics)
#[event]
pub struct PriceQuoteRequested {
    pub launch: Pubkey,
    pub bonding_curve: Pubkey,
    pub token_amount: u64,
    pub estimated_cost: u64,
    pub estimated_fee: u64,
    pub tokens_sold_current: u64,
    pub timestamp: i64,
}
