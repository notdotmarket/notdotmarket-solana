use anchor_lang::prelude::*;
use magic_curves::ExponentialBondingCurve;
use crate::errors::LaunchpadError;
use crate::state::{CURVE_SUPPLY, START_PRICE_USD, END_PRICE_USD, USD_SCALE};

/// Bonding curve implementation for exponential price discovery
/// Formula: price(x) = START_PRICE * e^(k*x)
/// where k is calculated such that price(CURVE_SUPPLY) = END_PRICE
/// 
/// Fixed parameters:
/// - Total supply on curve: 800M tokens
/// - Price range: $0.00000420 → $0.00006900
/// - Exponential growth throughout the range
pub struct BondingCurveCalculator;

impl BondingCurveCalculator {
    /// Create exponential bonding curve using magic-curves
    /// 
    /// Formula: P(x) = base * e^(growth * x)
    /// where x is the token count (without decimals)
    /// 
    /// From Solidity reference: P(x) = Pmin * r^(x/N)
    /// Converting to exponential: P(x) = Pmin * e^(ln(r) * x/N)
    /// So: base = Pmin, growth = ln(r) / N
    fn create_curve() -> ExponentialBondingCurve {
        let base = START_PRICE_USD as f64 / USD_SCALE as f64;
        
        // Calculate growth rate: ln(Pmax/Pmin) / N
        let r = END_PRICE_USD as f64 / START_PRICE_USD as f64;
        let n = (CURVE_SUPPLY / 1_000_000_000) as f64;
        let growth = r.ln() / n;
        
        ExponentialBondingCurve::new(base, growth)
    }
    
    /// Convert token amount with decimals to actual token count
    fn to_token_count(amount_with_decimals: u64) -> u64 {
        amount_with_decimals / 1_000_000_000
    }
    
    /// Calculate price for buying tokens using exponential bonding curve
    /// 
    /// From Solidity reference:
    /// Cost to buy q tokens from state s:
    /// C(s,q) = Pmin * N / ln(r) * ( r^((s+q)/N) - r^(s/N) )
    /// 
    /// Converting to exponential form with k = ln(r)/N:
    /// C(s,q) = (Pmin/k) * [e^(k*(s+q)) - e^(k*s)]
    /// 
    /// # Arguments
    /// * `tokens_sold` - Number of tokens already sold on curve (with 9 decimals)
    /// * `amount` - Number of tokens to buy (with 9 decimals)
    /// * `sol_price_usd` - Current SOL price in USD (scaled by 1e8)
    /// 
    /// # Returns
    /// * `Result<u64>` - Cost in lamports
    pub fn calculate_buy_price(
        tokens_sold: u64,
        amount: u64,
        sol_price_usd: u64,
    ) -> Result<u64> {
        require!(amount > 0, LaunchpadError::InvalidAmount);
        require!(
            tokens_sold.checked_add(amount).ok_or(LaunchpadError::MathOverflow)? <= CURVE_SUPPLY,
            LaunchpadError::InsufficientSupply
        );
        
        let curve = Self::create_curve();
        
        // Convert to actual token counts (without decimals)
        let s = Self::to_token_count(tokens_sold);
        let q = Self::to_token_count(amount);
        
        // Get prices at both points using magic-curves
        let price_at_s = curve.calculate_price_lossy(s);
        let price_at_s_plus_q = curve.calculate_price_lossy(s + q);
        
        // Calculate cost using integral formula
        // The curve uses P(x) = base * e^(growth * x)
        // Integral from s to s+q: (base/growth) * [e^(growth*(s+q)) - e^(growth*s)]
        // But we can derive this from the prices:
        // price_at_s = base * e^(growth*s)
        // price_at_s_plus_q = base * e^(growth*(s+q))
        // cost = (base/growth) * [price_at_s_plus_q/base - price_at_s/base]
        //      = (1/growth) * [price_at_s_plus_q - price_at_s]
        
        let base_price = START_PRICE_USD as f64 / USD_SCALE as f64;
        let r = END_PRICE_USD as f64 / START_PRICE_USD as f64;
        let n = (CURVE_SUPPLY / 1_000_000_000) as f64;
        let growth = r.ln() / n;
        
        // Cost in USD = (1/growth) * [price_at_s_plus_q - price_at_s]
        let cost_usd = (1.0 / growth) * (price_at_s_plus_q - price_at_s);
        
        // Convert USD to lamports
        let sol_price_usd_f64 = sol_price_usd as f64 / 1e8;
        let cost_sol = cost_usd / sol_price_usd_f64;
        let lamports = (cost_sol * 1e9) as u64;
        
        // Ensure minimum price to avoid 0
        let lamports = if lamports == 0 { 1 } else { lamports };
        
        Ok(lamports)
    }
    
