use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer as TokenTransfer};
use anchor_spl::associated_token::AssociatedToken;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use crate::state::*;
use crate::bonding_curve::BondingCurveCalculator;
use crate::errors::LaunchpadError;
use crate::events::*;
use crate::pyth_price::PythPriceReader;

/// Buy tokens from the bonding curve
#[derive(Accounts)]
#[instruction(amount: u64, max_sol_cost: u64)]
pub struct BuyTokens<'info> {
    #[account(
        mut,
        seeds = [
            b"token_launch",
            token_launch.mint.as_ref()
        ],
        bump = token_launch.bump,
        constraint = token_launch.is_active @ LaunchpadError::TradingInactive
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    #[account(
        mut,
        seeds = [
            b"bonding_curve",
            token_launch.key().as_ref()
        ],
        bump = bonding_curve.bump,
        constraint = !bonding_curve.is_graduated @ LaunchpadError::CurveGraduated
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(
        mut,
        associated_token::mint = token_launch.mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: SOL vault for the bonding curve
    #[account(
        mut,
        seeds = [
            b"sol_vault",
            bonding_curve.key().as_ref()
        ],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,
    
    #[account(
        init_if_needed,
        payer = buyer,
        space = UserPosition::LEN,
        seeds = [
            b"user_position",
            buyer.key().as_ref(),
            token_launch.key().as_ref()
        ],
        bump
    )]
    pub user_position: Account<'info, UserPosition>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub buyer: Signer<'info>,
    
    pub config: Account<'info, LaunchpadConfig>,
    
    /// CHECK: Fee recipient from config
    #[account(
        mut,
        constraint = fee_recipient.key() == config.fee_recipient @ LaunchpadError::InvalidFeeRecipient
    )]
    pub fee_recipient: UncheckedAccount<'info>,
    
    /// Pyth SOL/USD price feed
    pub sol_price_feed: Account<'info, PriceUpdateV2>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Sell tokens back to the bonding curve
