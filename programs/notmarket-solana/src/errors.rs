use anchor_lang::prelude::*;

#[error_code]
pub enum LaunchpadError {
    #[msg("Invalid amount provided")]
    InvalidAmount,
    
    #[msg("Invalid price provided")]
    InvalidPrice,
    
    #[msg("Invalid fee percentage")]
    InvalidFee,
    
    #[msg("Name is too long")]
    NameTooLong,
    
    #[msg("Symbol is too long")]
    SymbolTooLong,
    
    #[msg("URI is too long")]
    UriTooLong,
    
    #[msg("Description is too long")]
    DescriptionTooLong,
    
    #[msg("Math overflow occurred")]
    MathOverflow,
    
    #[msg("Insufficient supply available")]
    InsufficientSupply,
    
    #[msg("Insufficient liquidity in bonding curve")]
    InsufficientLiquidity,
    
    #[msg("Insufficient token balance")]
    InsufficientBalance,
    
    #[msg("Trading is currently inactive")]
    TradingInactive,
    
    #[msg("Bonding curve has graduated to DEX")]
    CurveGraduated,
    
    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,
    
    #[msg("Unauthorized access")]
    Unauthorized,
    
    #[msg("Invalid fee recipient")]
    InvalidFeeRecipient,
    
    #[msg("Token launch not found")]
    TokenLaunchNotFound,
    
    #[msg("Bonding curve not found")]
    BondingCurveNotFound,
    
    #[msg("User position not found")]
    UserPositionNotFound,
    
    #[msg("Invalid bonding curve parameters")]
    InvalidCurveParameters,
    
    #[msg("Graduation threshold not reached")]
    GraduationThresholdNotReached,
    
    #[msg("Already graduated")]
    AlreadyGraduated,
    
    #[msg("Bonding curve has not graduated yet")]
    NotGraduated,
    
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
    
    #[msg("Token mint mismatch")]
    TokenMintMismatch,
    
    #[msg("Invalid authority")]
    InvalidAuthority,
    
    #[msg("Account already initialized")]
    AlreadyInitialized,
    
    #[msg("Account not initialized")]
    NotInitialized,
    
    #[msg("Numerical calculation error")]
    NumericalError,
    
    #[msg("Reserve calculation error")]
    ReserveCalculationError,
    
    #[msg("Price impact too high")]
    PriceImpactTooHigh,
    
    #[msg("Minimum trade amount not met")]
    MinimumTradeAmount,
    
    #[msg("Maximum trade amount exceeded")]
    MaximumTradeAmount,
    
    #[msg("Cooldown period active")]
    CooldownActive,
    
    #[msg("Invalid configuration")]
    InvalidConfiguration,
    
    #[msg("Price data is stale")]
    StalePrice,
}