    /// Calculate proceeds from selling tokens back to the bonding curve
    /// 
    /// # Arguments
    /// * `tokens_sold` - Number of tokens currently sold on curve
    /// * `amount` - Number of tokens to sell back
    /// * `sol_price_usd` - Current SOL price in USD (scaled by 1e8)
    /// 
    /// # Returns
    /// * `Result<u64>` - Proceeds in lamports
    pub fn calculate_sell_price(
        tokens_sold: u64,
        amount: u64,
        sol_price_usd: u64,
    ) -> Result<u64> {
        require!(amount > 0, LaunchpadError::InvalidAmount);
        require!(tokens_sold >= amount, LaunchpadError::InsufficientSupply);
        
        // For selling, calculate from (tokens_sold - amount) to tokens_sold
        let new_tokens_sold = tokens_sold
            .checked_sub(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        Self::calculate_buy_price(new_tokens_sold, amount, sol_price_usd)
    }
    
    /// Calculate the current spot price at a given supply level
    /// Formula: price(tokens_sold) = START_PRICE * e^(k * tokens_sold)
    /// 
    /// # Arguments
    /// * `tokens_sold` - Number of tokens already sold (with 9 decimals)
    /// * `sol_price_usd` - Current SOL price in USD (scaled by 1e8)
    /// 
    /// # Returns
    /// * `Result<u64>` - Current spot price in lamports per token
    
    pub fn get_spot_price(
        tokens_sold: u64,
        sol_price_usd: u64,
    ) -> Result<u64> {
        let curve = Self::create_curve();
        
        // Convert to actual token count
        let tokens_sold_count = Self::to_token_count(tokens_sold);
        
        // Get price at current supply
        let price_usd = curve.calculate_price_lossy(tokens_sold_count);
        
        // Convert USD to lamports per token
        let sol_price_usd_f64 = sol_price_usd as f64 / 1e8;
        let price_sol = price_usd / sol_price_usd_f64;
        let lamports = (price_sol * 1e9) as u64;
        
        // Ensure minimum price to avoid 0
        let lamports = if lamports == 0 { 1 } else { lamports };
        
        Ok(lamports)
    }
    
    /// Calculate slippage for a given trade
    /// 
    /// # Arguments
    /// * `tokens_sold` - Tokens already sold
    /// * `amount` - Trade amount
    /// * `sol_price_usd` - SOL price in USD
    /// 
    /// # Returns
    /// * `Result<u16>` - Slippage in basis points
    pub fn calculate_slippage(
        tokens_sold: u64,
        amount: u64,
        sol_price_usd: u64,
    ) -> Result<u16> {
        let spot_price = Self::get_spot_price(tokens_sold, sol_price_usd)?;
        let total_cost = Self::calculate_buy_price(tokens_sold, amount, sol_price_usd)?;
        let average_price = total_cost
            .checked_div(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        if spot_price == 0 {
            return Ok(0);
        }
        
        let slippage = average_price
            .checked_sub(spot_price)
            .unwrap_or(0)
            .checked_mul(10000)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(spot_price)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        Ok(slippage as u16)
    }
    
    /// Calculate the total USD value raised so far
    /// 
    /// # Arguments
    /// * `sol_reserve` - SOL in the bonding curve reserves
    /// * `sol_price_usd` - SOL price in USD (scaled by 1e8)
    /// 
    /// # Returns
    /// * `Result<u64>` - USD value (scaled by USD_SCALE)
    pub fn calculate_usd_raised(
        sol_reserve: u64,
        sol_price_usd: u64,
    ) -> Result<u64> {
        let usd_raised = (sol_reserve as u128)
            .checked_mul(sol_price_usd as u128)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(1_000_000_000) // Divide by SOL decimals
            .ok_or(LaunchpadError::MathOverflow)? as u64;
        
        Ok(usd_raised)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    const SOL_PRICE_USD: u64 = 15_000_000_000; // $150 USD (scaled by 1e8)
    const ONE_TOKEN: u64 = 1_000_000_000; // 1 token with 9 decimals
    const ONE_MILLION_TOKENS: u64 = 1_000_000_000_000_000; // 1M tokens with decimals
    
    #[test]
    fn test_constants_sanity() {
        println!("\n=== TOKENOMICS CONSTANTS ===");
        println!("CURVE_SUPPLY (with decimals): {}", CURVE_SUPPLY);
        println!("CURVE_SUPPLY (actual tokens): {}", CURVE_SUPPLY / 1_000_000_000);
        println!("START_PRICE_USD (scaled): ${}", START_PRICE_USD as f64 / USD_SCALE as f64);
        println!("END_PRICE_USD (scaled): ${}", END_PRICE_USD as f64 / USD_SCALE as f64);
        println!("Price ratio: {}", END_PRICE_USD as f64 / START_PRICE_USD as f64);
        
        // Calculate what k SHOULD be
        let price_ratio = END_PRICE_USD as f64 / START_PRICE_USD as f64;
        let curve_supply_tokens = (CURVE_SUPPLY / 1_000_000_000) as f64;
        let k_correct = price_ratio.ln() / curve_supply_tokens;
        println!("k should be: {:.15e}", k_correct);
        println!("k in code is: {:.15e}", 0.0000000034975);
        println!("Ratio: {:.2}x", k_correct / 0.0000000034975);
    }
    
    #[test]
    fn test_first_token_price() {
        println!("\n=== FIRST TOKEN PURCHASE ===");
        let tokens_sold = 0;
        let amount = ONE_TOKEN; // Buy exactly 1 token
        
        let result = BondingCurveCalculator::calculate_buy_price(
            tokens_sold,
            amount,
            SOL_PRICE_USD,
        );
        
        assert!(result.is_ok(), "Failed to calculate price for first token");
        let lamports = result.unwrap();
        
        println!("Cost for 1 token: {} lamports", lamports);
        println!("Cost in SOL: {:.9} SOL", lamports as f64 / 1e9);
        println!("Cost in USD: ${:.10}", (lamports as f64 / 1e9) * 150.0);
        
        // Expected: ~$0.00000420 / $150 * 1e9 = ~28,000 lamports
        let expected_usd = 0.00000420;
        let expected_lamports = (expected_usd / 150.0 * 1e9) as u64;
        println!("Expected: {} lamports (${:.10})", expected_lamports, expected_usd);
        
        // Allow 10% tolerance due to rounding
        let tolerance = (expected_lamports as f64 * 0.1) as u64;
        assert!(
            lamports >= expected_lamports.saturating_sub(tolerance) && 
            lamports <= expected_lamports + tolerance,
            "Price mismatch: got {} lamports, expected ~{} lamports",
            lamports,
            expected_lamports
        );
    }
    
    #[test]
    fn test_spot_price_at_start() {
        println!("\n=== SPOT PRICE AT START ===");
        let tokens_sold = 0;
        
        let result = BondingCurveCalculator::get_spot_price(
            tokens_sold,
            SOL_PRICE_USD,
        );
        
        assert!(result.is_ok(), "Failed to calculate spot price");
        let lamports = result.unwrap();
        
        println!("Spot price at start: {} lamports per token", lamports);
        println!("In USD: ${:.10}", (lamports as f64 / 1e9) * 150.0);
        
        // Should be ~$0.00000420
        let expected_usd = 0.00000420;
        let expected_lamports = (expected_usd / 150.0 * 1e9) as u64;
        
        let tolerance = (expected_lamports as f64 * 0.1) as u64;
        assert!(
            lamports >= expected_lamports.saturating_sub(tolerance) && 
            lamports <= expected_lamports + tolerance,
            "Spot price mismatch: got {} lamports, expected ~{} lamports",
            lamports,
            expected_lamports
        );
    }
    
    #[test]
    fn test_spot_price_at_end() {
        println!("\n=== SPOT PRICE AT END ===");
        let tokens_sold = CURVE_SUPPLY; // All 800M tokens sold
        
        let result = BondingCurveCalculator::get_spot_price(
            tokens_sold,
            SOL_PRICE_USD,
        );
        
        assert!(result.is_ok(), "Failed to calculate end spot price");
        let lamports = result.unwrap();
        
        println!("Spot price at end: {} lamports per token", lamports);
        println!("In USD: ${:.10}", (lamports as f64 / 1e9) * 150.0);
        
        // Should be ~$0.00006900
        let expected_usd = 0.00006900;
        let expected_lamports = (expected_usd / 150.0 * 1e9) as u64;
        println!("Expected: {} lamports (${:.10})", expected_lamports, expected_usd);
        
        let tolerance = (expected_lamports as f64 * 0.1) as u64;
        assert!(
            lamports >= expected_lamports.saturating_sub(tolerance) && 
            lamports <= expected_lamports + tolerance,
            "End spot price mismatch: got {} lamports, expected ~{} lamports",
            lamports,
            expected_lamports
        );
    }
    
    #[test]
    fn test_buy_1_million_tokens() {
        println!("\n=== BUY 1 MILLION TOKENS ===");
        let tokens_sold = 0;
        let amount = ONE_MILLION_TOKENS; // 1M tokens
        
        let result = BondingCurveCalculator::calculate_buy_price(
            tokens_sold,
            amount,
            SOL_PRICE_USD,
        );
        
        assert!(result.is_ok(), "Failed to calculate price for 1M tokens");
        let lamports = result.unwrap();
        
        println!("Cost for 1M tokens: {} lamports", lamports);
        println!("Cost in SOL: {:.6} SOL", lamports as f64 / 1e9);
        println!("Cost in USD: ${:.2}", (lamports as f64 / 1e9) * 150.0);
        println!("Average price per token: ${:.10}", ((lamports as f64 / 1e9) * 150.0) / 1_000_000.0);
        
        // Sanity check: should be affordable (less than 100 SOL for 1M tokens at start)
        assert!(lamports < 100_000_000_000, "Price too high: {} lamports (>{} SOL)", lamports, lamports / 1_000_000_000);
    }
    
    #[test]
    fn test_progressive_purchases() {
        println!("\n=== PROGRESSIVE PURCHASES ===");
        let mut tokens_sold = 0u64;
        let purchase_amounts = [
            (ONE_MILLION_TOKENS, "1M"),
            (10 * ONE_MILLION_TOKENS, "10M"),
            (50 * ONE_MILLION_TOKENS, "50M"),
            (100 * ONE_MILLION_TOKENS, "100M"),
        ];
        
        for (amount, label) in purchase_amounts.iter() {
            let result = BondingCurveCalculator::calculate_buy_price(
                tokens_sold,
                *amount,
                SOL_PRICE_USD,
            );
            
            assert!(result.is_ok(), "Failed at {} tokens", label);
            let lamports = result.unwrap();
            let sol = lamports as f64 / 1e9;
            let usd = sol * 150.0;
            
            println!("Buy {} tokens at {} sold:", label, tokens_sold / ONE_TOKEN);
            println!("  Cost: {:.6} SOL (${:.2})", sol, usd);
            println!("  Avg price: ${:.10}", usd / (*amount as f64 / ONE_TOKEN as f64));
            
            tokens_sold += amount;
        }
    }
    
    #[test]
    fn test_buy_entire_curve() {
        println!("\n=== BUY ENTIRE CURVE ===");
        let tokens_sold = 0;
        let amount = CURVE_SUPPLY; // All 800M tokens
        
        let result = BondingCurveCalculator::calculate_buy_price(
            tokens_sold,
            amount,
            SOL_PRICE_USD,
        );
        
        assert!(result.is_ok(), "Failed to calculate price for entire curve");
        let lamports = result.unwrap();
        let sol_cost = lamports as f64 / 1e9;
        
        println!("Cost for all 800M tokens: {} lamports", lamports);
        println!("Cost in SOL: {:.2} SOL", sol_cost);
        println!("Cost in USD @ $150/SOL: ${:.2}", sol_cost * 150.0);
        
        // The bonding curve parameters determine a fixed SOL cost
        // At different SOL prices, the USD graduation amount will vary
        // With START=$0.0000042, END=$0.000069, the cost is ~123.5 SOL
        // This equals $12k at SOL=$97.19, or $18.5k at SOL=$150
        
        println!("\nGraduation analysis:");
        println!("  At SOL=$97:  {:.2} SOL = ${:.0}", sol_cost, sol_cost * 97.0);
        println!("  At SOL=$150: {:.2} SOL = ${:.0}", sol_cost, sol_cost * 150.0);
        println!("  At SOL=$200: {:.2} SOL = ${:.0}", sol_cost, sol_cost * 200.0);
        
        // Verify the curve requires a reasonable amount of SOL
        assert!(
            sol_cost >= 80.0 && sol_cost <= 150.0,
            "Should require 80-150 SOL to complete curve, got {:.2}",
            sol_cost
        );
    }
    
    #[test]
    fn test_sell_tokens() {
        println!("\n=== SELL TOKENS ===");
        // First buy some tokens
        let initial_buy = 10 * ONE_MILLION_TOKENS; // Buy 10M tokens
        let buy_price = BondingCurveCalculator::calculate_buy_price(
            0,
            initial_buy,
            SOL_PRICE_USD,
        ).unwrap();
        
        println!("Bought 10M tokens for: {} lamports ({:.6} SOL)", 
            buy_price, buy_price as f64 / 1e9);
        
        // Now sell half
        let sell_amount = 5 * ONE_MILLION_TOKENS;
        let sell_price = BondingCurveCalculator::calculate_sell_price(
            initial_buy,
            sell_amount,
            SOL_PRICE_USD,
        ).unwrap();
        
        println!("Sell 5M tokens for: {} lamports ({:.6} SOL)", 
            sell_price, sell_price as f64 / 1e9);
        
        // Sell price should be less than buy price (due to curve shape)
        assert!(sell_price < buy_price, "Sell price should be less than buy price");
    }
    
    #[test]
    fn test_slippage_calculation() {
        println!("\n=== SLIPPAGE TESTS ===");
        let tokens_sold = 100 * ONE_MILLION_TOKENS; // 100M tokens already sold
        
        let test_amounts = [
            (ONE_MILLION_TOKENS, "1M"),
            (10 * ONE_MILLION_TOKENS, "10M"),
            (50 * ONE_MILLION_TOKENS, "50M"),
        ];
        
        for (amount, label) in test_amounts.iter() {
            let slippage = BondingCurveCalculator::calculate_slippage(
                tokens_sold,
                *amount,
                SOL_PRICE_USD,
            ).unwrap();
            
            println!("Slippage for {} tokens: {} bps ({:.2}%)", 
                label, slippage, slippage as f64 / 100.0);
            
            // Slippage should be reasonable (< 10%)
            assert!(slippage < 1000, "Slippage too high: {} bps", slippage);
        }
    }
    
    #[test]
    fn test_graduation_threshold() {
        println!("\n=== GRADUATION THRESHOLD ===");
        // Test that 800M tokens sold reaches $12k
        let sol_reserve = 80_000_000_000; // 80 SOL
        let graduation_usd = 12_000u64; // $12k threshold
        
        let usd_raised = BondingCurveCalculator::calculate_usd_raised(
            sol_reserve,
            SOL_PRICE_USD,
        ).unwrap();
        
        let usd_actual = usd_raised as f64 / USD_SCALE as f64;
        println!("USD raised with 80 SOL: ${:.2}", usd_actual);
        println!("Graduation threshold: ${}", graduation_usd);
        
        assert!(
            usd_raised >= graduation_usd * USD_SCALE,
            "Should meet graduation threshold"
        );
    }
    
    #[test]
    fn test_price_consistency() {
        println!("\n=== PRICE CONSISTENCY CHECK ===");
        // Buy then sell should be roughly equivalent
        let tokens_sold = 0;
        let amount = 10 * ONE_MILLION_TOKENS;
        
        // Buy 10M tokens from 0
        let buy_price = BondingCurveCalculator::calculate_buy_price(
            tokens_sold,
            amount,
            SOL_PRICE_USD,
        ).unwrap();
        
        // Sell 10M tokens back (from 10M sold to 0)
        let sell_price = BondingCurveCalculator::calculate_sell_price(
            amount,
            amount,
            SOL_PRICE_USD,
        ).unwrap();
        
        println!("Buy 10M: {} lamports", buy_price);
        println!("Sell 10M: {} lamports", sell_price);
        println!("Difference: {} lamports ({:.2}%)", 
            buy_price.abs_diff(sell_price),
            (buy_price.abs_diff(sell_price) as f64 / buy_price as f64) * 100.0
        );
        
        // They should be equal (or very close)
        let diff_pct = (buy_price.abs_diff(sell_price) as f64 / buy_price as f64) * 100.0;
        assert!(diff_pct < 1.0, "Buy and sell prices should be nearly equal, diff: {:.2}%", diff_pct);
    }
    
    #[test]
    fn test_realistic_user_purchase() {
        println!("\n=== REALISTIC USER PURCHASE ===");
        // User wants to buy $10 worth of tokens
        let usd_to_spend = 10.0;
        let sol_to_spend = usd_to_spend / 150.0;
        let lamports_to_spend = (sol_to_spend * 1e9) as u64;
        
        println!("User wants to spend: ${} ({:.6} SOL = {} lamports)", 
            usd_to_spend, sol_to_spend, lamports_to_spend);
        
        // Try buying different amounts to find how many tokens they can get
        let test_amounts = [
            1_000_000 * ONE_TOKEN,   // 1M tokens
            5_000_000 * ONE_TOKEN,   // 5M tokens
            10_000_000 * ONE_TOKEN,  // 10M tokens
            50_000_000 * ONE_TOKEN,  // 50M tokens
        ];
        
        for amount in test_amounts.iter() {
            let cost = BondingCurveCalculator::calculate_buy_price(
                0,
                *amount,
                SOL_PRICE_USD,
            ).unwrap();
            
            let tokens_display = amount / ONE_TOKEN;
            println!("{} tokens costs: {} lamports ({:.6} SOL = ${:.2})", 
                tokens_display,
                cost,
                cost as f64 / 1e9,
                (cost as f64 / 1e9) * 150.0
            );
            
            if cost <= lamports_to_spend {
                println!("  ✓ User CAN afford this");
            } else {
                println!("  ✗ User CANNOT afford this");
            }
        }
    }
}
