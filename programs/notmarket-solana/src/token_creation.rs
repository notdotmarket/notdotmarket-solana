use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, MintTo};
use anchor_spl::associated_token::AssociatedToken;
use crate::state::*;
use crate::errors::LaunchpadError;

/// Initialize the launchpad configuration (admin only)
#[derive(Accounts)]
pub struct InitializeLaunchpad<'info> {
    #[account(
        init,
        payer = authority,
        space = LaunchpadConfig::LEN,
        seeds = [b"launchpad_config"],
        bump
    )]
    pub config: Account<'info, LaunchpadConfig>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// CHECK: Fee recipient can be any account
    pub fee_recipient: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Update fee recipient (admin only)
#[derive(Accounts)]
pub struct UpdateFeeRecipient<'info> {
    #[account(
        mut,
        seeds = [b"launchpad_config"],
        bump = config.bump,
        constraint = config.authority == authority.key() @ LaunchpadError::Unauthorized
    )]
    pub config: Account<'info, LaunchpadConfig>,
    
    pub authority: Signer<'info>,
}

impl<'info> UpdateFeeRecipient<'info> {
    pub fn update_fee_recipient(&mut self, new_fee_recipient: Pubkey) -> Result<()> {
        self.config.fee_recipient = new_fee_recipient;
        msg!("Fee recipient updated to: {}", new_fee_recipient);
        Ok(())
    }
}

/// Create a new token launch
#[derive(Accounts)]
#[instruction(name: String, symbol: String)]
pub struct CreateTokenLaunch<'info> {
    #[account(
        init,
        payer = creator,
        space = TokenLaunch::LEN,
        seeds = [
            b"token_launch",
            mint.key().as_ref()
        ],
        bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    #[account(
        init,
        payer = creator,
        mint::decimals = 9,
        mint::authority = bonding_curve,
        seeds = [
            b"mint",
            creator.key().as_ref(),
            name.as_bytes()
        ],
        bump
    )]
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = creator,
        space = BondingCurve::LEN,
        seeds = [
            b"bonding_curve",
            token_launch.key().as_ref()
        ],
        bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Vault to hold SOL for the bonding curve
    #[account(
        mut,
        seeds = [
            b"sol_vault",
            bonding_curve.key().as_ref()
        ],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,
    
    #[account(mut)]
    pub creator: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Context for minting initial supply to bonding curve
#[derive(Accounts)]
pub struct MintToLaunch<'info> {
    #[account(
        mut,
        seeds = [
            b"token_launch",
            mint.key().as_ref()
        ],
        bump = token_launch.bump
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    
    #[account(
        mut,
        seeds = [
            b"bonding_curve",
            token_launch.key().as_ref()
        ],
        bump = bonding_curve.bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_account: Account<'info, TokenAccount>,
    
    #[account(
        constraint = creator.key() == token_launch.creator @ LaunchpadError::Unauthorized
    )]
    pub creator: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
}

impl<'info> InitializeLaunchpad<'info> {
    pub fn initialize(
        &mut self,
        platform_fee_bps: u16,
        bump: u8,
    ) -> Result<()> {
        require!(platform_fee_bps <= 1000, LaunchpadError::InvalidFee);
        
        let config = &mut self.config;
        config.authority = self.authority.key();
        config.fee_recipient = self.fee_recipient.key();
        config.platform_fee_bps = platform_fee_bps;
        config.bump = bump;
        
        msg!("Launchpad initialized with fee: {} bps", platform_fee_bps);
        Ok(())
    }
}