#[derive(Accounts)]
pub struct SellTokens<'info> {
    #[account(
        mut,
        seeds = [
            b"token_launch",
            token_launch.mint.as_ref()
        ],
        bump = token_launch.bump,
        constraint = token_launch.is_active @ LaunchpadError::TradingInactive
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    #[account(
        mut,
        seeds = [
            b"bonding_curve",
            token_launch.key().as_ref()
        ],
        bump = bonding_curve.bump,
        constraint = !bonding_curve.is_graduated @ LaunchpadError::CurveGraduated
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(
        mut,
        associated_token::mint = token_launch.mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: SOL vault for the bonding curve
    #[account(
        mut,
        seeds = [
            b"sol_vault",
            bonding_curve.key().as_ref()
        ],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,
    
    #[account(
        mut,
        seeds = [
            b"user_position",
            seller.key().as_ref(),
            token_launch.key().as_ref()
        ],
        bump = user_position.bump
    )]
    pub user_position: Account<'info, UserPosition>,
    
    #[account(
        mut,
        associated_token::mint = token_launch.mint,
        associated_token::authority = seller,
        constraint = seller_token_account.amount >= user_position.token_amount @ LaunchpadError::InsufficientBalance
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub seller: Signer<'info>,
    
    pub config: Account<'info, LaunchpadConfig>,
    
    /// CHECK: Fee recipient from config
    #[account(
        mut,
        constraint = fee_recipient.key() == config.fee_recipient @ LaunchpadError::InvalidFeeRecipient
    )]
    pub fee_recipient: UncheckedAccount<'info>,
    
    /// Pyth SOL/USD price feed
    pub sol_price_feed: Account<'info, PriceUpdateV2>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> BuyTokens<'info> {
    pub fn execute(&mut self, amount: u64, max_sol_cost: u64, bumps: &BuyTokensBumps) -> Result<(u64, u64)> {
        require!(amount > 0, LaunchpadError::InvalidAmount);
        require!(
            self.bonding_curve.token_reserve >= amount,
            LaunchpadError::InsufficientLiquidity
        );
        
        // Try to read fresh SOL/USD price from Pyth, fallback to last known price if stale
        let is_fresh = PythPriceReader::is_price_fresh(&self.sol_price_feed, 60)?;
        let sol_price_usd = if is_fresh {
            let fresh_price = PythPriceReader::get_sol_price_usd(&self.sol_price_feed)?;
            msg!("Using fresh Pyth price: {}", fresh_price);
            // Update bonding curve with fresh price
            self.bonding_curve.sol_price_usd = fresh_price;
            fresh_price
        } else {
            // Use last known price from bonding curve state
            let backup_price = self.bonding_curve.sol_price_usd;
            msg!("⚠️  Pyth price is stale, using last known price: {}", backup_price);
            require!(backup_price > 0, LaunchpadError::InvalidPrice);
            backup_price
        };
        
        // Calculate cost using bonding curve with current/backup price
        let cost = BondingCurveCalculator::calculate_buy_price(
            self.bonding_curve.tokens_sold,
            amount,
            sol_price_usd,
        )?;
        
        // Calculate platform fee
        let fee = cost
            .checked_mul(self.config.platform_fee_bps as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        let total_cost = cost
            .checked_add(fee)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        require!(
            total_cost <= max_sol_cost,
            LaunchpadError::SlippageExceeded
        );
        
        // Ensure sol_vault has rent-exempt minimum (890880 lamports for 0-byte account)
        const RENT_EXEMPT_MINIMUM: u64 = 890_880;
        let vault_lamports = self.sol_vault.lamports();
        let amount_to_transfer = if vault_lamports < RENT_EXEMPT_MINIMUM {
            // First transfer: ensure vault becomes rent-exempt
            cost.checked_add(RENT_EXEMPT_MINIMUM - vault_lamports)
                .ok_or(LaunchpadError::MathOverflow)?
        } else {
            cost
        };
        
        // Transfer SOL from buyer to vault
        let transfer_to_vault = Transfer {
            from: self.buyer.to_account_info(),
            to: self.sol_vault.to_account_info(),
        };
        transfer(
            CpiContext::new(
                self.system_program.to_account_info(),
                transfer_to_vault,
            ),
            amount_to_transfer,
        )?;
        
        // Transfer fee to fee recipient
        if fee > 0 {
            let transfer_fee = Transfer {
                from: self.buyer.to_account_info(),
                to: self.fee_recipient.to_account_info(),
            };
            transfer(
                CpiContext::new(
                    self.system_program.to_account_info(),
                    transfer_fee,
                ),
                fee,
            )?;
        }
        
        // Transfer tokens from curve to buyer
        let token_launch_key = self.token_launch.key();
        let seeds = &[
            b"bonding_curve",
            token_launch_key.as_ref(),
            &[self.bonding_curve.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        let transfer_tokens = TokenTransfer {
            from: self.curve_token_account.to_account_info(),
            to: self.buyer_token_account.to_account_info(),
            authority: self.bonding_curve.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                transfer_tokens,
                signer_seeds,
            ),
            amount,
        )?;
        
        // Update bonding curve state
        self.bonding_curve.sol_reserve = self.bonding_curve.sol_reserve
            .checked_add(cost)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.token_reserve = self.bonding_curve.token_reserve
            .checked_sub(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.tokens_sold = self.bonding_curve.tokens_sold
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.total_volume = self.bonding_curve.total_volume
            .checked_add(cost)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.trade_count = self.bonding_curve.trade_count
            .checked_add(1)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Update token launch circulating supply
        self.token_launch.circulating_supply = self.token_launch.circulating_supply
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Update or initialize user position
        if self.user_position.user == Pubkey::default() {
            self.user_position.user = self.buyer.key();
            self.user_position.token_launch = self.token_launch.key();
            self.user_position.token_amount = 0;
            self.user_position.sol_invested = 0;
            self.user_position.sol_received = 0;
            self.user_position.buy_count = 0;
            self.user_position.sell_count = 0;
            self.user_position.bump = bumps.user_position;
        }
        
        self.user_position.token_amount = self.user_position.token_amount
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.user_position.sol_invested = self.user_position.sol_invested
            .checked_add(total_cost)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.user_position.buy_count = self.user_position.buy_count
            .checked_add(1)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.user_position.last_interaction = Clock::get()?.unix_timestamp;
        
        // Emit user position updated event
        emit!(UserPositionUpdated {
            user: self.buyer.key(),
            launch: self.token_launch.key(),
            token_amount: self.user_position.token_amount,
            sol_invested: self.user_position.sol_invested,
            sol_received: self.user_position.sol_received,
            buy_count: self.user_position.buy_count,
            sell_count: self.user_position.sell_count,
            timestamp: self.user_position.last_interaction,
        });
        
        msg!(
            "Bought {} tokens for {} lamports (fee: {}). Tokens sold: {}/800M",
            amount,
            cost,
            fee,
            self.bonding_curve.tokens_sold / 1_000_000_000
        );
        
        // Check if graduation threshold reached (800M tokens sold + $12k raised)
        if self.bonding_curve.should_graduate() {
            msg!("🎓 Graduation threshold reached! 800M tokens sold and $12k raised!");
            self.bonding_curve.is_graduated = true;
            
            // Emit graduation event
            emit!(CurveGraduated {
                launch: self.token_launch.key(),
                bonding_curve: self.bonding_curve.key(),
                tokens_sold: self.bonding_curve.tokens_sold,
                sol_raised: self.bonding_curve.sol_reserve,
                timestamp: Clock::get()?.unix_timestamp,
            });
            
            // Note: Actual LP creation logic would be implemented in a separate instruction
        }
        
        Ok((cost, fee))
    }
}

impl<'info> SellTokens<'info> {
    pub fn execute(&mut self, amount: u64, min_sol_output: u64, bumps: &SellTokensBumps) -> Result<(u64, u64)> {
        require!(amount > 0, LaunchpadError::InvalidAmount);
        require!(
            self.user_position.token_amount >= amount,
            LaunchpadError::InsufficientBalance
        );
        
        // Try to read fresh SOL/USD price from Pyth, fallback to last known price if stale
        let is_fresh = PythPriceReader::is_price_fresh(&self.sol_price_feed, 60)?;
        let sol_price_usd = if is_fresh {
            let fresh_price = PythPriceReader::get_sol_price_usd(&self.sol_price_feed)?;
            msg!("Using fresh Pyth price: {}", fresh_price);
            // Update bonding curve with fresh price
            self.bonding_curve.sol_price_usd = fresh_price;
            fresh_price
        } else {
            // Use last known price from bonding curve state
            let backup_price = self.bonding_curve.sol_price_usd;
            msg!("⚠️  Pyth price is stale, using last known price: {}", backup_price);
            require!(backup_price > 0, LaunchpadError::InvalidPrice);
            backup_price
        };
        
        // Calculate proceeds using bonding curve with current/backup price
        let proceeds = BondingCurveCalculator::calculate_sell_price(
            self.bonding_curve.tokens_sold,
            amount,
            sol_price_usd,
        )?;
        
        // Calculate platform fee
        let fee = proceeds
            .checked_mul(self.config.platform_fee_bps as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        let net_proceeds = proceeds
            .checked_sub(fee)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        require!(
            net_proceeds >= min_sol_output,
            LaunchpadError::SlippageExceeded
        );
        require!(
            self.bonding_curve.sol_reserve >= proceeds,
            LaunchpadError::InsufficientLiquidity
        );
        
        // Transfer tokens from seller to curve
        let transfer_tokens = TokenTransfer {
            from: self.seller_token_account.to_account_info(),
            to: self.curve_token_account.to_account_info(),
            authority: self.seller.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                self.token_program.to_account_info(),
                transfer_tokens,
            ),
            amount,
        )?;
        
        // Transfer SOL from vault to seller using PDA signer
        let bonding_curve_key = self.bonding_curve.key();
        let vault_seeds = &[
            b"sol_vault",
            bonding_curve_key.as_ref(),
            &[bumps.sol_vault],
        ];
        let vault_signer_seeds = &[&vault_seeds[..]];
        
        // Transfer net proceeds to seller
        let transfer_to_seller = Transfer {
            from: self.sol_vault.to_account_info(),
            to: self.seller.to_account_info(),
        };
        transfer(
            CpiContext::new_with_signer(
                self.system_program.to_account_info(),
                transfer_to_seller,
                vault_signer_seeds,
            ),
            net_proceeds,
        )?;
        
        // Transfer fee to fee recipient
        if fee > 0 {
            let transfer_fee = Transfer {
                from: self.sol_vault.to_account_info(),
                to: self.fee_recipient.to_account_info(),
            };
            transfer(
                CpiContext::new_with_signer(
                    self.system_program.to_account_info(),
                    transfer_fee,
                    vault_signer_seeds,
                ),
                fee,
            )?;
        }
        
        // Update bonding curve state
        self.bonding_curve.sol_reserve = self.bonding_curve.sol_reserve
            .checked_sub(proceeds)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.token_reserve = self.bonding_curve.token_reserve
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.tokens_sold = self.bonding_curve.tokens_sold
            .checked_sub(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.total_volume = self.bonding_curve.total_volume
            .checked_add(proceeds)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.bonding_curve.trade_count = self.bonding_curve.trade_count
            .checked_add(1)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Update token launch circulating supply
        self.token_launch.circulating_supply = self.token_launch.circulating_supply
            .checked_sub(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Update user position
        self.user_position.token_amount = self.user_position.token_amount
            .checked_sub(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.user_position.sol_received = self.user_position.sol_received
            .checked_add(net_proceeds)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.user_position.sell_count = self.user_position.sell_count
            .checked_add(1)
            .ok_or(LaunchpadError::MathOverflow)?;
        self.user_position.last_interaction = Clock::get()?.unix_timestamp;
        
        // Emit user position updated event
        emit!(UserPositionUpdated {
            user: self.seller.key(),
            launch: self.token_launch.key(),
            token_amount: self.user_position.token_amount,
            sol_invested: self.user_position.sol_invested,
            sol_received: self.user_position.sol_received,
            buy_count: self.user_position.buy_count,
            sell_count: self.user_position.sell_count,
            timestamp: self.user_position.last_interaction,
        });
        
        msg!(
            "Sold {} tokens for {} lamports (fee: {})",
            amount,
            net_proceeds,
            fee
        );
        
        Ok((proceeds, fee))
    }
}

/// Get current price quote for buying tokens (view function)
#[derive(Accounts)]
pub struct GetBuyQuote<'info> {
    pub token_launch: Account<'info, TokenLaunch>,
    pub bonding_curve: Account<'info, BondingCurve>,
}

impl<'info> GetBuyQuote<'info> {
    pub fn get_quote(&self, amount: u64) -> Result<BuyQuote> {
        let cost = BondingCurveCalculator::calculate_buy_price(
            self.bonding_curve.tokens_sold,
            amount,
            self.bonding_curve.sol_price_usd,
        )?;
        
        let spot_price = BondingCurveCalculator::get_spot_price(
            self.bonding_curve.tokens_sold,
            self.bonding_curve.sol_price_usd,
        )?;
        
        let slippage = BondingCurveCalculator::calculate_slippage(
            self.bonding_curve.tokens_sold,
            amount,
            self.bonding_curve.sol_price_usd,
        )?;
        
        Ok(BuyQuote {
            cost,
            spot_price,
            slippage,
        })
    }
}

/// Get current spot price on the bonding curve (view function)
#[derive(Accounts)]
pub struct GetSpotPrice<'info> {
    pub token_launch: Account<'info, TokenLaunch>,
    pub bonding_curve: Account<'info, BondingCurve>,
}

impl<'info> GetSpotPrice<'info> {
    pub fn get_current_price(&self) -> Result<SpotPrice> {
        let spot_price = BondingCurveCalculator::get_spot_price(
            self.bonding_curve.tokens_sold,
            self.bonding_curve.sol_price_usd,
        )?;
        
        Ok(SpotPrice {
            spot_price,
            tokens_sold: self.bonding_curve.tokens_sold,
            sol_reserve: self.bonding_curve.sol_reserve,
        })
    }
}
