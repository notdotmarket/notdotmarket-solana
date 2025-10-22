use anchor_lang::prelude::*;

declare_id!("9afoMEfpJbXduHMWxTMTJJzTzRuJL8cCPVzXuxVF8auK");

pub mod state;
pub mod errors;
pub mod bonding_curve;
pub mod token_creation;
pub mod trading;

use state::*;
use errors::*;
use token_creation::*;
use trading::*;

#[program]
pub mod notmarket_solana {
    use super::*;

    /// Initialize the launchpad with configuration
    pub fn initialize_launchpad(
        ctx: Context<InitializeLaunchpad>,
        platform_fee_bps: u16,
    ) -> Result<()> {
        ctx.accounts.initialize(platform_fee_bps, ctx.bumps.config)
    }

    /// Create a new token launch with bonding curve
    /// Fixed parameters: 1B supply, 800M on curve, 200M for LP
    /// Price range: $0.00000420 → $0.00006900
    pub fn create_token_launch(
        ctx: Context<CreateTokenLaunch>,
        name: String,
        symbol: String,
        metadata_uri: String,
        sol_price_usd: u64, // Current SOL price in USD (scaled by 1e8, e.g., $150 = 15_000_000_000)
    ) -> Result<()> {
        ctx.accounts.create(
            name,
            symbol,
            metadata_uri,
            sol_price_usd,
            &ctx.bumps,
        )?;
        
        // Mint full supply (1B tokens) to bonding curve
        ctx.accounts.mint_initial_supply()
    }

    /// Toggle active status of a token launch
    pub fn toggle_token_launch_active(
        ctx: Context<UpdateTokenLaunch>,
    ) -> Result<()> {
        ctx.accounts.toggle_active()
    }

    /// Update metadata URI for a token launch
    pub fn update_metadata_uri(
        ctx: Context<UpdateTokenLaunch>,
        new_uri: String,
    ) -> Result<()> {
        ctx.accounts.update_metadata_uri(new_uri)
    }

    /// Buy tokens from the bonding curve
    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        amount: u64,
        max_sol_cost: u64,
    ) -> Result<()> {
        ctx.accounts.execute(amount, max_sol_cost, &ctx.bumps)
    }

    /// Sell tokens back to the bonding curve
    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        amount: u64,
        min_sol_output: u64,
    ) -> Result<()> {
        ctx.accounts.execute(amount, min_sol_output)
    }

    /// Get a price quote for buying tokens (view function)
    pub fn get_buy_quote(
        ctx: Context<GetBuyQuote>,
        amount: u64,
    ) -> Result<(u64, u64, u16)> {
        ctx.accounts.get_quote(amount)
    }
}
