use anchor_lang::prelude::*;
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
    /// Calculate the exponential growth constant k
    /// k = ln(END_PRICE / START_PRICE) / CURVE_SUPPLY
    /// This ensures price(0) = START_PRICE and price(CURVE_SUPPLY) = END_PRICE
    fn calculate_k() -> Result<u128> {
        const SCALE: u128 = 1_000_000_000_000; // 1e12 for precision
        
        // Calculate ln(END_PRICE / START_PRICE)
        // ln(6900/420) = ln(16.428571) ≈ 2.798
        // Precalculated and scaled: 2.798 * 1e12 = 2_798_000_000_000
        let ln_ratio: u128 = 2_798_000_000_000; // ln(END_PRICE/START_PRICE) * SCALE
        
        // k = ln_ratio / CURVE_SUPPLY
        // We need to maintain precision, so: k_scaled = ln_ratio / (CURVE_SUPPLY / SCALE)
        let k = ln_ratio
            .checked_mul(SCALE)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(CURVE_SUPPLY as u128)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        Ok(k)
    }
    
    /// Calculate price for buying tokens using exponential bonding curve
    /// Formula: price(tokens_sold) = START_PRICE * e^(k * tokens_sold)
    /// Cost = integral from tokens_sold to (tokens_sold + amount)
    /// 
    /// # Arguments
    /// * `tokens_sold` - Number of tokens already sold on curve
    /// * `amount` - Number of tokens to buy
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
        
        const SCALE: u128 = 1_000_000_000_000; // 1e12 for precision
        
        let k = Self::calculate_k()?;
        
        // Calculate e^(k * tokens_sold)
        let exp_start = Self::exp_taylor_precise(k, tokens_sold as u128, SCALE)?;
        
        // Calculate e^(k * (tokens_sold + amount))
        let tokens_end = tokens_sold
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        let exp_end = Self::exp_taylor_precise(k, tokens_end as u128, SCALE)?;
        
        // Integral = (START_PRICE / k) * [e^(k*end) - e^(k*start)]
        let exp_diff = exp_end
            .checked_sub(exp_start)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Cost in USD (scaled) = (START_PRICE_USD / k) * exp_diff
        let numerator = (START_PRICE_USD as u128)
            .checked_mul(exp_diff)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_mul(SCALE)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        let cost_usd_scaled = numerator
            .checked_div(k)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Convert USD to SOL lamports
        // lamports = (cost_usd_scaled / USD_SCALE) / sol_price_usd * 1e9
        let lamports = cost_usd_scaled
            .checked_mul(1_000_000_000) // SOL decimals
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div((sol_price_usd as u128).checked_mul(USD_SCALE as u128).ok_or(LaunchpadError::MathOverflow)?)
            .ok_or(LaunchpadError::MathOverflow)? as u64;
        
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
    
    /// Approximate e^(k*supply) using Taylor series expansion with high precision
    /// e^x ≈ 1 + x + x²/2! + x³/3! + x⁴/4! + ...
    /// 
    /// # Arguments
    /// * `k` - Scaled curve coefficient
    /// * `supply` - Current supply (tokens sold)
    /// * `scale` - Scaling factor for fixed-point arithmetic
    /// 
    /// # Returns
    /// * `Result<u128>` - e^(k*supply) scaled
    fn exp_taylor_precise(k: u128, supply: u128, scale: u128) -> Result<u128> {
        // Calculate k * supply (the exponent)
        // Since k is already scaled, and supply is in token units, we need to normalize
        let exponent = k
            .checked_mul(supply)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(scale)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Use Taylor series for e^x (using more terms for precision)
        // Start with 1 * scale (scaled version of 1)
        let mut result = scale;
        let mut term = scale;
        
        // Compute up to 20 terms for better precision
        for i in 1u128..=20 {
            // term = term * exponent / (i * scale)
            term = term
                .checked_mul(exponent)
                .ok_or(LaunchpadError::MathOverflow)?
                .checked_div(i)
                .ok_or(LaunchpadError::MathOverflow)?
                .checked_div(scale)
                .ok_or(LaunchpadError::MathOverflow)?;
            
            result = result
                .checked_add(term)
                .ok_or(LaunchpadError::MathOverflow)?;
            
            // Early exit if term becomes negligible
            if term == 0 {
                break;
            }
        }
        
        Ok(result)
    }
    
    /// Calculate the current spot price at a given supply level
    /// Formula: price(tokens_sold) = START_PRICE * e^(k * tokens_sold)
    /// 
    /// # Arguments
    /// * `tokens_sold` - Number of tokens already sold
    /// * `sol_price_usd` - Current SOL price in USD (scaled by 1e8)
    /// 
    /// # Returns
    /// * `Result<u64>` - Current spot price in lamports per token
    pub fn get_spot_price(
        tokens_sold: u64,
        sol_price_usd: u64,
    ) -> Result<u64> {
        const SCALE: u128 = 1_000_000_000_000; // 1e12 for precision
        
        let k = Self::calculate_k()?;
        
        // Calculate e^(k * tokens_sold)
        let exp_value = Self::exp_taylor_precise(k, tokens_sold as u128, SCALE)?;
        
        // Price in USD (scaled) = START_PRICE_USD * e^(k * tokens_sold)
        let price_usd_scaled = (START_PRICE_USD as u128)
            .checked_mul(exp_value)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(SCALE)
            .ok_or(LaunchpadError::MathOverflow)?;
        
        // Convert to lamports per token
        // lamports_per_token = (price_usd_scaled / USD_SCALE) / sol_price_usd * 1e9
        let lamports = price_usd_scaled
            .checked_mul(1_000_000_000)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div((sol_price_usd as u128).checked_mul(USD_SCALE as u128).ok_or(LaunchpadError::MathOverflow)?)
            .ok_or(LaunchpadError::MathOverflow)? as u64;
        
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
        let tokens_sold = CURVE_SUPPLY;
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
