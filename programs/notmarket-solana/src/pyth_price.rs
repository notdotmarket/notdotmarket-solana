use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
use anchor_lang::prelude::*;
use crate::errors::LaunchpadError;

/// Pyth price feed integration for SOL/USD price
pub struct PythPriceReader;

impl PythPriceReader {
    /// Read SOL/USD price from Pyth price feed
    /// Returns price scaled by 1e8 (8 decimals) to match our USD_SCALE
    /// 
    /// # Arguments
    /// * `price_update` - Pyth PriceUpdateV2 account containing SOL/USD price data
    /// 
    /// # Returns
    /// * `Result<u64>` - SOL price in USD scaled by 1e8
    /// 
    /// # Example
    /// If SOL = $100.50, returns 10_050_000_000 (100.50 * 1e8)
    pub fn get_sol_price_usd(price_update: &Account<PriceUpdateV2>) -> Result<u64> {
        let price_message = &price_update.price_message;
        
        // Log price feed information for debugging
        msg!("Pyth Price Feed ID: {:?}", price_message.feed_id);
        msg!("Price: {:?}", price_message.price);
        msg!("Confidence: {:?}", price_message.conf);
        msg!("Exponent: {:?}", price_message.exponent);
        msg!("Publish Time: {:?}", price_message.publish_time);
        
        // Validate price data
        require!(
            price_message.price > 0,
            LaunchpadError::InvalidPrice
        );
        
        // Get the price and exponent
        let price = price_message.price;
        let exponent = price_message.exponent;
        
        // Pyth prices are represented as price * 10^exponent
        // We need to scale it to our USD_SCALE (1e8)
        // 
        // Example: If Pyth returns price=10050 with exponent=-2
        // Actual price = 10050 * 10^-2 = 100.50
        // We need: 100.50 * 1e8 = 10_050_000_000
        
        let sol_price_usd = if exponent >= 0 {
            // Positive exponent: multiply
            let multiplier = 10_u64.pow(exponent as u32);
            price
                .checked_mul(multiplier as i64)
                .ok_or(LaunchpadError::MathOverflow)?
                .checked_mul(100_000_000)
                .ok_or(LaunchpadError::MathOverflow)?
        } else {
            // Negative exponent: we need to adjust the scaling
            // Target scale: 1e8
            // Current scale: 10^exponent
            // Adjustment: 1e8 / 10^exponent = 10^(8 - |exponent|)
            
            let abs_exponent = exponent.abs() as u32;
            
            if abs_exponent <= 8 {
                // Scale up to reach 1e8
                let scale_factor = 10_u64.pow(8 - abs_exponent);
                price
                    .checked_mul(scale_factor as i64)
                    .ok_or(LaunchpadError::MathOverflow)?
            } else {
                // Scale down from higher precision
                let scale_divisor = 10_u64.pow(abs_exponent - 8);
                price
                    .checked_div(scale_divisor as i64)
                    .ok_or(LaunchpadError::MathOverflow)?
            }
        };
        
        // Convert to u64 and validate
        let sol_price_usd = u64::try_from(sol_price_usd)
            .map_err(|_| LaunchpadError::InvalidPrice)?;
        
        require!(
            sol_price_usd > 0,
            LaunchpadError::InvalidPrice
        );
        
        msg!("Calculated SOL/USD price (scaled 1e8): {}", sol_price_usd);
        
        Ok(sol_price_usd)
    }
    
    /// Validate that the price update is recent (within acceptable staleness threshold)
    /// 
    /// # Arguments
    /// * `price_update` - Pyth PriceUpdateV2 account
    /// * `max_staleness_seconds` - Maximum age of price data in seconds (default: 60)
    pub fn validate_price_freshness(
        price_update: &Account<PriceUpdateV2>,
        max_staleness_seconds: i64,
    ) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        let publish_time = price_update.price_message.publish_time;
        
        let age = current_time
            .checked_sub(publish_time)
            .ok_or(LaunchpadError::InvalidPrice)?;
        
        require!(
            age >= 0 && age <= max_staleness_seconds,
            LaunchpadError::StalePrice
        );
        
        msg!("Price age: {} seconds (max: {})", age, max_staleness_seconds);
        
        Ok(())
    }
}
