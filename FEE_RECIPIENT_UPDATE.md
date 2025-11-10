# Fee Recipient Update Feature

## Summary
Added functionality to update the fee recipient address for the launchpad, fixing the integration issue where the fee recipient was incorrectly set to the program itself.

## Changes Made

### 1. **New Instruction: `update_fee_recipient`**
   - **File**: `programs/notmarket-solana/src/lib.rs`
   - Allows the authority to update the fee recipient address
   - Only the authority can call this function
   - Emits `FeeRecipientUpdated` event

### 2. **New Account Context: `UpdateFeeRecipient`**
   - **File**: `programs/notmarket-solana/src/token_creation.rs`
   - Validates that only the authority can update the fee recipient
   - Constrains config PDA and authority signature

### 3. **New Event: `FeeRecipientUpdated`**
   - **File**: `programs/notmarket-solana/src/events.rs`
   - Tracks fee recipient changes
   - Logs old and new recipient addresses

### 4. **Updated Test Configuration**
   - **File**: `tests/bonding-curve-trading.ts`
   - Changed initialization to use authority as initial fee recipient (instead of a separate keypair)
   - Added new test section "2.5. Fee Recipient Management"
   - Tests both successful update and unauthorized access prevention

## How to Use

### Initialize with Authority as Fee Recipient
```typescript
await program.methods
  .initializeLaunchpad(platformFeeBps)
  .accounts({
    config: configPda,
    authority: authority.publicKey,
    feeRecipient: authority.publicKey, // Set to authority
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Update Fee Recipient
```typescript
await program.methods
  .updateFeeRecipient(newFeeRecipient)
  .accounts({
    config: configPda,
    authority: authority.publicKey,
  })
  .rpc();
```

## Problem Fixed

**Original Issue**: 
- Fee recipient was set to the program itself during initialization
- This caused `ConstraintMut` error (2000) during buy/sell transactions
- Program accounts have special ownership rules and cannot receive SOL transfers like normal accounts

**Solution**:
- Initialize with authority (admin wallet) as fee recipient
- Authority wallet can receive SOL transfers normally
- Added ability to update fee recipient to any valid account later

## Test Results

All 15 tests passing:
- ✅ Token Launch Setup
- ✅ View Functions & Quotes
- ✅ **Fee Recipient Management** (NEW)
  - Updates fee recipient successfully
  - Prevents unauthorized updates
- ✅ Execute Large Trades (50M, 100M, 150M tokens)
- ✅ Sell Trades
- ✅ Graduation with Large Purchase
- ✅ Minimum Purchase (1 token)
- ✅ Final State Summary

## Integration Fix

To fix your integration environment:

1. **Check current fee recipient**:
   ```bash
   anchor account launchpad_config <CONFIG_PDA>
   ```

2. **If fee recipient is the program itself, update it**:
   ```typescript
   await program.methods
     .updateFeeRecipient(yourAdminWallet.publicKey)
     .accounts({
       config: configPda,
       authority: yourAdminWallet.publicKey,
     })
     .rpc();
   ```

3. **Ensure the new fee recipient has SOL balance** (for rent exemption)

## Security

- Only the original authority can update the fee recipient
- Constraint validation prevents unauthorized changes
- Events are emitted for audit trail
