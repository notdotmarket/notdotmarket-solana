use anchor_lang::prelude::*;
use magic_curves::ExponentialBondingCurve;
use crate::errors::LaunchpadError;
use crate::state::{CURVE_SUPPLY, START_PRICE_USD, USD_SCALE, GRADUATION_USD};

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
    /// Create the exponential bonding curve with our parameters
    /// 
    /// We use magic-curves for efficient, precise calculations
    /// Formula: price = base_price * e^(growth_rate * supply)
    fn create_curve() -> ExponentialBondingCurve {
        // Calculate growth rate k such that:
        // END_PRICE = START_PRICE * e^(k * CURVE_SUPPLY_TOKENS)
        // k = ln(END_PRICE / START_PRICE) / CURVE_SUPPLY_TOKENS
        
        // CURVE_SUPPLY is 800M tokens with 9 decimals = 800_000_000_000_000_000
        // We want the curve in terms of actual tokens, so divide by 1e9
        // CURVE_SUPPLY_TOKENS = 800_000_000
        
        // END_PRICE / START_PRICE = 6900 / 420 ≈ 16.428571
        // ln(16.428571) ≈ 2.798
        // k = 2.798 / 800_000_000 ≈ 3.4975e-9
        
        // For magic-curves, we pass growth_rate (k) and base_price
        // Growth rate: 3.4975e-9
        let growth_rate = 0.0000000034975;
        let base_price = START_PRICE_USD as f64 / USD_SCALE as f64;
        
        ExponentialBondingCurve::new(base_price, growth_rate)
    }
    
    /// Convert token amount with decimals to actual token count
    fn to_token_count(amount_with_decimals: u64) -> u64 {
        amount_with_decimals / 1_000_000_000
    }
    
    /// Convert actual token count to amount with decimals
    fn to_amount_with_decimals(token_count: u64) -> Result<u64> {
        token_count
            .checked_mul(1_000_000_000)
            .ok_or(LaunchpadError::MathOverflow.into())
    }
    
    /// Calculate price for buying tokens using exponential bonding curve
    /// Uses magic-curves for efficient and precise calculation
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
        let tokens_sold_count = Self::to_token_count(tokens_sold);
        let amount_count = Self::to_token_count(amount);
        
        // Get price at both points
        let price_start = curve.calculate_price_lossy(tokens_sold_count);
        let price_end = curve.calculate_price_lossy(tokens_sold_count + amount_count);
        
        // Use average price * amount for the cost
        let average_price = (price_start + price_end) / 2.0;
        let cost_usd = average_price * (amount_count as f64);
        
        // Convert USD to lamports
        // lamports = (cost_usd) / (sol_price_usd / 1e8) * 1e9
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
    
    #[test]
    fn test_buy_price_calculation() {
        let tokens_sold = 0; // Start of curve
        let amount = 1_000_000_000_000_000; // 1M tokens
        let sol_price_usd = 15_000_000_000; // $150 USD (scaled by 1e8)
        
        let price = BondingCurveCalculator::calculate_buy_price(
            tokens_sold,
            amount,
            sol_price_usd,
        );
        
        assert!(price.is_ok());
        println!("Cost for first 1M tokens: {} lamports", price.unwrap());
    }
    
    #[test]
    fn test_spot_price() {
        let tokens_sold = 0; // Start
        let sol_price_usd = 15_000_000_000; // $150 USD
        
        let spot = BondingCurveCalculator::get_spot_price(
            tokens_sold,
            sol_price_usd,
        );
        
        assert!(spot.is_ok());
        println!("Starting spot price: {} lamports per token", spot.unwrap());
    }
    
    #[test]
    fn test_end_price() {
        let tokens_sold = CURVE_SUPPLY - 1; // Near end
        let sol_price_usd = 15_000_000_000; // $150 USD
        
        let spot = BondingCurveCalculator::get_spot_price(
            tokens_sold,
            sol_price_usd,
        );
        
        assert!(spot.is_ok());
        println!("Ending spot price: {} lamports per token", spot.unwrap());
    }
    
    #[test]
    fn test_graduation_check() {
        // Test that 800M tokens sold with $12k should graduate
        let _tokens_sold = CURVE_SUPPLY;
        let sol_reserve = 80_000_000_000; // 80 SOL
        let sol_price_usd = 15_000_000_000; // $150 = $12k total
        
        let usd_raised = BondingCurveCalculator::calculate_usd_raised(
            sol_reserve,
            sol_price_usd,
        );
        
        assert!(usd_raised.is_ok());
        let usd = usd_raised.unwrap();
        println!("USD raised: {} (scaled)", usd);
        assert!(usd >= (GRADUATION_USD as u64) * USD_SCALE);
    }
}
