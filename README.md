# NotMarket Solana - Token Launchpad with Bonding Curve

A decentralized token launchpad on Solana featuring automated bonding curve pricing, permissionless trading, and automatic graduation to DEX liquidity pools.

[![Tests](https://img.shields.io/badge/tests-31%2F31%20passing-brightgreen)](./tests)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.1-purple)](https://www.anchor-lang.com/)
[![Solana](https://img.shields.io/badge/Solana-1.18-blue)](https://solana.com/)

---

## 🎯 Overview

NotMarket Solana enables anyone to launch tokens with:
- **Automated Pricing**: Bonding curve determines token price based on supply
- **Fair Launch**: No presale, everyone buys at market price
- **Auto-Graduation**: Successful tokens automatically graduate to DEX with liquidity
- **Low Fees**: Only 1% platform fee on trades

### Key Features

- ✅ Permissionless token creation
- ✅ Bonding curve pricing (exponential growth)
- ✅ Built-in trading (buy/sell)
- ✅ Graduation to DEX at 800M tokens sold
- ✅ Automated LP creation
- ✅ Event-driven architecture
- ✅ Comprehensive test coverage (31/31 passing)

---

## 📊 System Architecture

```mermaid
graph TB
    subgraph "User Actions"
        U1[Create Token]
        U2[Buy Tokens]
        U3[Sell Tokens]
        U4[Withdraw Liquidity]
    end
    
    subgraph "Program Accounts"
        LC[LaunchpadConfig<br/>Platform Settings]
        TL[TokenLaunch<br/>Token Metadata]
        BC[BondingCurve<br/>Pricing State]
        UP[UserPosition<br/>User Holdings]
    end
    
    subgraph "PDAs & Assets"
        SV[SOL Vault PDA<br/>Holds Trading SOL]
        CT[Curve Token Account<br/>Holds LP Tokens]
        M[Mint<br/>Token Mint Account]
    end
    
    subgraph "External"
        FR[Fee Recipient<br/>Platform Treasury]
        DEX[DEX Pool<br/>Raydium/Orca]
    end
    
    U1 --> TL
    U1 --> BC
    U1 --> M
    U1 --> CT
    
    U2 --> BC
    U2 --> UP
    U2 --> SV
    U2 --> FR
    
    U3 --> BC
    U3 --> UP
    U3 --> SV
    U3 --> FR
    
    U4 --> SV
    U4 --> CT
    U4 --> DEX
    
    LC -.Fee Config.-> U2
    LC -.Fee Config.-> U3
    
    TL --> BC
    BC --> TL
    
    style LC fill:#e1f5ff
    style TL fill:#fff3e1
    style BC fill:#e8f5e9
    style UP fill:#fce4ec
    style SV fill:#f3e5f5
    style CT fill:#fff9c4
    style FR fill:#ffebee
    style DEX fill:#e0f2f1
```

---

## 🏗️ PDA Architecture

### PDA Derivation Map

```mermaid
graph LR
    subgraph "Seeds"
        S1["'launchpad_config'"]
        S2["'mint' + creator + name"]
        S3["'token_launch' + mint"]
        S4["'bonding_curve' + token_launch"]
        S5["'sol_vault' + bonding_curve"]
        S6["'user_position' + user + token_launch"]
    end
    
    subgraph "PDAs"
        P1[LaunchpadConfig PDA]
        P2[Mint PDA]
        P3[TokenLaunch PDA]
        P4[BondingCurve PDA]
        P5[SOL Vault PDA]
        P6[UserPosition PDA]
    end
    
    S1 --> P1
    S2 --> P2
    S3 --> P3
    S4 --> P4
    S5 --> P5
    S6 --> P6
    
    P2 -.owns.-> P3
    P3 -.owns.-> P4
    P4 -.owns.-> P5
    
    style P1 fill:#e3f2fd
    style P2 fill:#f3e5f5
    style P3 fill:#fff3e0
    style P4 fill:#e8f5e9
    style P5 fill:#fce4ec
    style P6 fill:#f1f8e9
```

### PDA Details

| PDA | Seeds | Purpose | Holds |
|-----|-------|---------|-------|
| **LaunchpadConfig** | `["launchpad_config"]` | Platform configuration | Fee settings, authority |
| **Mint** | `["mint", creator, token_name]` | Token mint account | Token mint authority |
| **TokenLaunch** | `["token_launch", mint]` | Token metadata | Name, symbol, creator info |
| **BondingCurve** | `["bonding_curve", token_launch]` | Pricing state | Tokens sold, SOL reserve |
| **SOL Vault** | `["sol_vault", bonding_curve]` | SOL storage | Trading proceeds for LP |
| **UserPosition** | `["user_position", user, token_launch]` | User holdings | Tokens owned, SOL invested |

---

## 🔄 Token Lifecycle Flow

```mermaid
sequenceDiagram
    participant Creator
    participant Program
    participant BondingCurve
    participant Buyers
    participant DEX
    
    Creator->>Program: 1. Create Token Launch
    Program->>Program: Initialize Mint (1B tokens)
    Program->>BondingCurve: Create curve (800M tradeable)
    Program->>Program: Send 200M tokens to curve for LP
    
    Note over BondingCurve: Phase 1: Trading
    
    Buyers->>BondingCurve: 2. Buy Tokens
    BondingCurve->>BondingCurve: Calculate price (bonding curve)
    BondingCurve->>Buyers: Send tokens
    BondingCurve->>Program: Store SOL in vault
    
    Buyers->>BondingCurve: 3. Sell Tokens (optional)
    BondingCurve->>BondingCurve: Calculate return price
    BondingCurve->>Buyers: Send SOL from vault
    BondingCurve->>Program: Burn/hold tokens
    
    Note over BondingCurve: Check: 800M sold + $12k raised?
    
    BondingCurve->>BondingCurve: 4. Graduate! 🎓
    
    Note over BondingCurve: Phase 2: Graduated
    
    Creator->>Program: 5. Withdraw Liquidity
    Program->>Program: Transfer SOL from vault
    Program->>Program: Transfer 200M tokens
    Creator->>DEX: 6. Create DEX Pool
    DEX->>DEX: LP Created ✅
```

---

## 💰 Fee Distribution Flow

```mermaid
graph TB
    subgraph "Buy Transaction"
        B1[User Pays SOL]
        B2{Split Payment}
        B3[Token Cost<br/>99%]
        B4[Platform Fee<br/>1%]
        B5[SOL Vault PDA]
        B6[Fee Recipient]
        B7[User Receives Tokens]
    end
    
    subgraph "Sell Transaction"
        S1[User Sends Tokens]
        S2{Calculate Proceeds}
        S3[Gross Proceeds<br/>100%]
        S4[Platform Fee<br/>1%]
        S5[Net Proceeds<br/>99%]
        S6[Fee Recipient]
        S7[User Receives SOL]
    end
    
    B1 --> B2
    B2 --> B3
    B2 --> B4
    B3 --> B5
    B4 --> B6
    B5 -.stored.-> B7
    
    S1 --> S2
    S2 --> S3
    S3 --> S4
    S3 --> S5
    S4 --> S6
    S5 --> S7
    
    style B5 fill:#e8f5e9
    style B6 fill:#ffebee
    style S6 fill:#ffebee
    style B7 fill:#e3f2fd
    style S7 fill:#e3f2fd
```

### Fee Breakdown

| Action | User Pays | Token Cost | Platform Fee | Destination |
|--------|-----------|------------|--------------|-------------|
| **Buy** | 100% | 99% → SOL Vault | 1% → Fee Recipient | Vault holds for LP |
| **Sell** | Returns tokens | 99% → User | 1% → Fee Recipient | User gets SOL back |

---

## 📈 Bonding Curve Mechanics

```mermaid
graph LR
    subgraph "Price Formula"
        F1[Start Price: 0.000000028 SOL]
        F2[Current Supply: N tokens sold]
        F3[Target: 800M tokens]
        F4[End Price: ~0.015 SOL]
        F5[Formula: Exponential Growth]
    end
    
    subgraph "Price Progression"
        P1[0 tokens<br/>0.000000028 SOL]
        P2[200M tokens<br/>~0.001 SOL]
        P3[400M tokens<br/>~0.003 SOL]
        P4[600M tokens<br/>~0.008 SOL]
        P5[800M tokens<br/>~0.015 SOL]
    end
    
    F1 --> P1
    P1 --> P2
    P2 --> P3
    P3 --> P4
    P4 --> P5
    P5 --> F4
    
    style P1 fill:#e8f5e9
    style P2 fill:#fff9c4
    style P3 fill:#ffe0b2
    style P4 fill:#ffccbc
    style P5 fill:#ffcdd2
```

### Curve Parameters

```rust
TOTAL_SUPPLY = 1,000,000,000 tokens (1 billion)
CURVE_SUPPLY = 800,000,000 tokens (tradeable)
LP_SUPPLY = 200,000,000 tokens (reserved for LP)

START_PRICE_USD = 0.000004 USD
GRADUATION_USD = 12,000 USD (target raise)

Price = START_PRICE * exp(growth_rate * tokens_sold)
```

---

## 🔐 Authorization Model

```mermaid
graph TB
    subgraph "Restricted Operations"
        R1[Initialize Launchpad]
        R2[Toggle Active Status]
        R3[Update Metadata]
        R4[Withdraw Liquidity]
    end
    
    subgraph "Authority Checks"
        A1{Is Authority?}
        A2{Is Creator?}
        A3{Is Creator?}
        A4{Is Creator + Graduated?}
    end
    
    subgraph "Permissionless Operations"
        P1[Create Token Launch]
        P2[Buy Tokens]
        P3[Sell Tokens]
        P4[Get Buy Quote]
    end
    
    R1 --> A1
    R2 --> A2
    R3 --> A3
    R4 --> A4
    
    A1 -->|Yes| OK1[✅ Allowed]
    A1 -->|No| ERR1[❌ Unauthorized]
    
    A2 -->|Yes| OK2[✅ Allowed]
    A2 -->|No| ERR2[❌ Unauthorized]
    
    A3 -->|Yes| OK3[✅ Allowed]
    A3 -->|No| ERR3[❌ Unauthorized]
    
    A4 -->|Yes| OK4[✅ Allowed]
    A4 -->|No| ERR4[❌ Not Graduated]
    
    P1 -.Anyone.-> OK5[✅ Permissionless]
    P2 -.Anyone.-> OK6[✅ Permissionless]
    P3 -.Anyone.-> OK7[✅ Permissionless]
    P4 -.Anyone.-> OK8[✅ Permissionless]
    
    style R1 fill:#ffebee
    style R2 fill:#ffebee
    style R3 fill:#ffebee
    style R4 fill:#ffebee
    style P1 fill:#e8f5e9
    style P2 fill:#e8f5e9
    style P3 fill:#e8f5e9
    style P4 fill:#e8f5e9
```

---

## 🚀 Graduation & LP Creation

```mermaid
sequenceDiagram
    participant BC as BondingCurve
    participant Check as Graduation Check
    participant Creator
    participant Vault as SOL Vault PDA
    participant Tokens as Curve Token Account
    participant DEX as DEX Pool
    
    Note over BC: Trading Phase
    BC->>Check: Tokens Sold >= 800M?
    BC->>Check: SOL Raised >= $12k?
    
    alt Both Conditions Met
        Check->>BC: Set is_graduated = true ✅
        BC->>BC: Stop trading
        
        Note over BC: Graduation Complete 🎓
        
        Creator->>BC: Call withdraw_liquidity()
        BC->>BC: Verify creator authority
        BC->>BC: Verify is_graduated = true
        
        BC->>Vault: Transfer all SOL
        Vault->>Creator: ~$12,000 in SOL
        
        BC->>Tokens: Transfer 200M tokens
        Tokens->>Creator: 200M tokens for LP
        
        Creator->>DEX: Create Pool (SOL + Tokens)
        DEX->>DEX: Mint LP tokens
        DEX->>Creator: LP tokens + trading fees
        
        Note over DEX: Token Now Trading on DEX 🎉
    else Conditions Not Met
        Check->>BC: Keep trading
        BC->>BC: is_graduated = false
    end
```

### Graduation Criteria

| Metric | Requirement | Current | Status |
|--------|-------------|---------|--------|
| **Tokens Sold** | 800,000,000 (800M) | Tracked in BondingCurve | ⏳ |
| **SOL Raised** | ~$12,000 USD equivalent | ~80 SOL @ $150/SOL | ⏳ |
| **Is Graduated** | Must be `true` | Automatically set | ⏳ |

---

## 📦 Account State Diagram

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    
    Uninitialized --> LaunchpadInit: initialize_launchpad()
    
    LaunchpadInit --> TokenCreated: create_token_launch()
    
    TokenCreated --> Active: Token is active
    TokenCreated --> Paused: toggle_token_launch_active()
    
    Paused --> Active: toggle_token_launch_active()
    Active --> Paused: toggle_token_launch_active()
    
    Active --> Trading: buy_tokens() / sell_tokens()
    Trading --> Trading: More trades
    
    Trading --> CheckGraduation: After each trade
    CheckGraduation --> Trading: Not graduated yet
    CheckGraduation --> Graduated: 800M sold + $12k raised
    
    Graduated --> LPCreated: withdraw_liquidity()
    
    LPCreated --> [*]: Token on DEX
    
    note right of Trading
        Bonding curve active
        Price increases with supply
        Fees collected: 1%
    end note
    
    note right of Graduated
        Trading stops
        Only creator can withdraw
        LP creation enabled
    end note
```

---

## 🔧 Installation & Setup

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1
avm use 0.30.1

# Install Node.js dependencies
yarn install
```

### Build

```bash
anchor build
```

### Test

```bash
# Run all tests (31 tests)
anchor test

# Run specific test file
anchor test --skip-build tests/notmarket-solana.ts
```

### Deploy

```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet (use with caution)
anchor deploy --provider.cluster mainnet
```

---

## 📝 Usage Examples

### 1. Initialize Launchpad

```typescript
await program.methods
  .initializeLaunchpad(100) // 1% fee (100 bps)
  .accounts({
    config: configPda,
    authority: authority.publicKey,
    feeRecipient: feeRecipient.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### 2. Create Token Launch

```typescript
await program.methods
  .createTokenLaunch(
    "My Token",
    "MTK",
    "https://example.com/metadata.json",
    new BN(150_00000000) // $150 SOL price
  )
  .accounts({
    tokenLaunch: tokenLaunchPda,
    mint: mintPda,
    bondingCurve: bondingCurvePda,
    curveTokenAccount,
    solVault: solVaultPda,
    creator: creator.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([creator])
  .rpc();
```

### 3. Buy Tokens

```typescript
await program.methods
  .buyTokens(
    new BN(1_000_000_000), // 1 token (9 decimals)
    new BN(LAMPORTS_PER_SOL) // Max 1 SOL
  )
  .accounts({
    config: configPda,
    tokenLaunch: tokenLaunchPda,
    bondingCurve: bondingCurvePda,
    curveTokenAccount,
    solVault: solVaultPda,
    userPosition: userPositionPda,
    mint: mintPda,
    buyerTokenAccount,
    buyer: buyer.publicKey,
    feeRecipient: feeRecipient.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([buyer])
  .rpc();
```

### 4. Sell Tokens

```typescript
await program.methods
  .sellTokens(
    new BN(500_000_000), // 0.5 tokens
    new BN(0) // Min 0 SOL (no slippage protection)
  )
  .accounts({
    config: configPda,
    tokenLaunch: tokenLaunchPda,
    bondingCurve: bondingCurvePda,
    curveTokenAccount,
    solVault: solVaultPda,
    userPosition: userPositionPda,
    sellerTokenAccount,
    seller: seller.publicKey,
    feeRecipient: feeRecipient.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([seller])
  .rpc();
```

### 5. Withdraw Liquidity (After Graduation)

```typescript
await program.methods
  .withdrawLiquidity()
  .accounts({
    tokenLaunch: tokenLaunchPda,
    bondingCurve: bondingCurvePda,
    solVault: solVaultPda,
    curveTokenAccount,
    solRecipient: dexPoolAddress,
    tokenRecipient: dexTokenAccount,
    authority: creator.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([creator])
  .rpc();
```

---

## 📊 Events

The program emits comprehensive events for easy integration:

```mermaid
graph LR
    subgraph "Platform Events"
        E1[LaunchpadInitialized]
    end
    
    subgraph "Token Events"
        E2[TokenLaunchCreated]
        E3[LaunchStatusToggled]
        E4[MetadataUpdated]
    end
    
    subgraph "Trading Events"
        E5[TokensPurchased]
        E6[TokensSold]
        E7[UserPositionUpdated]
        E8[PriceQuoteRequested]
    end
    
    subgraph "Graduation Events"
        E9[CurveGraduated]
    end
    
    style E1 fill:#e3f2fd
    style E2 fill:#fff3e0
    style E3 fill:#fff3e0
    style E4 fill:#fff3e0
    style E5 fill:#e8f5e9
    style E6 fill:#ffebee
    style E7 fill:#f3e5f5
    style E8 fill:#fce4ec
    style E9 fill:#fff9c4
```

### Event Definitions

| Event | Emitted When | Contains |
|-------|--------------|----------|
| **LaunchpadInitialized** | Platform setup | Authority, fee recipient, fee bps |
| **TokenLaunchCreated** | New token launched | Token details, creator, mint |
| **TokensPurchased** | User buys tokens | Amount, cost, fee, buyer |
| **TokensSold** | User sells tokens | Amount, proceeds, fee, seller |
| **UserPositionUpdated** | Trade complete | Holdings, invested, received |
| **CurveGraduated** | Graduation achieved | Final stats, timestamp |
| **LaunchStatusToggled** | Active status changed | New status |
| **MetadataUpdated** | URI updated | New URI |
| **PriceQuoteRequested** | Quote calculated | Amount, cost, fee |

---

## 🧪 Test Coverage

```
✅ 31/31 tests passing (100%)

Test Suites:
├── Initialization (1 test)
├── Token Creation (2 tests)
├── Buying Tokens (4 tests)
├── Selling Tokens (3 tests)
├── Token Launch Management (3 tests)
├── Authorization Tests (10 tests)
│   ├── Restricted operations
│   ├── Authority verification
│   └── Permissionless operations
├── Get Buy Quote (1 test)
├── Graduation Logic (1 test)
├── Account State Verification (1 test)
└── Fee Distribution & Liquidity (5 tests)
    ├── Fee recipient verification
    ├── SOL vault verification
    ├── Token account verification
    ├── Withdrawal authorization
    └── Complete flow summary
```

---

## 📚 Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - System architecture and design
- [`FIXED_TOKENOMICS.md`](./FIXED_TOKENOMICS.md) - Tokenomics and bonding curve
- [`EVENT_DOCUMENTATION.md`](./EVENT_DOCUMENTATION.md) - Event system details
- [`FEE_AND_LIQUIDITY_VERIFIED.md`](./FEE_AND_LIQUIDITY_VERIFIED.md) - Fee distribution
- [`AUTHORIZATION_TESTING.md`](./AUTHORIZATION_TESTING.md) - Security model
- [`DIAGRAMS.md`](./DIAGRAMS.md) - Visual diagrams (this file)

---

## 🔒 Security

### Audited Components
- ✅ Authorization controls (has_one constraints)
- ✅ PDA derivation and ownership
- ✅ Fee distribution mechanism
- ✅ Bonding curve calculations
- ✅ Slippage protection
- ✅ Graduation conditions

### Security Best Practices
- PDA-based architecture prevents address spoofing
- Signer verification on all mutations
- Explicit authorization checks (has_one constraints)
- Rent-exemption for all accounts
- Safe math operations (checked arithmetic)
- Comprehensive test coverage

### Known Limitations
- Bonding curve formula is exponential (price increases rapidly)
- No pause mechanism after graduation
- LP creation is manual (not automatic)
- Single authority model for launchpad config

---

## 🤝 Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Workflow

```bash
# 1. Make changes
# 2. Run tests
anchor test

# 3. Check for errors
anchor build

# 4. Commit with conventional commits
git commit -m "feat: Your feature description"

# 5. Push and create PR
git push origin your-branch
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [Anchor Framework](https://www.anchor-lang.com/)
- Powered by [Solana](https://solana.com/)

---

## 📞 Contact & Support

- **Issues**: [GitHub Issues](https://github.com/notdotmarket/notmarket-solana/issues)
- **Discussions**: [GitHub Discussions](https://github.com/notdotmarket/notmarket-solana/discussions)

---

<div align="center">

**Built with ❤️ on Solana**

[Website](https://notmarket.io) • [Twitter](https://twitter.com/notmarket) • [Discord](https://discord.gg/notmarket)

</div>
