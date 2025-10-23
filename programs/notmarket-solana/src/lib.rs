use anchor_lang::prelude::*;

declare_id!("9afoMEfpJbXduHMWxTMTJJzTzRuJL8cCPVzXuxVF8auK");

pub mod state;
pub mod errors;
pub mod events;
pub mod bonding_curve;
pub mod token_creation;
pub mod trading;

use state::*;
use errors::*;
use events::*;
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
        ctx.accounts.initialize(platform_fee_bps, ctx.bumps.config)?;
        
        emit!(LaunchpadInitialized {
            authority: ctx.accounts.authority.key(),
            fee_recipient: ctx.accounts.fee_recipient.key(),
            platform_fee_bps,
        });
        
        Ok(())
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
            name.clone(),
            symbol.clone(),
            metadata_uri.clone(),
            sol_price_usd,
            &ctx.bumps,
        )?;
        
        // Mint full supply (1B tokens) to bonding curve
        ctx.accounts.mint_initial_supply()?;
        
        let clock = Clock::get()?;
        emit!(TokenLaunchCreated {
            launch: ctx.accounts.token_launch.key(),
            mint: ctx.accounts.mint.key(),
            creator: ctx.accounts.creator.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            name,
            symbol,
            uri: metadata_uri,
            total_supply: ctx.accounts.token_launch.total_supply,
            curve_supply: ctx.accounts.bonding_curve.token_reserve,
            creator_allocation: ctx.accounts.token_launch.total_supply - ctx.accounts.bonding_curve.token_reserve,
            initial_price_usd: sol_price_usd,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Toggle active status of a token launch
    pub fn toggle_token_launch_active(
        ctx: Context<UpdateTokenLaunch>,
    ) -> Result<()> {
        ctx.accounts.toggle_active()?;
        
        let clock = Clock::get()?;
        emit!(LaunchStatusToggled {
            launch: ctx.accounts.token_launch.key(),
            is_active: ctx.accounts.token_launch.is_active,
            toggled_by: ctx.accounts.creator.key(),
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Update metadata URI for a token launch
    pub fn update_metadata_uri(
        ctx: Context<UpdateTokenLaunch>,
        new_uri: String,
    ) -> Result<()> {
        ctx.accounts.update_metadata_uri(new_uri.clone())?;
        
        let clock = Clock::get()?;
        emit!(MetadataUpdated {
            launch: ctx.accounts.token_launch.key(),
            mint: ctx.accounts.token_launch.mint,
            new_uri,
            updated_by: ctx.accounts.creator.key(),
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Buy tokens from the bonding curve
    pub fn buy_tokens(
        ctx: Context<BuyTokens>,
        amount: u64,
        max_sol_cost: u64,
    ) -> Result<()> {
        // Capture state before execution for event
        let sol_reserve_before = ctx.accounts.bonding_curve.sol_reserve;
        
        ctx.accounts.execute(amount, max_sol_cost, &ctx.bumps)?;
        
        // Calculate cost from SOL reserve difference
        let cost = ctx.accounts.bonding_curve.sol_reserve.saturating_sub(sol_reserve_before);
        let price_per_token = if amount > 0 {
            cost.checked_mul(1_000_000_000).unwrap_or(0) / amount
        } else {
            0
        };
        
        let clock = Clock::get()?;
        emit!(TokensPurchased {
            buyer: ctx.accounts.buyer.key(),
            launch: ctx.accounts.token_launch.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            token_amount: amount,
            sol_amount: cost,
            platform_fee: cost.checked_mul(ctx.accounts.config.platform_fee_bps as u64).unwrap_or(0) / 10000,
            tokens_sold_after: ctx.accounts.bonding_curve.tokens_sold,
            sol_reserve_after: ctx.accounts.bonding_curve.sol_reserve,
            price_per_token,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Sell tokens back to the bonding curve
    pub fn sell_tokens(
        ctx: Context<SellTokens>,
        amount: u64,
        min_sol_output: u64,
    ) -> Result<()> {
        // Capture state before execution for event
        let sol_reserve_before = ctx.accounts.bonding_curve.sol_reserve;
        
        ctx.accounts.execute(amount, min_sol_output, &ctx.bumps)?;
        
        // Calculate proceeds from reserve difference
        let proceeds = sol_reserve_before - ctx.accounts.bonding_curve.sol_reserve;
        let price_per_token = if amount > 0 {
            proceeds.checked_mul(1_000_000_000).unwrap_or(0) / amount
        } else {
            0
        };
        
        let clock = Clock::get()?;
        emit!(TokensSold {
            seller: ctx.accounts.seller.key(),
            launch: ctx.accounts.token_launch.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            token_amount: amount,
            sol_amount: proceeds,
            platform_fee: proceeds.checked_mul(ctx.accounts.config.platform_fee_bps as u64).unwrap_or(0) / 10000,
            tokens_sold_after: ctx.accounts.bonding_curve.tokens_sold,
            sol_reserve_after: ctx.accounts.bonding_curve.sol_reserve,
            price_per_token,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Get a price quote for buying tokens (view function)
    pub fn get_buy_quote(
        ctx: Context<GetBuyQuote>,
        amount: u64,
    ) -> Result<(u64, u64, u16)> {
        let (cost, _spot_price, _slippage) = ctx.accounts.get_quote(amount)?;
        
        // Calculate fee
        let fee = cost.checked_mul(100).unwrap_or(0) / 10000; // 1% platform fee
        
        let clock = Clock::get()?;
        emit!(PriceQuoteRequested {
            launch: ctx.accounts.token_launch.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            token_amount: amount,
            estimated_cost: cost,
            estimated_fee: fee,
            tokens_sold_current: ctx.accounts.bonding_curve.tokens_sold,
            timestamp: clock.unix_timestamp,
        });
        
        ctx.accounts.get_quote(amount)
    }
}