impl<'info> CreateTokenLaunch<'info> {
    pub fn create(
        &mut self,
        name: String,
        symbol: String,
        metadata_uri: String,
        sol_price_usd: u64, // Current SOL price in USD (scaled by 1e8)
        bumps: &CreateTokenLaunchBumps,
    ) -> Result<()> {
        use crate::state::{TOTAL_SUPPLY, CURVE_SUPPLY};
        
        // Validate inputs
        require!(
            name.len() <= TokenLaunch::MAX_NAME_LEN,
            LaunchpadError::NameTooLong
        );
        require!(
            symbol.len() <= TokenLaunch::MAX_SYMBOL_LEN,
            LaunchpadError::SymbolTooLong
        );
        require!(
            metadata_uri.len() <= TokenLaunch::MAX_URI_LEN,
            LaunchpadError::UriTooLong
        );
        require!(
            sol_price_usd > 0,
            LaunchpadError::InvalidPrice
        );
        
        let clock = Clock::get()?;
        
        // Store the token_launch key before borrowing
        let token_launch_key = self.token_launch.key();
        
        // Initialize TokenLaunch with fixed supply
        let token_launch = &mut self.token_launch;
        token_launch.creator = self.creator.key();
        token_launch.mint = self.mint.key();
        token_launch.bonding_curve = self.bonding_curve.key();
        token_launch.name = name.clone();
        token_launch.symbol = symbol.clone();
        token_launch.metadata_uri = metadata_uri;
        token_launch.total_supply = TOTAL_SUPPLY;
        token_launch.circulating_supply = 0;
        token_launch.launch_timestamp = clock.unix_timestamp;
        token_launch.is_active = true;
        token_launch.bump = bumps.token_launch;
        
        // Initialize BondingCurve with fixed parameters
        let bonding_curve = &mut self.bonding_curve;
        bonding_curve.token_launch = token_launch_key;
        bonding_curve.sol_reserve = 0;
        bonding_curve.token_reserve = CURVE_SUPPLY; // 800M tokens for curve
        bonding_curve.tokens_sold = 0;
        bonding_curve.sol_price_usd = sol_price_usd;
        bonding_curve.total_volume = 0;
        bonding_curve.trade_count = 0;
        bonding_curve.is_graduated = false;
        bonding_curve.bump = bumps.bonding_curve;
        
        msg!(
            "Token launch created: {} ({}) - Fixed supply: 1B tokens, 800M on curve, price: $0.00000420 → $0.00006900",
            name,
            symbol
        );
        
        Ok(())
    }
    
    pub fn mint_initial_supply(&mut self) -> Result<()> {
        use crate::state::TOTAL_SUPPLY;
        
        let token_launch_key = self.token_launch.key();
        let seeds = &[
            b"bonding_curve",
            token_launch_key.as_ref(),
            &[self.bonding_curve.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        // Mint full supply (1B tokens) to bonding curve
        // The curve will hold 800M for sale, and 200M reserved for LP
        let cpi_accounts = MintTo {
            mint: self.mint.to_account_info(),
            to: self.curve_token_account.to_account_info(),
            authority: self.bonding_curve.to_account_info(),
        };
        let cpi_program = self.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        
        token::mint_to(cpi_ctx, TOTAL_SUPPLY)?;
        
        msg!("Minted 1B tokens to bonding curve (800M for sale, 200M reserved for LP)");
        Ok(())
    }
}

/// Update token launch status
#[derive(Accounts)]
pub struct UpdateTokenLaunch<'info> {
    #[account(
        mut,
        seeds = [
            b"token_launch",
            token_launch.mint.as_ref()
        ],
        bump = token_launch.bump,
        constraint = token_launch.creator == creator.key() @ LaunchpadError::Unauthorized
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    pub creator: Signer<'info>,
}

impl<'info> UpdateTokenLaunch<'info> {
    pub fn toggle_active(&mut self) -> Result<()> {
        self.token_launch.is_active = !self.token_launch.is_active;
        msg!("Token launch active status: {}", self.token_launch.is_active);
        Ok(())
    }
    
    pub fn update_metadata_uri(&mut self, new_uri: String) -> Result<()> {
        require!(
            new_uri.len() <= TokenLaunch::MAX_URI_LEN,
            LaunchpadError::UriTooLong
        );
        self.token_launch.metadata_uri = new_uri;
        msg!("Updated metadata URI");
        Ok(())
    }
}
