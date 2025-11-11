# Admin and Whitelist Management Changes

## Overview
Added functionality to manage admin authority and maintain two whitelisted wallets that can launch new tokens alongside the admin.

## Changes Made

### 1. State Changes (`state.rs`)

#### Updated `LaunchpadConfig` struct:
- Added `whitelisted_wallet_1: Pubkey` - First whitelisted wallet for token launches
- Added `whitelisted_wallet_2: Pubkey` - Second whitelisted wallet for token launches
- Updated `LEN` calculation to include new fields (added 64 bytes for two Pubkeys)

#### Added helper method:
```rust
pub fn is_authorized_launcher(&self, wallet: &Pubkey) -> bool
```
Checks if a wallet is authorized to create token launches (admin or whitelisted wallet).

### 2. Events (`events.rs`)

#### Added new events:

**AdminChanged**
- Emitted when admin authority is changed
- Fields: `old_authority`, `new_authority`, `changed_by`, `timestamp`

**WhitelistedWalletsUpdated**
- Emitted when whitelisted wallets are updated
- Fields: `authority`, `whitelisted_wallet_1`, `whitelisted_wallet_2`, `timestamp`

### 3. Token Creation (`token_creation.rs`)

#### Updated `InitializeLaunchpad`:
- Initializes `whitelisted_wallet_1` and `whitelisted_wallet_2` as `Pubkey::default()` (none)

#### Updated `CreateTokenLaunch` context:
- Added `config: Account<'info, LaunchpadConfig>` to access launchpad configuration
- Added authorization check in `create()` method using `config.is_authorized_launcher()`

#### New contexts added:

**UpdateAdmin**
- Allows admin to change the admin authority
- Constraint: Only current admin can call this
- Method: `update_authority(new_authority: Pubkey)`

**UpdateWhitelistedWallets**
- Allows admin to update both whitelisted wallets
- Constraint: Only admin can call this
- Method: `update_whitelisted_wallets(whitelisted_wallet_1: Pubkey, whitelisted_wallet_2: Pubkey)`

### 4. Program Instructions (`lib.rs`)

#### New instructions added:

**update_admin**
```rust
pub fn update_admin(
    ctx: Context<UpdateAdmin>,
    new_authority: Pubkey,
) -> Result<()>
```
- Updates the admin authority
- Emits `AdminChanged` event
- Admin-only function

**update_whitelisted_wallets**
```rust
pub fn update_whitelisted_wallets(
    ctx: Context<UpdateWhitelistedWallets>,
    whitelisted_wallet_1: Pubkey,
    whitelisted_wallet_2: Pubkey,
) -> Result<()>
```
- Updates both whitelisted wallets
- Emits `WhitelistedWalletsUpdated` event
- Admin-only function

## Authorization Flow

### Token Launch Creation
1. When `create_token_launch` is called, the program checks if the creator is authorized
2. Authorization passes if the creator is:
   - The admin authority, OR
   - Whitelisted wallet 1 (if set and not default), OR
   - Whitelisted wallet 2 (if set and not default)
3. If unauthorized, transaction fails with `LaunchpadError::Unauthorized`

### Important: Whitelisted Wallets Are Optional
- **During initialization**: Whitelisted wallets are set to `Pubkey::default()` (zero address), meaning they are inactive
- **Default wallets do NOT grant authorization**: Only non-default whitelisted wallets can create tokens
- **Can be set later**: Admin can call `update_whitelisted_wallets` at any time to activate them
- **Flexibility**: You can initialize the launchpad without whitelisted wallets and add them later as needed

### Admin Management
- Only the current admin can:
  - Change the admin authority
  - Update whitelisted wallets
  - Update fee recipient
  - Update platform fees

## Usage Examples

### Initialize Launchpad (Without Whitelisted Wallets)
```typescript
// Whitelisted wallets are optional during initialization
// They default to Pubkey::default() and can be set later
await program.methods
  .initializeLaunchpad(platformFeeBps)
  .accounts({
    config: configPda,
    authority: admin.publicKey,
    feeRecipient: feeRecipient.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([admin])
  .rpc();
```

### Update Whitelisted Wallets (Anytime After Initialization)
```typescript
// Admin can set or update whitelisted wallets at any time
await program.methods
  .updateWhitelistedWallets(
    whitelistedWallet1.publicKey,
    whitelistedWallet2.publicKey
  )
  .accounts({
    config: configPda,
    authority: admin.publicKey,
  })
  .signers([admin])
  .rpc();
```

### Update Admin Authority
```typescript
await program.methods
  .updateAdmin(newAdmin.publicKey)
  .accounts({
    config: configPda,
    authority: currentAdmin.publicKey,
    newAuthority: newAdmin.publicKey,
  })
  .signers([currentAdmin])
  .rpc();
```

### Disable Whitelisted Wallets
```typescript
// Set whitelisted wallets back to default to disable them
const defaultPubkey = new PublicKey("11111111111111111111111111111111");
await program.methods
  .updateWhitelistedWallets(defaultPubkey, defaultPubkey)
  .accounts({
    config: configPda,
    authority: admin.publicKey,
  })
  .signers([admin])
  .rpc();
```

### Create Token Launch (as whitelisted wallet)
```typescript
await program.methods
  .createTokenLaunch(name, symbol, metadataUri, solPriceUsd)
  .accounts({
    config: configPda, // Now required to check authorization
    tokenLaunch: tokenLaunchPda,
    mint: mintPda,
    bondingCurve: bondingCurvePda,
    curveTokenAccount,
    solVault: solVaultPda,
    creator: whitelistedWallet.publicKey, // Can be admin or whitelisted wallet
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
    rent: SYSVAR_RENT_PUBKEY,
  })
  .signers([whitelistedWallet])
  .rpc();
```

## Security Considerations

1. **Admin Control**: Only the current admin can change admin authority or whitelisted wallets
2. **Authorization Check**: Token launches are restricted to admin and whitelisted wallets only
3. **Default Pubkey Protection**: `Pubkey::default()` (zero address) does NOT grant authorization - prevents accidental or malicious authorization
4. **Optional Whitelisting**: Whitelisted wallets are optional during initialization and can be set/updated later
5. **Event Emission**: All admin changes emit events for transparency and tracking
6. **Flexible Deactivation**: Whitelisted wallets can be deactivated by setting them back to default pubkey

## Migration Notes

⚠️ **Important**: This change modifies the `LaunchpadConfig` account structure. Existing deployments will need to be reinitialized or migrated to accommodate the new fields.

### Option 1: Fresh Deployment
- Deploy new program
- Initialize with new `LaunchpadConfig` structure

### Option 2: Data Migration
- Create migration script to:
  1. Read existing config data
  2. Close old account
  3. Create new account with extended space
  4. Restore original data + initialize new fields

## Testing Recommendations

1. Test admin authority change
2. Test whitelisted wallet updates
3. Test token launch creation as:
   - Admin (should succeed)
   - Whitelisted wallet 1 (should succeed)
   - Whitelisted wallet 2 (should succeed)
   - Unauthorized wallet (should fail)
4. Test authorization after admin change
5. Test authorization after whitelist updates
6. Test event emissions

## Build Status

✅ Program successfully compiled with warnings (expected Anchor framework warnings about `anchor-debug` cfg condition)
