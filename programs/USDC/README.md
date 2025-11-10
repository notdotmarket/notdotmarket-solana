# Mock USDC Token Program

A Solana program that implements a mock USDC token for testing purposes. This program uses the SPL Token standard and provides convenient methods for minting and transferring tokens in development and testing environments.

## Features

- **SPL Token Standard**: Fully compatible with SPL Token standard
- **6 Decimals**: Matches real USDC decimal precision
- **Flexible Minting**: Mint tokens to any account for testing
- **Standard Transfers**: Transfer tokens between accounts
- **Development Focus**: Designed for local testing and devnet deployment

## Program Instructions

### 1. Initialize Mint

Creates a new USDC mint with 6 decimals and specified authority.

```rust
pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()>
```

**Accounts:**
- `mint` (init, writable, signer): The mint account to create
- `authority` (mut, signer): The authority that can mint tokens
- `system_program`: System program
- `token_program`: SPL Token program
- `rent`: Rent sysvar

**Example:**
```typescript
await program.methods
  .initializeMint()
  .accounts({
    mint: mintKeypair.publicKey,
    authority: wallet.publicKey,
  })
  .signers([mintKeypair])
  .rpc();
```

### 2. Mint To

Mints mock USDC tokens to a specified account.

```rust
pub fn mint_to(ctx: Context<MintTokens>, amount: u64) -> Result<()>
```

**Parameters:**
- `amount`: The amount of tokens to mint (in smallest units, with 6 decimals)

**Accounts:**
- `mint` (mut): The mint account
- `destination` (mut): The token account to receive tokens
- `authority` (signer): The mint authority
- `token_program`: SPL Token program

**Example:**
```typescript
// Mint 1000 USDC (1000 * 10^6)
const amount = new anchor.BN(1000_000_000);
await program.methods
  .mintTo(amount)
  .accounts({
    mint: mintKeypair.publicKey,
    destination: userTokenAccount,
    authority: wallet.publicKey,
  })
  .rpc();
```

### 3. Transfer

Transfers mock USDC tokens between accounts.

```rust
pub fn transfer(ctx: Context<TransferTokens>, amount: u64) -> Result<()>
```

**Parameters:**
- `amount`: The amount of tokens to transfer (in smallest units)

**Accounts:**
- `from` (mut): The source token account
- `to` (mut): The destination token account
- `authority` (signer): The authority over the from account
- `token_program`: SPL Token program

**Example:**
```typescript
// Transfer 100 USDC
const amount = new anchor.BN(100_000_000);
await program.methods
  .transfer(amount)
  .accounts({
    from: senderTokenAccount,
    to: recipientTokenAccount,
    authority: sender.publicKey,
  })
  .signers([sender])
  .rpc();
```

## Usage

### Setup

1. Build the program:
```bash
anchor build
```

2. Deploy to devnet or localnet:
```bash
anchor deploy
```

### Testing

Run the test suite:
```bash
anchor test
```

Or run specific test:
```bash
anchor test -- --grep "Mock USDC"
```

### Integration with Other Programs

To use mock USDC in your own programs:

1. **Get the mint address** from deployment
2. **Create associated token accounts** for users
3. **Mint tokens** for testing
4. **Use standard SPL Token instructions** for transfers

Example integration:
```typescript
import { getAssociatedTokenAddress } from "@solana/spl-token";

// Get user's USDC token account
const userUsdcAccount = await getAssociatedTokenAddress(
  usdcMintAddress,
  userPublicKey
);

// Use in your program's instruction
await yourProgram.methods
  .yourInstruction()
  .accounts({
    userUsdc: userUsdcAccount,
    // ... other accounts
  })
  .rpc();
```

## Decimal Conversion

Mock USDC uses 6 decimals, like real USDC:

| UI Amount | Raw Amount (u64) |
|-----------|------------------|
| 1 USDC    | 1_000_000        |
| 100 USDC  | 100_000_000      |
| 1000 USDC | 1_000_000_000    |

## Security Considerations

⚠️ **WARNING**: This is a mock token for testing only!

- **No supply limit**: Anyone with mint authority can create unlimited tokens
- **Centralized control**: Single mint authority (good for testing)
- **Not audited**: This code is for development/testing purposes only
- **Never use in production**: Deploy real USDC for production applications

## Development

The program is located at:
```
programs/USDC/
├── Cargo.toml
├── Xargo.toml
├── README.md
└── src/
    └── lib.rs
```

Key dependencies:
- `anchor-lang = "0.31.1"`
- `anchor-spl = "0.31.1"`

## Program ID

The program ID is declared in `lib.rs`:
```rust
declare_id!("AXsvvaM4CB4ixKBWtcsobwGtQtD32XD6NEaKRvhY8QDz");
```

This ID will change when you deploy to different networks.

## License

This is a development tool. Use at your own risk.
