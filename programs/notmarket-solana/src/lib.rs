use anchor_lang::prelude::*;

declare_id!("3CLmRQ4Sudgb3CVtu8cSeN2muqxCcZhiq9bP3aWqspjC");

pub mod state;
pub mod errors;
pub mod events;
pub mod bonding_curve;
pub mod token_creation;
pub mod trading;
pub mod liquidity;
pub mod pyth_price;

use state::*;
use events::*;
use token_creation::*;
use trading::*;
use liquidity::*;
use pyth_price::*;

// Re-export return types for IDL generation
pub use state::{BuyQuote, SpotPrice};

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

    /// Update the fee recipient address (admin only)
    pub fn update_fee_recipient(
        ctx: Context<UpdateFeeRecipient>,
        new_fee_recipient: Pubkey,
    ) -> Result<()> {
        ctx.accounts.update_fee_recipient(new_fee_recipient)?;
        
        emit!(FeeRecipientUpdated {
            authority: ctx.accounts.authority.key(),
            old_fee_recipient: ctx.accounts.config.fee_recipient,
            new_fee_recipient,
        });
        
        Ok(())
    }

    /// Update admin authority (admin only)
    pub fn update_admin(
        ctx: Context<UpdateAdmin>,
        new_authority: Pubkey,
    ) -> Result<()> {
        let old_authority = ctx.accounts.config.authority;
        ctx.accounts.update_authority(new_authority)?;
        
        let clock = Clock::get()?;
        emit!(AdminChanged {
            old_authority,
            new_authority,
            changed_by: ctx.accounts.authority.key(),
            timestamp: clock.unix_timestamp,
        });
        
        Ok(())
    }

    /// Update whitelisted wallets for token launches (admin only)
    pub fn update_whitelisted_wallets(
        ctx: Context<UpdateWhitelistedWallets>,
        whitelisted_wallet_1: Pubkey,
        whitelisted_wallet_2: Pubkey,
    ) -> Result<()> {
        ctx.accounts.update_whitelisted_wallets(whitelisted_wallet_1, whitelisted_wallet_2)?;
        
        let clock = Clock::get()?;
        emit!(WhitelistedWalletsUpdated {
            authority: ctx.accounts.authority.key(),
            whitelisted_wallet_1,
            whitelisted_wallet_2,
            timestamp: clock.unix_timestamp,
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
        description: String,
        sol_price_usd: u64, // Current SOL price in USD (scaled by 1e8, e.g., $150 = 15_000_000_000)
    ) -> Result<()> {
        ctx.accounts.create(
            name.clone(),
            symbol.clone(),
            metadata_uri.clone(),
            description.clone(),
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
            description,
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

    /// Update description for a token launch
    pub fn update_description(
        ctx: Context<UpdateTokenLaunch>,
        new_description: String,
    ) -> Result<()> {
        ctx.accounts.update_description(new_description.clone())?;
        
        let clock = Clock::get()?;
        emit!(DescriptionUpdated {
            launch: ctx.accounts.token_launch.key(),
            mint: ctx.accounts.token_launch.mint,
            new_description,
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
        // Execute buy and get actual cost and fee from bonding curve calculation
        let (cost, fee) = ctx.accounts.execute(amount, max_sol_cost, &ctx.bumps)?;
        
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
            platform_fee: fee,
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
        // Execute sell and get actual proceeds and fee from bonding curve calculation
        let (proceeds, fee) = ctx.accounts.execute(amount, min_sol_output, &ctx.bumps)?;
        
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
            platform_fee: fee,
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
    ) -> Result<BuyQuote> {
        let quote = ctx.accounts.get_quote(amount)?;
        
        // Calculate fee for logging
        let fee = quote.cost.checked_mul(100).unwrap_or(0) / 10000; // 1% platform fee
        
        let clock = Clock::get()?;
        emit!(PriceQuoteRequested {
            launch: ctx.accounts.token_launch.key(),
            bonding_curve: ctx.accounts.bonding_curve.key(),
            token_amount: amount,
            estimated_cost: quote.cost,
            estimated_fee: fee,
            tokens_sold_current: ctx.accounts.bonding_curve.tokens_sold,
            timestamp: clock.unix_timestamp,
        });
        
        Ok(quote)
    }

    /// Get the current spot price at the bonding curve (view function)
    /// Returns: SpotPrice struct with current pricing information
    pub fn get_spot_price(
        ctx: Context<GetSpotPrice>,
    ) -> Result<SpotPrice> {
        ctx.accounts.get_current_price()
    }

    /// Withdraw liquidity after graduation (for LP creation)
    pub fn withdraw_liquidity(
        ctx: Context<WithdrawLiquidity>,
    ) -> Result<()> {
        ctx.accounts.execute(&ctx.bumps)
    }
}
