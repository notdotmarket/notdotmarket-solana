# Visual Diagrams - NotMarket Solana

Complete visual reference for the NotMarket Solana token launchpad system.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [PDA Architecture](#pda-architecture)
3. [Token Lifecycle](#token-lifecycle)
4. [Trading Flow](#trading-flow)
5. [Fee Distribution](#fee-distribution)
6. [Bonding Curve](#bonding-curve)
7. [Authorization](#authorization)
8. [Graduation Process](#graduation-process)
9. [Account States](#account-states)
10. [Event Flow](#event-flow)

---

## System Architecture

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

**Description**: High-level system architecture showing user interactions with program accounts, PDAs, and external systems.

---

## PDA Architecture

### PDA Derivation Map

```mermaid
graph TB
    subgraph "Program ID"
        PID[Program ID:<br/>9afoMEfpJbXduHMWxTMTJJzTzRuJL8cCPVzXuxVF8auK]
    end
    
    subgraph "PDA Seeds & Derivation"
        S1["Seeds: ['launchpad_config']"]
        S2["Seeds: ['mint', creator_pubkey, token_name]"]
        S3["Seeds: ['token_launch', mint_pubkey]"]
        S4["Seeds: ['bonding_curve', token_launch_pubkey]"]
        S5["Seeds: ['sol_vault', bonding_curve_pubkey]"]
        S6["Seeds: ['user_position', user_pubkey, token_launch_pubkey]"]
    end
    
    subgraph "Derived PDAs"
        P1[LaunchpadConfig PDA<br/>Authority + Fee Settings]
        P2[Mint PDA<br/>Token Mint Authority]
        P3[TokenLaunch PDA<br/>Token Metadata]
        P4[BondingCurve PDA<br/>Pricing State]
        P5[SOL Vault PDA<br/>Holds ~$12k SOL]
        P6[UserPosition PDA<br/>User Holdings]
    end
    
    subgraph "Relationships"
        R1[Owns Mint Authority]
        R2[References BC]
        R3[Owns Token Account]
        R4[Stores SOL]
    end
    
    PID --> S1
    PID --> S2
    PID --> S3
    PID --> S4
    PID --> S5
    PID --> S6
    
    S1 --> P1
    S2 --> P2
    S3 --> P3
    S4 --> P4
    S5 --> P5
    S6 --> P6
    
    P2 -.-> R1
    P3 -.-> R2
    P4 -.-> R3
    P5 -.-> R4
    
    style PID fill:#e3f2fd
    style P1 fill:#f3e5f5
    style P2 fill:#fff3e0
    style P3 fill:#ffe0b2
    style P4 fill:#e8f5e9
    style P5 fill:#fce4ec
    style P6 fill:#f1f8e9
```

### PDA Details Table

| PDA Name | Seeds | Bump | Size | Purpose |
|----------|-------|------|------|---------|
| **LaunchpadConfig** | `["launchpad_config"]` | Yes | ~100 bytes | Platform-wide configuration |
| **Mint** | `["mint", creator, name]` | Yes | 82 bytes | SPL Token mint account |
| **TokenLaunch** | `["token_launch", mint]` | Yes | ~200 bytes | Token metadata and state |
| **BondingCurve** | `["bonding_curve", token_launch]` | Yes | ~150 bytes | Pricing and trading state |
| **SOL Vault** | `["sol_vault", bonding_curve]` | Yes | 0 bytes | System account holding SOL |
| **UserPosition** | `["user_position", user, token_launch]` | Yes | ~100 bytes | Individual user holdings |

---

## Token Lifecycle

```mermaid
sequenceDiagram
    participant C as Creator
    participant P as Program
    participant BC as BondingCurve
    participant B as Buyers/Sellers
    participant V as SOL Vault
    participant T as Token Account
    participant D as DEX
    
    Note over C,D: Phase 1: Launch
    C->>P: create_token_launch()
    P->>P: Create Mint (1B tokens)
    P->>BC: Initialize curve state
    P->>T: Send 200M tokens (LP reserve)
    P->>V: Create SOL vault PDA
    
    Note over C,D: Phase 2: Trading (0 to 800M tokens)
    
    loop Trading Phase
        B->>BC: buy_tokens(amount)
        BC->>BC: Calculate price via curve
        BC->>V: Store SOL (99%)
        BC->>P: Send fee to recipient (1%)
        BC->>B: Transfer tokens
        BC->>BC: Update state
        
        B->>BC: sell_tokens(amount)
        BC->>BC: Calculate return price
        BC->>B: Send SOL from vault (99%)
        BC->>P: Send fee to recipient (1%)
        BC->>BC: Update state
        
        BC->>BC: Check graduation
        alt Not Graduated
            BC->>BC: Continue trading
        end
    end
    
    Note over C,D: Phase 3: Graduation (800M sold + $12k)
    
    BC->>BC: Set is_graduated = true 🎓
    BC->>BC: Stop new trades
    
    Note over C,D: Phase 4: LP Creation
    
    C->>P: withdraw_liquidity()
    P->>P: Verify creator + graduated
    V->>C: Transfer ~$12k SOL
    T->>C: Transfer 200M tokens
    
    C->>D: create_pool(SOL, tokens)
    D->>D: Create liquidity pool
    D->>C: Mint LP tokens
    
    Note over C,D: Phase 5: DEX Trading ✅
```

**Key Phases**:
1. **Launch**: Creator initializes token (1B supply, 800M tradeable, 200M for LP)
2. **Trading**: Users buy/sell via bonding curve, price increases
3. **Graduation**: At 800M tokens sold + $12k raised
4. **LP Creation**: Creator withdraws assets and creates DEX pool
5. **DEX Trading**: Token now trades on Raydium/Orca

---

## Trading Flow

### Buy Transaction Flow

```mermaid
graph TB
    Start([User Initiates Buy])
    
    Start --> Input[Input: Token Amount & Max SOL Cost]
    Input --> Check1{Is Launch Active?}
    Check1 -->|No| Error1[❌ Launch Inactive]
    Check1 -->|Yes| Check2{Graduated?}
    Check2 -->|Yes| Error2[❌ Already Graduated]
    Check2 -->|No| Calc[Calculate Cost via Curve]
    
    Calc --> Check3{Cost <= Max?}
    Check3 -->|No| Error3[❌ Slippage Exceeded]
    Check3 -->|Yes| Split[Split Payment]
    
    Split --> Cost[Token Cost: 99%]
    Split --> Fee[Platform Fee: 1%]
    
    Cost --> Vault[Transfer to SOL Vault PDA]
    Fee --> FeeRec[Transfer to Fee Recipient]
    
    Vault --> Transfer[Transfer Tokens to Buyer]
    Transfer --> Update1[Update Bonding Curve State]
    Update1 --> Update2[Update User Position]
    Update2 --> Event[Emit TokensPurchased Event]
    Event --> CheckGrad{Should Graduate?}
    
    CheckGrad -->|Yes| Grad[Set is_graduated = true]
    CheckGrad -->|No| End1([Transaction Complete])
    Grad --> GradEvent[Emit CurveGraduated Event]
    GradEvent --> End2([Transaction Complete])
    
    style Start fill:#e3f2fd
    style End1 fill:#e8f5e9
    style End2 fill:#fff9c4
    style Error1 fill:#ffebee
    style Error2 fill:#ffebee
    style Error3 fill:#ffebee
    style Vault fill:#f3e5f5
    style FeeRec fill:#ffcdd2
```

### Sell Transaction Flow

```mermaid
graph TB
    Start([User Initiates Sell])
    
    Start --> Input[Input: Token Amount & Min SOL Output]
    Input --> Check1{Is Launch Active?}
    Check1 -->|No| Error1[❌ Launch Inactive]
    Check1 -->|Yes| Check2{Graduated?}
    Check2 -->|Yes| Error2[❌ Already Graduated]
    Check2 -->|No| Check3{Has Enough Tokens?}
    
    Check3 -->|No| Error3[❌ Insufficient Balance]
    Check3 -->|Yes| Calc[Calculate Return via Curve]
    
    Calc --> Check4{Return >= Min?}
    Check4 -->|No| Error4[❌ Slippage Exceeded]
    Check4 -->|Yes| Split[Calculate Proceeds]
    
    Split --> Gross[Gross Proceeds: 100%]
    Gross --> Net[Net to User: 99%]
    Gross --> Fee[Platform Fee: 1%]
    
    Net --> VaultToUser[Transfer SOL from Vault]
    Fee --> FeeRec[Transfer to Fee Recipient]
    
    VaultToUser --> Burn[Transfer Tokens from User]
    Burn --> Update1[Update Bonding Curve State]
    Update1 --> Update2[Update User Position]
    Update2 --> Event[Emit TokensSold Event]
    Event --> End([Transaction Complete])
    
    style Start fill:#e3f2fd
    style End fill:#e8f5e9
    style Error1 fill:#ffebee
    style Error2 fill:#ffebee
    style Error3 fill:#ffebee
    style Error4 fill:#ffebee
    style VaultToUser fill:#f3e5f5
    style FeeRec fill:#ffcdd2
```

---

## Fee Distribution

```mermaid
graph LR
    subgraph "Buy Transaction - User Pays 100%"
        B1[User Payment<br/>100 SOL]
        B2{Split}
        B3[Token Cost<br/>99 SOL]
        B4[Platform Fee<br/>1 SOL]
    end
    
    subgraph "SOL Flow"
        V[SOL Vault PDA<br/>Stores 99 SOL]
        F[Fee Recipient<br/>Receives 1 SOL]
    end
    
    subgraph "Sell Transaction - User Receives 99%"
        S1[Token Sale<br/>Returns 100 SOL value]
        S2{Split}
        S3[Net Proceeds<br/>99 SOL]
        S4[Platform Fee<br/>1 SOL]
    end
    
    subgraph "User Receives"
        U[User<br/>Gets 99 SOL]
        F2[Fee Recipient<br/>Receives 1 SOL]
    end
    
    B1 --> B2
    B2 --> B3
    B2 --> B4
    B3 --> V
    B4 --> F
    
    S1 --> S2
    S2 --> S3
    S2 --> S4
    S3 --> U
    S4 --> F2
    
    V -.Stored for LP.-> V
    F -.Platform Revenue.-> F
    
    style B1 fill:#e3f2fd
    style V fill:#e8f5e9
    style F fill:#ffcdd2
    style U fill:#e3f2fd
    style F2 fill:#ffcdd2
```

### Fee Breakdown

| Transaction | User Input | Token Cost | Platform Fee | Fee Recipient Gets | Vault Stores |
|-------------|-----------|------------|--------------|-------------------|--------------|
| **Buy 1000 tokens** | 100 SOL | 99 SOL | 1 SOL | ✅ 1 SOL | ✅ 99 SOL |
| **Sell 1000 tokens** | 1000 tokens | 99 SOL | 1 SOL | ✅ 1 SOL | ❌ 99 SOL withdrawn |

---

## Bonding Curve

### Price Progression

```mermaid
graph LR
    subgraph "Supply Range: 0 to 800M tokens"
        P0[0 tokens<br/>Price: 0.000000028 SOL<br/>$0.000004]
        P1[100M tokens<br/>Price: ~0.0001 SOL<br/>~$0.015]
        P2[200M tokens<br/>Price: ~0.0003 SOL<br/>~$0.045]
        P3[400M tokens<br/>Price: ~0.002 SOL<br/>~$0.30]
        P4[600M tokens<br/>Price: ~0.008 SOL<br/>~$1.20]
        P5[800M tokens<br/>Price: ~0.015 SOL<br/>~$2.25]
    end
    
    subgraph "Target Metrics"
        T1[Total Raise: $12,000]
        T2[Average Price: $0.015]
        T3[Price Increase: 562,500x]
    end
    
    P0 -->|+100M| P1
    P1 -->|+100M| P2
    P2 -->|+200M| P3
    P3 -->|+200M| P4
    P4 -->|+200M| P5
    
    P5 --> T1
    P5 --> T2
    P0 --> T3
    
    style P0 fill:#e8f5e9
    style P1 fill:#f1f8e9
    style P2 fill:#fff9c4
    style P3 fill:#ffe0b2
    style P4 fill:#ffccbc
    style P5 fill:#ffcdd2
    style T1 fill:#e3f2fd
    style T2 fill:#e3f2fd
    style T3 fill:#e3f2fd
```

### Curve Formula

```mermaid
graph TB
    Input[Input: tokens_to_buy]
    
    Input --> Current[Get current_supply]
    Current --> New[new_supply = current + tokens_to_buy]
    
    New --> Integral[Calculate integral]
    
    Integral --> Formula["∫ price(x) dx from current to new"]
    
    Formula --> Exp["price(x) = START_PRICE * exp(k * x)"]
    
    Exp --> Params["START_PRICE = 0.000000028 SOL<br/>k = growth rate<br/>x = tokens sold"]
    
    Params --> Result[Total Cost in SOL]
    
    Result --> Fee["Add platform fee (1%)"]
    Fee --> Final[Final Cost to User]
    
    style Input fill:#e3f2fd
    style Formula fill:#fff9c4
    style Exp fill:#ffe0b2
    style Final fill:#e8f5e9
```

**Formula Details**:
```
price(supply) = START_PRICE * exp(GROWTH_RATE * supply / CURVE_SUPPLY)

Where:
- START_PRICE = 0.000000028 SOL ($0.000004 USD @ $150/SOL)
- CURVE_SUPPLY = 800,000,000 tokens
- GROWTH_RATE = ln(TARGET_PRICE / START_PRICE) ≈ 13.24
- TARGET_PRICE ≈ 0.015 SOL (at 800M tokens)

Cost = ∫[current_supply to new_supply] price(x) dx
```

---

## Authorization

### Permission Matrix

```mermaid
graph TB
    subgraph "Operations"
        O1[initialize_launchpad]
        O2[create_token_launch]
        O3[buy_tokens]
        O4[sell_tokens]
        O5[toggle_token_launch_active]
        O6[update_metadata_uri]
        O7[withdraw_liquidity]
        O8[get_buy_quote]
    end
    
    subgraph "Authority Checks"
        A1{Is Platform Authority?}
        A2{Any User}
        A3{Any User}
        A4{Any User}
        A5{Is Token Creator?}
        A6{Is Token Creator?}
        A7{Is Token Creator?<br/>+ Graduated?}
        A8{Any User}
    end
    
    subgraph "Results"
        OK[✅ Allowed]
        ERR[❌ Unauthorized]
        ERR2[❌ Not Graduated]
    end
    
    O1 --> A1
    O2 --> A2
    O3 --> A3
    O4 --> A4
    O5 --> A5
    O6 --> A6
    O7 --> A7
    O8 --> A8
    
    A1 -->|Yes| OK
    A1 -->|No| ERR
    
    A2 --> OK
    A3 --> OK
    A4 --> OK
    A8 --> OK
    
    A5 -->|Yes| OK
    A5 -->|No| ERR
    
    A6 -->|Yes| OK
    A6 -->|No| ERR
    
    A7 -->|Yes + Yes| OK
    A7 -->|No| ERR
    A7 -->|Not Graduated| ERR2
    
    style O1 fill:#ffebee
    style O2 fill:#e8f5e9
    style O3 fill:#e8f5e9
    style O4 fill:#e8f5e9
    style O5 fill:#ffebee
    style O6 fill:#ffebee
    style O7 fill:#ffebee
    style O8 fill:#e8f5e9
    style OK fill:#e8f5e9
    style ERR fill:#ffcdd2
    style ERR2 fill:#ffcdd2
```

### Security Mechanisms

```mermaid
graph TB
    subgraph "Account Validation"
        V1[PDA Seeds Validation]
        V2[Bump Seed Verification]
        V3[Owner Checks]
    end
    
    subgraph "Authorization"
        A1[has_one Constraints]
        A2[Signer Requirements]
        A3[Custom Constraints]
    end
    
    subgraph "Safety"
        S1[Rent Exemption]
        S2[Overflow Protection]
        S3[Zero Account Checks]
    end
    
    V1 --> A1
    V2 --> A1
    V3 --> A1
    
    A1 --> S1
    A2 --> S1
    A3 --> S1
    
    S1 --> Result[✅ Transaction Valid]
    S2 --> Result
    S3 --> Result
    
    style V1 fill:#e3f2fd
    style V2 fill:#e3f2fd
    style V3 fill:#e3f2fd
    style A1 fill:#fff9c4
    style A2 fill:#fff9c4
    style A3 fill:#fff9c4
    style S1 fill:#e8f5e9
    style S2 fill:#e8f5e9
    style S3 fill:#e8f5e9
    style Result fill:#c8e6c9
```

---

## Graduation Process

```mermaid
sequenceDiagram
    participant T as Trading Phase
    participant C as Check System
    participant BC as BondingCurve
    participant Cr as Creator
    participant V as SOL Vault
    participant TA as Token Account
    participant D as DEX
    
    Note over T,D: Continuous Trading
    
    loop Each Trade
        T->>C: After buy/sell
        C->>C: Check tokens_sold >= 800M?
        C->>C: Check sol_reserve >= $12k?
        
        alt Conditions Not Met
            C->>T: Continue trading
        else Both Conditions Met
            C->>BC: Set is_graduated = true
            BC->>BC: Emit CurveGraduated event
            BC->>BC: Block new trades
            Note over BC: 🎓 GRADUATED
        end
    end
    
    Note over T,D: Post-Graduation
    
    Cr->>BC: Call withdraw_liquidity()
    BC->>BC: Verify creator authority
    BC->>BC: Verify is_graduated = true
    
    BC->>V: Sign with vault PDA seeds
    V->>Cr: Transfer ~$12,000 SOL
    
    BC->>TA: Sign with curve PDA seeds
    TA->>Cr: Transfer 200M tokens
    
    Note over Cr: Creator has SOL + Tokens
    
    Cr->>D: create_pool(SOL, tokens)
    D->>D: Initialize pool
    D->>D: Add liquidity
    D->>Cr: Mint LP tokens
    
    Note over D: 🎉 Now Trading on DEX
```

### Graduation Checklist

```mermaid
graph TB
    Start([Start Trading])
    
    Start --> Trade[Execute Trade]
    Trade --> Check1{Tokens Sold<br/>>= 800M?}
    
    Check1 -->|No| Trade
    Check1 -->|Yes| Check2{SOL Raised<br/>>= $12k?}
    
    Check2 -->|No| Trade
    Check2 -->|Yes| Graduate[Set is_graduated = true]
    
    Graduate --> Event[Emit CurveGraduated Event]
    Event --> Block[Block New Trades]
    
    Block --> Wait[Wait for Creator]
    Wait --> Withdraw{Creator Calls<br/>withdraw_liquidity()}
    
    Withdraw -->|No| Wait
    Withdraw -->|Yes| Auth{Verify Creator}
    
    Auth -->|Invalid| Error[❌ Unauthorized]
    Auth -->|Valid| Transfer1[Transfer SOL]
    
    Transfer1 --> Transfer2[Transfer Tokens]
    Transfer2 --> LP[Create DEX Pool]
    LP --> Complete([✅ Complete])
    
    style Start fill:#e3f2fd
    style Graduate fill:#fff9c4
    style Block fill:#ffccbc
    style LP fill:#c8e6c9
    style Complete fill:#a5d6a7
    style Error fill:#ffcdd2
```

---

## Account States

```mermaid
stateDiagram-v2
    [*] --> Uninitialized: Program Deployed
    
    Uninitialized --> ConfigInitialized: initialize_launchpad()
    
    note right of ConfigInitialized
        LaunchpadConfig created
        Authority set
        Fee recipient set
    end note
    
    ConfigInitialized --> TokenCreated: create_token_launch()
    
    note right of TokenCreated
        Mint created (1B tokens)
        TokenLaunch created
        BondingCurve created
        200M tokens to curve
        SOL Vault created
    end note
    
    TokenCreated --> Active: is_active = true
    TokenCreated --> Paused: is_active = false
    
    Paused --> Active: toggle_token_launch_active()
    Active --> Paused: toggle_token_launch_active()
    
    Active --> Trading: buy_tokens() / sell_tokens()
    
    note right of Trading
        Tokens: 0 to 800M sold
        Price increases
        SOL accumulates in vault
        Fees to recipient
    end note
    
    Trading --> Trading: More trades
    Trading --> CheckGraduation: After each trade
    
    CheckGraduation --> Trading: Not graduated
    CheckGraduation --> Graduated: 800M sold + $12k raised
    
    note right of Graduated
        is_graduated = true
        Trading blocked
        Withdrawal enabled
    end note
    
    Graduated --> LiquidityWithdrawn: withdraw_liquidity()
    
    note right of LiquidityWithdrawn
        SOL transferred to creator
        Tokens transferred to creator
        Ready for DEX pool
    end note
    
    LiquidityWithdrawn --> DEXPool: Creator creates pool
    
    note right of DEXPool
        LP created
        Token trading on DEX
        Launchpad complete
    end note
    
    DEXPool --> [*]: Mission Complete 🎉
```

---

## Event Flow

```mermaid
sequenceDiagram
    participant U as User/Creator
    participant P as Program
    participant L as Event Listeners
    participant UI as Frontend
    participant DB as Database
    
    Note over U,DB: Initialization
    U->>P: initialize_launchpad()
    P->>L: Emit LaunchpadInitialized
    L->>DB: Store config
    L->>UI: Update UI
    
    Note over U,DB: Token Creation
    U->>P: create_token_launch()
    P->>L: Emit TokenLaunchCreated
    L->>DB: Store token data
    L->>UI: Show new token
    
    Note over U,DB: Trading
    U->>P: buy_tokens()
    P->>L: Emit TokensPurchased
    P->>L: Emit UserPositionUpdated
    L->>DB: Update balances
    L->>UI: Update portfolio
    
    U->>P: sell_tokens()
    P->>L: Emit TokensSold
    P->>L: Emit UserPositionUpdated
    L->>DB: Update balances
    L->>UI: Update portfolio
    
    Note over U,DB: Graduation
    P->>P: Check graduation
    P->>L: Emit CurveGraduated
    L->>DB: Mark as graduated
    L->>UI: Show graduation badge
    
    Note over U,DB: Management
    U->>P: toggle_token_launch_active()
    P->>L: Emit LaunchStatusToggled
    L->>DB: Update status
    L->>UI: Update badge
    
    U->>P: update_metadata_uri()
    P->>L: Emit MetadataUpdated
    L->>DB: Update metadata
    L->>UI: Refresh display
    
    Note over U,DB: Queries
    U->>P: get_buy_quote()
    P->>L: Emit PriceQuoteRequested
    L->>UI: Show price estimate
```

### Event Types

```mermaid
graph TB
    subgraph "Platform Events"
        E1[LaunchpadInitialized<br/>Authority, Fee Recipient, Fee BPS]
    end
    
    subgraph "Token Events"
        E2[TokenLaunchCreated<br/>Creator, Mint, Metadata]
        E3[LaunchStatusToggled<br/>Is Active]
        E4[MetadataUpdated<br/>New URI]
    end
    
    subgraph "Trading Events"
        E5[TokensPurchased<br/>Buyer, Amount, Cost, Fee]
        E6[TokensSold<br/>Seller, Amount, Proceeds, Fee]
        E7[UserPositionUpdated<br/>User, Holdings, Stats]
    end
    
    subgraph "Price Events"
        E8[PriceQuoteRequested<br/>Amount, Estimated Cost]
    end
    
    subgraph "Graduation Events"
        E9[CurveGraduated<br/>Final Stats, Timestamp]
    end
    
    subgraph "Listeners"
        L1[Frontend WebSocket]
        L2[Backend Indexer]
        L3[Analytics Service]
        L4[Notification Service]
    end
    
    E1 --> L1
    E2 --> L1
    E3 --> L1
    E4 --> L1
    E5 --> L1
    E6 --> L1
    E7 --> L1
    E8 --> L1
    E9 --> L1
    
    E1 --> L2
    E2 --> L2
    E5 --> L2
    E6 --> L2
    E7 --> L2
    E9 --> L2
    
    E5 --> L3
    E6 --> L3
    E9 --> L3
    
    E9 --> L4
    
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

---

## Data Flow Summary

```mermaid
graph TB
    subgraph "User Actions"
        UA1[Create Token]
        UA2[Buy Tokens]
        UA3[Sell Tokens]
        UA4[Manage Token]
    end
    
    subgraph "Program Processing"
        PP1[Validate Inputs]
        PP2[Check Authorization]
        PP3[Execute Logic]
        PP4[Update State]
        PP5[Emit Events]
    end
    
    subgraph "State Changes"
        SC1[BondingCurve State]
        SC2[User Positions]
        SC3[Token Accounts]
        SC4[SOL Vault]
    end
    
    subgraph "External Systems"
        EX1[Frontend Updates]
        EX2[Database Indexing]
        EX3[Analytics]
        EX4[Notifications]
    end
    
    UA1 --> PP1
    UA2 --> PP1
    UA3 --> PP1
    UA4 --> PP1
    
    PP1 --> PP2
    PP2 --> PP3
    PP3 --> PP4
    PP4 --> PP5
    
    PP4 --> SC1
    PP4 --> SC2
    PP4 --> SC3
    PP4 --> SC4
    
    PP5 --> EX1
    PP5 --> EX2
    PP5 --> EX3
    PP5 --> EX4
    
    style UA1 fill:#e3f2fd
    style UA2 fill:#e3f2fd
    style UA3 fill:#e3f2fd
    style UA4 fill:#e3f2fd
    style SC1 fill:#e8f5e9
    style SC2 fill:#e8f5e9
    style SC3 fill:#e8f5e9
    style SC4 fill:#e8f5e9
    style EX1 fill:#fff9c4
    style EX2 fill:#fff9c4
    style EX3 fill:#fff9c4
    style EX4 fill:#fff9c4
```

---

## Integration Patterns

### Frontend Integration

```mermaid
graph LR
    subgraph "User Interface"
        UI1[Token List]
        UI2[Trading Interface]
        UI3[Portfolio View]
        UI4[Creator Dashboard]
    end
    
    subgraph "State Management"
        SM1[Web3 Connection]
        SM2[Account Subscriptions]
        SM3[Event Listeners]
        SM4[Local Cache]
    end
    
    subgraph "Solana Program"
        SP1[Read Accounts]
        SP2[Execute Transactions]
        SP3[Emit Events]
    end
    
    UI1 --> SM1
    UI2 --> SM1
    UI3 --> SM2
    UI4 --> SM2
    
    SM1 --> SP1
    SM2 --> SP1
    SM2 --> SP2
    SM3 --> SP3
    
    SP1 --> SM4
    SP2 --> SM3
    SP3 --> SM4
    
    SM4 --> UI1
    SM4 --> UI2
    SM4 --> UI3
    SM4 --> UI4
    
    style UI1 fill:#e3f2fd
    style UI2 fill:#e3f2fd
    style UI3 fill:#e3f2fd
    style UI4 fill:#e3f2fd
    style SM4 fill:#fff9c4
    style SP3 fill:#e8f5e9
```

---

## Performance Metrics

```mermaid
graph TB
    subgraph "Compute Units"
        CU1[initialize_launchpad<br/>~50,000 CU]
        CU2[create_token_launch<br/>~150,000 CU]
        CU3[buy_tokens<br/>~80,000 CU]
        CU4[sell_tokens<br/>~60,000 CU]
        CU5[withdraw_liquidity<br/>~100,000 CU]
    end
    
    subgraph "Account Sizes"
        AS1[LaunchpadConfig<br/>~100 bytes]
        AS2[TokenLaunch<br/>~200 bytes]
        AS3[BondingCurve<br/>~150 bytes]
        AS4[UserPosition<br/>~100 bytes]
    end
    
    subgraph "Rent Costs"
        RC1[Config<br/>~0.0007 SOL]
        RC2[Token Launch<br/>~0.0014 SOL]
        RC3[Bonding Curve<br/>~0.001 SOL]
        RC4[User Position<br/>~0.0007 SOL]
    end
    
    style CU3 fill:#e8f5e9
    style CU4 fill:#e8f5e9
    style AS4 fill:#fff9c4
    style RC4 fill:#ffe0b2
```

---

**For more detailed documentation, see:**
- [README.md](./README.md) - Complete project overview
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [EVENT_DOCUMENTATION.md](./EVENT_DOCUMENTATION.md) - Event details
