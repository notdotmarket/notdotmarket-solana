use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer as TokenTransfer};
use anchor_lang::system_program::{transfer, Transfer};
use crate::state::*;
use crate::errors::LaunchpadError;

/// Withdraw liquidity after graduation to create DEX pool
/// This transfers SOL and tokens from PDAs to specified recipient
#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(
        mut,
        seeds = [
            b"token_launch",
            token_launch.mint.as_ref()
        ],
        bump = token_launch.bump,
        constraint = token_launch.creator == authority.key() @ LaunchpadError::Unauthorized
    )]
    pub token_launch: Account<'info, TokenLaunch>,
    
    #[account(
        mut,
        seeds = [
            b"bonding_curve",
            token_launch.key().as_ref()
        ],
        bump = bonding_curve.bump,
        constraint = bonding_curve.is_graduated @ LaunchpadError::NotGraduated
    )]
    pub bonding_curve: Account<'info, BondingCurve>,
    
    /// SOL vault PDA - holds all SOL from trades
    /// CHECK: PDA verified through seeds constraint. No data stored, just holds SOL.
    #[account(
        mut,
        seeds = [
            b"sol_vault",
            bonding_curve.key().as_ref()
        ],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,
    
    /// Token account owned by bonding curve - holds remaining tokens
    #[account(
        mut,
        associated_token::mint = token_launch.mint,
        associated_token::authority = bonding_curve
    )]
    pub curve_token_account: Account<'info, TokenAccount>,
    
    /// Recipient for SOL (e.g., DEX pool or treasury)
    /// CHECK: Can be any account, verified by creator authority
    #[account(mut)]
    pub sol_recipient: UncheckedAccount<'info>,
    
    /// Recipient for tokens (e.g., DEX pool or treasury)
    #[account(mut)]
    pub token_recipient: Account<'info, TokenAccount>,
    
    /// Authority (creator) who can withdraw
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> WithdrawLiquidity<'info> {
    pub fn execute(&mut self, bumps: &WithdrawLiquidityBumps) -> Result<()> {
        // Ensure curve is graduated
        require!(
            self.bonding_curve.is_graduated,
            LaunchpadError::NotGraduated
        );
        
        // Get balances to transfer
        let sol_balance = self.sol_vault.lamports();
        let token_balance = self.curve_token_account.amount;
        
        msg!("Withdrawing liquidity - SOL: {} lamports, Tokens: {}", sol_balance, token_balance);
        
        // Transfer all SOL from vault to recipient using PDA signer
        if sol_balance > 0 {
            let bonding_curve_key = self.bonding_curve.key();
            let vault_seeds = &[
                b"sol_vault",
                bonding_curve_key.as_ref(),
                &[bumps.sol_vault],
            ];
            let vault_signer_seeds = &[&vault_seeds[..]];
            
            let transfer_sol = Transfer {
                from: self.sol_vault.to_account_info(),
                to: self.sol_recipient.to_account_info(),
            };
            
            transfer(
                CpiContext::new_with_signer(
                    self.system_program.to_account_info(),
                    transfer_sol,
                    vault_signer_seeds,
                ),
                sol_balance,
            )?;
            
            msg!("✅ Transferred {} lamports to SOL recipient", sol_balance);
        }
        
        // Transfer all tokens from curve to recipient using PDA signer
        if token_balance > 0 {
            let token_launch_key = self.token_launch.key();
            let bonding_seeds = &[
                b"bonding_curve",
                token_launch_key.as_ref(),
                &[self.bonding_curve.bump],
            ];
            let bonding_signer_seeds = &[&bonding_seeds[..]];
            
            let transfer_tokens = TokenTransfer {
                from: self.curve_token_account.to_account_info(),
                to: self.token_recipient.to_account_info(),
                authority: self.bonding_curve.to_account_info(),
            };
            
            token::transfer(
                CpiContext::new_with_signer(
                    self.token_program.to_account_info(),
                    transfer_tokens,
                    bonding_signer_seeds,
                ),
                token_balance,
            )?;
            
            msg!("✅ Transferred {} tokens to token recipient", token_balance);
        }
        
        msg!("🎉 Liquidity withdrawal complete!");
        
        Ok(())
    }
}
