# View Functions Usage Guide

The bonding curve program now has proper view functions that can be called from TypeScript without sending transactions.

## Available View Functions

### 1. `get_buy_quote` - Get price quote for buying tokens

```typescript
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";

// Get quote for buying 1 million tokens
const amount = new BN(1_000_000_000_000_000); // 1M tokens with 9 decimals

const quote = await program.methods
  .getBuyQuote(amount)
  .accounts({
    tokenLaunch: tokenLaunchPda,
    bondingCurve: bondingCurvePda,
  })
  .view();

console.log("Buy Quote:", {
  cost: quote.cost.toString(),              // Total cost in lamports
  spotPrice: quote.spotPrice.toString(),    // Current spot price per token
  slippage: quote.slippage,                 // Slippage in basis points
});
```

### 2. `get_spot_price` - Get current spot price

```typescript
const spotPriceInfo = await program.methods
  .getSpotPrice()
  .accounts({
    tokenLaunch: tokenLaunchPda,
    bondingCurve: bondingCurvePda,
  })
  .view();

console.log("Spot Price Info:", {
  spotPrice: spotPriceInfo.spotPrice.toString(),      // Price per token in lamports
  tokensSold: spotPriceInfo.tokensSold.toString(),    // Total tokens sold
  solReserve: spotPriceInfo.solReserve.toString(),    // SOL in bonding curve
});
```

## Key Differences from Regular Instructions

### ❌ OLD WAY (doesn't work for read-only operations):
```typescript
// This would try to send a transaction
const result = await program.methods
  .getBuyQuote(amount)
  .accounts({...})
  .rpc(); // ❌ Tries to send a transaction
```

### ✅ NEW WAY (proper view function):
```typescript
// This just reads data without sending a transaction
const quote = await program.methods
  .getBuyQuote(amount)
  .accounts({...})
  .view(); // ✅ No transaction, just returns data
```

## Return Types

The view functions return properly typed structs:

### BuyQuote
```typescript
{
  cost: BN,        // Total cost in lamports to buy the tokens
  spotPrice: BN,   // Current spot price per token in lamports
  slippage: number // Slippage in basis points (e.g., 100 = 1%)
}
```

### SpotPrice
```typescript
{
  spotPrice: BN,   // Current spot price per token in lamports
  tokensSold: BN,  // Total tokens sold so far
  solReserve: BN   // Current SOL reserve in the bonding curve
}
```

## Example: Display Price in USD

```typescript
const SOL_PRICE_USD = 150; // Current SOL price in USD
const LAMPORTS_PER_SOL = 1_000_000_000;
const TOKEN_DECIMALS = 1_000_000_000;

const quote = await program.methods
  .getBuyQuote(new BN(1_000_000 * TOKEN_DECIMALS)) // 1M tokens
  .accounts({
    tokenLaunch: tokenLaunchPda,
    bondingCurve: bondingCurvePda,
  })
  .view();

const costInSol = quote.cost.toNumber() / LAMPORTS_PER_SOL;
const costInUsd = costInSol * SOL_PRICE_USD;
const spotPriceInSol = quote.spotPrice.toNumber() / LAMPORTS_PER_SOL;
const spotPriceInUsd = spotPriceInSol * SOL_PRICE_USD;

console.log(`Cost to buy 1M tokens: ${costInSol.toFixed(6)} SOL ($${costInUsd.toFixed(2)})`);
console.log(`Spot price per token: ${spotPriceInUsd.toFixed(10)} USD`);
console.log(`Slippage: ${(quote.slippage / 100).toFixed(2)}%`);
```

## Benefits of View Functions

1. **No Transaction Costs**: View functions don't send transactions, so no gas fees
2. **Instant Results**: No need to wait for transaction confirmation
3. **No Wallet Signature**: Can be called without a wallet/signer
4. **Type Safe**: Full TypeScript type support from the IDL
5. **No State Changes**: Guaranteed to only read data, never modify blockchain state

## Implementation Notes

The view functions are implemented as:
- Regular program instructions that return values
- All accounts are read-only (no `mut`)
- Return types are custom structs with `AnchorSerialize` and `AnchorDeserialize`
- Automatically included in the IDL with the `returns` field
