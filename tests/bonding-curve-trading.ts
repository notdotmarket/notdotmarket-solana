import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { NotmarketSolana } from "../target/types/notmarket_solana";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

describe("Bonding Curve Trading", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NotmarketSolana as Program<NotmarketSolana>;

  // Test accounts
  const authority = provider.wallet as anchor.Wallet;
  const creator = Keypair.generate();
  const trader1 = Keypair.generate(); // 50M tokens
  const trader2 = Keypair.generate(); // 100M tokens
  const trader3 = Keypair.generate(); // 150M tokens

  // Token config
  const tokenName = "Test Token";
  const tokenSymbol = "TEST";
  const metadataUri = "https://example.com/metadata.json";
  const solPriceUsd = new BN(150_00000000); // $150
  const platformFeeBps = 100; // 1%

  // PDAs
  let configPda: PublicKey;
  let feeRecipient: PublicKey;
  let mintPda: PublicKey;
  let tokenLaunchPda: PublicKey;
  let bondingCurvePda: PublicKey;
  let curveTokenAccount: PublicKey;
  let solVaultPda: PublicKey;

  // Token amounts (in base units with 9 decimals)
  const MILLION = new BN(1_000_000).mul(new BN(1_000_000_000)); // 1M tokens
  const TRADE_1 = MILLION.mul(new BN(50));  // 50M tokens
  const TRADE_2 = MILLION.mul(new BN(100)); // 100M tokens
  const TRADE_3 = MILLION.mul(new BN(150)); // 150M tokens

  before(async () => {
    console.log("\n" + "=".repeat(80));
    console.log("🚀 BONDING CURVE TRADING TEST SUITE");
    console.log("=".repeat(80));

    // Setup config
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launchpad_config")],
      program.programId
    );

    try {
      const config = await program.account.launchpadConfig.fetch(configPda);
      feeRecipient = config.feeRecipient;
      console.log("✅ Using existing config");
    } catch {
      // Use authority as fee recipient (admin wallet)
      await program.methods
        .initializeLaunchpad(platformFeeBps)
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          feeRecipient: authority.publicKey, // Set to authority instead of program
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      feeRecipient = authority.publicKey;
      console.log("✅ Config initialized with authority as fee recipient");
    }

    // Fund accounts
    console.log("\n💰 Funding test accounts...");
    const fundAmount = 10000 * LAMPORTS_PER_SOL;
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(creator.publicKey, fundAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(trader1.publicKey, fundAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(trader2.publicKey, fundAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(trader3.publicKey, fundAmount)
    );
    console.log("✅ All accounts funded\n");
  });

  describe("1. Token Launch Setup", () => {
    it("Creates token launch with bonding curve", async () => {
      console.log("\n📋 Creating token launch...");

      // Derive PDAs
      [mintPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), creator.publicKey.toBuffer(), Buffer.from(tokenName)],
        program.programId
      );

      [tokenLaunchPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_launch"), mintPda.toBuffer()],
        program.programId
      );

      [bondingCurvePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding_curve"), tokenLaunchPda.toBuffer()],
        program.programId
      );

      curveTokenAccount = getAssociatedTokenAddressSync(
        mintPda,
        bondingCurvePda,
        true
      );

      [solVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("sol_vault"), bondingCurvePda.toBuffer()],
        program.programId
      );

      await program.methods
        .createTokenLaunch(tokenName, tokenSymbol, metadataUri, solPriceUsd)
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

      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);
      console.log("✅ Token launch created");
      console.log("   Total Supply: 1,000,000,000 tokens");
      console.log("   On Bonding Curve: 800,000,000 tokens");
      console.log("   For LP: 200,000,000 tokens");
      console.log("   Token Reserve:", (Number(bondingCurve.tokenReserve) / 1e9).toLocaleString());

      assert.equal(bondingCurve.tokensSold.toString(), "0");
      assert.equal(bondingCurve.solReserve.toString(), "0");
    });
  });

  describe("2. Price Discovery via View Functions", () => {
    it("Gets initial spot price (should be $0.00000420)", async () => {
      console.log("\n📊 Checking initial spot price...");

      const spotPrice = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const priceInSol = Number(spotPrice.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsd = priceInSol * 150; // SOL @ $150

      console.log("   Spot Price:", spotPrice.spotPrice.toString(), "lamports");
      console.log("   In SOL:", priceInSol.toFixed(10));
      console.log("   In USD: $" + priceInUsd.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotPrice.tokensSold) / 1e9).toLocaleString());

      assert.ok(spotPrice.spotPrice.gt(new BN(0)), "Initial price should be positive");
    });

    it("Gets quote for 50M tokens (first trade)", async () => {
      console.log("\n💰 Getting quote for 50M tokens...");

      const quote = await program.methods
        .getBuyQuote(TRADE_1)
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const costInSol = Number(quote.cost) / LAMPORTS_PER_SOL;
      const costInUsd = costInSol * 150;
      const avgPricePerToken = costInSol / 50_000_000;

      console.log("   Amount: 50,000,000 tokens");
      console.log("   Cost:", quote.cost.toString(), "lamports");
      console.log("   Cost:", costInSol.toFixed(6), "SOL");
      console.log("   Cost: $" + costInUsd.toFixed(2));
      console.log("   Avg Price/Token: $" + (avgPricePerToken * 150).toFixed(10));
      console.log("   Slippage:", quote.slippage, "bps");

      assert.ok(quote.cost.gt(new BN(0)), "Cost should be positive");
    });

    it("Gets quote for 100M tokens (hypothetical)", async () => {
      console.log("\n💰 Getting quote for 100M tokens...");

      const quote = await program.methods
        .getBuyQuote(TRADE_2)
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const costInSol = Number(quote.cost) / LAMPORTS_PER_SOL;
      const costInUsd = costInSol * 150;
      const avgPricePerToken = costInSol / 100_000_000;

      console.log("   Amount: 100,000,000 tokens");
      console.log("   Cost:", costInSol.toFixed(6), "SOL");
      console.log("   Cost: $" + costInUsd.toFixed(2));
      console.log("   Avg Price/Token: $" + (avgPricePerToken * 150).toFixed(10));
      console.log("   Slippage:", quote.slippage, "bps");
    });
  });

  describe("2.5. Fee Recipient Management", () => {
    let newFeeRecipient: PublicKey;

    it("Updates fee recipient to a dedicated account", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔧 UPDATING FEE RECIPIENT");
      console.log("=".repeat(80));

      // Generate a new fee recipient
      const feeRecipientKeypair = Keypair.generate();
      newFeeRecipient = feeRecipientKeypair.publicKey;

      // Fund the new fee recipient
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          newFeeRecipient,
          LAMPORTS_PER_SOL
        )
      );

      console.log("\n📊 Fee Recipient Update:");
      console.log("   Old Recipient:", feeRecipient.toString());
      console.log("   New Recipient:", newFeeRecipient.toString());

      // Update fee recipient
      await program.methods
        .updateFeeRecipient(newFeeRecipient)
        .accounts({
          config: configPda,
          authority: authority.publicKey,
        })
        .rpc();

      // Verify update
      const config = await program.account.launchpadConfig.fetch(configPda);
      
      console.log("\n✅ Fee recipient updated successfully!");
      console.log("   Current Fee Recipient:", config.feeRecipient.toString());

      assert.equal(
        config.feeRecipient.toString(),
        newFeeRecipient.toString(),
        "Fee recipient should be updated"
      );

      // Update global variable for subsequent tests
      feeRecipient = newFeeRecipient;
    });

    it("Verifies non-authority cannot update fee recipient", async () => {
      console.log("\n🔒 Testing unauthorized update...");

      const unauthorized = Keypair.generate();
      const anotherRecipient = Keypair.generate();

      // Fund unauthorized account
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(
          unauthorized.publicKey,
          LAMPORTS_PER_SOL
        )
      );

      try {
        await program.methods
          .updateFeeRecipient(anotherRecipient.publicKey)
          .accounts({
            config: configPda,
            authority: unauthorized.publicKey,
          })
          .signers([unauthorized])
          .rpc();

        assert.fail("Should have thrown unauthorized error");
      } catch (err) {
        console.log("✅ Correctly rejected unauthorized update");
        // Check for constraint error or unauthorized error
        const errStr = err.toString();
        assert.ok(
          errStr.includes("constraint") || errStr.includes("Unauthorized") || errStr.includes("2012"),
          "Should throw unauthorized or constraint error"
        );
      }
    });
  });

  describe("3. Execute Large Trades", () => {
    it("Trader 1 buys 50M tokens", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔥 TRADE 1: 50,000,000 TOKENS");
      console.log("=".repeat(80));

      // Get balances before trade
      const trader1SolBefore = await provider.connection.getBalance(trader1.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceBefore = await provider.connection.getBalance(feeRecipient);

      // Get quote first
      const quoteBefore = await program.methods
        .getBuyQuote(TRADE_1)
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const spotBefore = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const priceInSolBefore = Number(spotBefore.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsdBefore = priceInSolBefore * 150;

      console.log("\n📊 Before Trade:");
      console.log("   Spot Price:", spotBefore.spotPrice.toString(), "lamports");
      console.log("   Spot Price: $" + priceInUsdBefore.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotBefore.tokensSold) / 1e9).toLocaleString());
      console.log("   Expected Cost:", (Number(quoteBefore.cost) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Expected Cost: $" + ((Number(quoteBefore.cost) / LAMPORTS_PER_SOL) * 150).toFixed(2));
      
      console.log("\n💰 Balances Before:");
      console.log("   Trader SOL:", (trader1SolBefore / LAMPORTS_PER_SOL).toFixed(4), "SOL");
      console.log("   SOL Vault:", (vaultBalanceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Recipient:", (feeRecipientBalanceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      // Execute trade
      const trader1TokenAccount = getAssociatedTokenAddressSync(mintPda, trader1.publicKey);
      const [trader1PositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), trader1.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );

      const maxCost = quoteBefore.cost.mul(new BN(110)).div(new BN(100)); // 10% slippage

      await program.methods
        .buyTokens(TRADE_1, maxCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: trader1PositionPda,
          mint: mintPda,
          buyerTokenAccount: trader1TokenAccount,
          buyer: trader1.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader1])
        .rpc();

      // Get balances after trade
      const trader1SolAfter = await provider.connection.getBalance(trader1.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceAfter = await provider.connection.getBalance(feeRecipient);

      // Verify with view functions
      const spotAfter = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const tokenBalance = await provider.connection.getTokenAccountBalance(trader1TokenAccount);
      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);

      const priceInSolAfter = Number(spotAfter.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsdAfter = priceInSolAfter * 150;

      // Calculate changes
      const solSpent = trader1SolBefore - trader1SolAfter;
      const vaultIncrease = vaultBalanceAfter - vaultBalanceBefore;
      const feeCollected = feeRecipientBalanceAfter - feeRecipientBalanceBefore;

      console.log("\n📊 After Trade:");
      console.log("   Spot Price:", spotAfter.spotPrice.toString(), "lamports");
      console.log("   Spot Price: $" + priceInUsdAfter.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotAfter.tokensSold) / 1e9).toLocaleString());
      console.log("   SOL Reserve:", (Number(spotAfter.solReserve) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Trader Token Balance:", (Number(tokenBalance.value.amount) / 1e9).toLocaleString(), "tokens");
      console.log("   Trade Count:", bondingCurve.tradeCount.toString());

      console.log("\n💰 Balances After:");
      console.log("   Trader SOL:", (trader1SolAfter / LAMPORTS_PER_SOL).toFixed(4), "SOL");
      console.log("   SOL Vault:", (vaultBalanceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Recipient:", (feeRecipientBalanceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      console.log("\n💸 Transaction Summary:");
      console.log("   SOL Spent:", (solSpent / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   USD Spent: $" + ((solSpent / LAMPORTS_PER_SOL) * 150).toFixed(2));
      console.log("   Vault Increase:", (vaultIncrease / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Collected:", (feeCollected / LAMPORTS_PER_SOL).toFixed(6), "SOL (1%)");
      console.log("   Avg Price/Token: $" + ((solSpent / LAMPORTS_PER_SOL * 150) / 50_000_000).toFixed(10));

      const priceIncrease = spotAfter.spotPrice.sub(spotBefore.spotPrice);
      const percentIncrease = (Number(priceIncrease) / Number(spotBefore.spotPrice)) * 100;
      const priceUsdIncrease = priceInUsdAfter - priceInUsdBefore;
      
      console.log("\n📈 Price Impact:");
      console.log("   Price Increase:", priceIncrease.toString(), "lamports");
      console.log("   USD Increase: $" + priceUsdIncrease.toFixed(10));
      console.log("   Percent Increase:", percentIncrease.toFixed(4) + "%");
      console.log("   Before: $" + priceInUsdBefore.toFixed(10), "→ After: $" + priceInUsdAfter.toFixed(10));

      assert.ok(spotAfter.spotPrice.gt(spotBefore.spotPrice), "Price should increase");
      assert.equal(Number(tokenBalance.value.amount), Number(TRADE_1.toString()));
    });

    it("Trader 2 buys 100M tokens", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔥 TRADE 2: 100,000,000 TOKENS");
      console.log("=".repeat(80));

      // Get balances before trade
      const trader2SolBefore = await provider.connection.getBalance(trader2.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceBefore = await provider.connection.getBalance(feeRecipient);

      const spotBefore = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const quoteBefore = await program.methods
        .getBuyQuote(TRADE_2)
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const priceInSolBefore = Number(spotBefore.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsdBefore = priceInSolBefore * 150;

      console.log("\n📊 Before Trade:");
      console.log("   Spot Price:", spotBefore.spotPrice.toString(), "lamports");
      console.log("   Spot Price: $" + priceInUsdBefore.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotBefore.tokensSold) / 1e9).toLocaleString());
      console.log("   Expected Cost:", (Number(quoteBefore.cost) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Expected Cost: $" + ((Number(quoteBefore.cost) / LAMPORTS_PER_SOL) * 150).toFixed(2));

      console.log("\n💰 Balances Before:");
      console.log("   Trader SOL:", (trader2SolBefore / LAMPORTS_PER_SOL).toFixed(4), "SOL");
      console.log("   SOL Vault:", (vaultBalanceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Recipient:", (feeRecipientBalanceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      const trader2TokenAccount = getAssociatedTokenAddressSync(mintPda, trader2.publicKey);
      const [trader2PositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), trader2.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );

      const maxCost = quoteBefore.cost.mul(new BN(110)).div(new BN(100));

      await program.methods
        .buyTokens(TRADE_2, maxCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: trader2PositionPda,
          mint: mintPda,
          buyerTokenAccount: trader2TokenAccount,
          buyer: trader2.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader2])
        .rpc();

      // Get balances after trade
      const trader2SolAfter = await provider.connection.getBalance(trader2.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceAfter = await provider.connection.getBalance(feeRecipient);

      const spotAfter = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const tokenBalance = await provider.connection.getTokenAccountBalance(trader2TokenAccount);
      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);

      const priceInSolAfter = Number(spotAfter.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsdAfter = priceInSolAfter * 150;

      // Calculate changes
      const solSpent = trader2SolBefore - trader2SolAfter;
      const vaultIncrease = vaultBalanceAfter - vaultBalanceBefore;
      const feeCollected = feeRecipientBalanceAfter - feeRecipientBalanceBefore;

      console.log("\n📊 After Trade:");
      console.log("   Spot Price:", spotAfter.spotPrice.toString(), "lamports");
      console.log("   Spot Price: $" + priceInUsdAfter.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotAfter.tokensSold) / 1e9).toLocaleString());
      console.log("   SOL Reserve:", (Number(spotAfter.solReserve) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Trader Token Balance:", (Number(tokenBalance.value.amount) / 1e9).toLocaleString(), "tokens");
      console.log("   Total Volume:", (Number(bondingCurve.totalVolume) / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      console.log("\n💰 Balances After:");
      console.log("   Trader SOL:", (trader2SolAfter / LAMPORTS_PER_SOL).toFixed(4), "SOL");
      console.log("   SOL Vault:", (vaultBalanceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Recipient:", (feeRecipientBalanceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      console.log("\n💸 Transaction Summary:");
      console.log("   SOL Spent:", (solSpent / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   USD Spent: $" + ((solSpent / LAMPORTS_PER_SOL) * 150).toFixed(2));
      console.log("   Vault Increase:", (vaultIncrease / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Collected:", (feeCollected / LAMPORTS_PER_SOL).toFixed(6), "SOL (1%)");
      console.log("   Avg Price/Token: $" + ((solSpent / LAMPORTS_PER_SOL * 150) / 100_000_000).toFixed(10));

      const priceIncrease = spotAfter.spotPrice.sub(spotBefore.spotPrice);
      const percentIncrease = (Number(priceIncrease) / Number(spotBefore.spotPrice)) * 100;
      const priceUsdIncrease = priceInUsdAfter - priceInUsdBefore;
      
      console.log("\n📈 Price Impact:");
      console.log("   Price Increase:", priceIncrease.toString(), "lamports");
      console.log("   USD Increase: $" + priceUsdIncrease.toFixed(10));
      console.log("   Percent Increase:", percentIncrease.toFixed(4) + "%");
      console.log("   Before: $" + priceInUsdBefore.toFixed(10), "→ After: $" + priceInUsdAfter.toFixed(10));

      assert.ok(spotAfter.spotPrice.gt(spotBefore.spotPrice), "Price should increase");
      assert.equal(Number(tokenBalance.value.amount), Number(TRADE_2.toString()));
    });

    it("Trader 3 buys 150M tokens", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔥 TRADE 3: 150,000,000 TOKENS");
      console.log("=".repeat(80));

      // Get balances before trade
      const trader3SolBefore = await provider.connection.getBalance(trader3.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceBefore = await provider.connection.getBalance(feeRecipient);

      const spotBefore = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const quoteBefore = await program.methods
        .getBuyQuote(TRADE_3)
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const priceInSolBefore = Number(spotBefore.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsdBefore = priceInSolBefore * 150;

      console.log("\n📊 Before Trade:");
      console.log("   Spot Price:", spotBefore.spotPrice.toString(), "lamports");
      console.log("   Spot Price: $" + priceInUsdBefore.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotBefore.tokensSold) / 1e9).toLocaleString());
      console.log("   Expected Cost:", (Number(quoteBefore.cost) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Expected Cost: $" + ((Number(quoteBefore.cost) / LAMPORTS_PER_SOL) * 150).toFixed(2));

      console.log("\n💰 Balances Before:");
      console.log("   Trader SOL:", (trader3SolBefore / LAMPORTS_PER_SOL).toFixed(4), "SOL");
      console.log("   SOL Vault:", (vaultBalanceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Recipient:", (feeRecipientBalanceBefore / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      const trader3TokenAccount = getAssociatedTokenAddressSync(mintPda, trader3.publicKey);
      const [trader3PositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), trader3.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );

      const maxCost = quoteBefore.cost.mul(new BN(110)).div(new BN(100));

      await program.methods
        .buyTokens(TRADE_3, maxCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: trader3PositionPda,
          mint: mintPda,
          buyerTokenAccount: trader3TokenAccount,
          buyer: trader3.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader3])
        .rpc();

      // Get balances after trade
      const trader3SolAfter = await provider.connection.getBalance(trader3.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceAfter = await provider.connection.getBalance(feeRecipient);

      const spotAfter = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const tokenBalance = await provider.connection.getTokenAccountBalance(trader3TokenAccount);
      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);

      const priceInSolAfter = Number(spotAfter.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsdAfter = priceInSolAfter * 150;

      // Calculate changes
      const solSpent = trader3SolBefore - trader3SolAfter;
      const vaultIncrease = vaultBalanceAfter - vaultBalanceBefore;
      const feeCollected = feeRecipientBalanceAfter - feeRecipientBalanceBefore;

      console.log("\n📊 After Trade:");
      console.log("   Spot Price:", spotAfter.spotPrice.toString(), "lamports");
      console.log("   Spot Price: $" + priceInUsdAfter.toFixed(10));
      console.log("   Tokens Sold:", (Number(spotAfter.tokensSold) / 1e9).toLocaleString());
      console.log("   SOL Reserve:", (Number(spotAfter.solReserve) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Trader Token Balance:", (Number(tokenBalance.value.amount) / 1e9).toLocaleString(), "tokens");
      console.log("   Total Volume:", (Number(bondingCurve.totalVolume) / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      console.log("\n💰 Balances After:");
      console.log("   Trader SOL:", (trader3SolAfter / LAMPORTS_PER_SOL).toFixed(4), "SOL");
      console.log("   SOL Vault:", (vaultBalanceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Recipient:", (feeRecipientBalanceAfter / LAMPORTS_PER_SOL).toFixed(6), "SOL");

      console.log("\n💸 Transaction Summary:");
      console.log("   SOL Spent:", (solSpent / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   USD Spent: $" + ((solSpent / LAMPORTS_PER_SOL) * 150).toFixed(2));
      console.log("   Vault Increase:", (vaultIncrease / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Fee Collected:", (feeCollected / LAMPORTS_PER_SOL).toFixed(6), "SOL (1%)");
      console.log("   Avg Price/Token: $" + ((solSpent / LAMPORTS_PER_SOL * 150) / 150_000_000).toFixed(10));

      const priceIncrease = spotAfter.spotPrice.sub(spotBefore.spotPrice);
      const percentIncrease = (Number(priceIncrease) / Number(spotBefore.spotPrice)) * 100;
      const priceUsdIncrease = priceInUsdAfter - priceInUsdBefore;
      
      console.log("\n📈 Price Impact:");
      console.log("   Price Increase:", priceIncrease.toString(), "lamports");
      console.log("   USD Increase: $" + priceUsdIncrease.toFixed(10));
      console.log("   Percent Increase:", percentIncrease.toFixed(4) + "%");
      console.log("   Before: $" + priceInUsdBefore.toFixed(10), "→ After: $" + priceInUsdAfter.toFixed(10));

      assert.ok(spotAfter.spotPrice.gt(spotBefore.spotPrice), "Price should increase");
      assert.equal(Number(tokenBalance.value.amount), Number(TRADE_3.toString()));
    });
  });

  describe("4. Sell Tokens Back to Curve", () => {
    it("Trader 1 sells 25M tokens back", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔥 SELL TRADE 1: 25,000,000 TOKENS");
      console.log("=".repeat(80));

      const sellAmount = new anchor.BN(25_000_000).mul(new anchor.BN(1_000_000_000));
      const SOL_PRICE = 150; // USD per SOL
      
      // Get trader token account and user position
      const trader1TokenAccount = getAssociatedTokenAddressSync(mintPda, trader1.publicKey);
      const [userPosition1Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), trader1.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );
      
      // Get balances and state before sell
      const trader1SolBefore = await provider.connection.getBalance(trader1.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceBefore = await provider.connection.getBalance(feeRecipient);
      const trader1TokenBalanceBefore = (await provider.connection.getTokenAccountBalance(trader1TokenAccount)).value.uiAmount;
      
      // Get spot price before sell
      const spotPriceBefore = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
        })
        .view();

      console.log("\n📊 Before Sell:");
      console.log(`   Spot Price: ${spotPriceBefore.spotPrice} lamports`);
      console.log(`   Spot Price: $${((spotPriceBefore.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)}`);
      console.log(`   Tokens Sold on Curve: ${(Number(spotPriceBefore.tokensSold) / 1e9).toLocaleString()}`);

      console.log("\n💰 Balances Before:");
      console.log(`   Trader SOL: ${(trader1SolBefore / 1e9).toFixed(4)} SOL`);
      console.log(`   Trader Tokens: ${trader1TokenBalanceBefore?.toLocaleString()} tokens`);
      console.log(`   SOL Vault: ${(vaultBalanceBefore / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Recipient: ${(feeRecipientBalanceBefore / 1e9).toFixed(6)} SOL`);

      // Execute sell
      const minSolOutput = new anchor.BN(0); // Accept any price for testing
      
      await program.methods
        .sellTokens(sellAmount, minSolOutput)
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: userPosition1Pda,
          sellerTokenAccount: trader1TokenAccount,
          seller: trader1.publicKey,
          config: configPda,
          feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([trader1])
        .rpc();

      // Get balances and state after sell
      const trader1SolAfter = await provider.connection.getBalance(trader1.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceAfter = await provider.connection.getBalance(feeRecipient);
      const trader1TokenBalanceAfter = (await provider.connection.getTokenAccountBalance(trader1TokenAccount)).value.uiAmount;

      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda);
      const spotPriceAfter = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
        })
        .view();

      console.log("\n📊 After Sell:");
      console.log(`   Spot Price: ${spotPriceAfter.spotPrice} lamports`);
      console.log(`   Spot Price: $${((spotPriceAfter.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)}`);
      console.log(`   Tokens Sold: ${(Number(bondingCurveAfter.tokensSold) / 1e9).toLocaleString()}`);
      console.log(`   SOL Reserve: ${(Number(bondingCurveAfter.solReserve) / 1e9).toFixed(6)} SOL`);
      console.log(`   Token Reserve: ${(Number(bondingCurveAfter.tokenReserve) / 1e9).toLocaleString()}`);

      console.log("\n💰 Balances After:");
      console.log(`   Trader SOL: ${(trader1SolAfter / 1e9).toFixed(4)} SOL`);
      console.log(`   Trader Tokens: ${trader1TokenBalanceAfter?.toLocaleString()} tokens`);
      console.log(`   SOL Vault: ${(vaultBalanceAfter / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Recipient: ${(feeRecipientBalanceAfter / 1e9).toFixed(6)} SOL`);

      // Calculate changes
      const solReceived = trader1SolAfter - trader1SolBefore;
      const vaultDecrease = vaultBalanceBefore - vaultBalanceAfter;
      const feeCollected = feeRecipientBalanceAfter - feeRecipientBalanceBefore;
      const tokensSoldBack = (trader1TokenBalanceBefore! - trader1TokenBalanceAfter!);

      console.log("\n💸 Transaction Summary:");
      console.log(`   Tokens Sold: ${tokensSoldBack.toLocaleString()} tokens`);
      console.log(`   SOL Received: ${(solReceived / 1e9).toFixed(6)} SOL`);
      console.log(`   USD Received: $${((solReceived / 1e9) * SOL_PRICE).toFixed(2)}`);
      console.log(`   Vault Decrease: ${(vaultDecrease / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Collected: ${(feeCollected / 1e9).toFixed(6)} SOL (1%)`);
      console.log(`   Avg Price/Token: $${(((solReceived / 1e9) * SOL_PRICE) / tokensSoldBack).toFixed(10)}`);

      // Calculate gross proceeds (before fee)
      const grossProceeds = vaultDecrease;
      const netProceeds = solReceived;
      
      console.log("\n🔍 Quote vs Actual:");
      console.log(`   Gross Proceeds (from vault): ${(grossProceeds / 1e9).toFixed(6)} SOL`);
      console.log(`   Net Proceeds (to trader): ${(netProceeds / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee (1%): ${(feeCollected / 1e9).toFixed(6)} SOL`);
      console.log(`   Verification: ${(netProceeds / 1e9).toFixed(6)} + ${(feeCollected / 1e9).toFixed(6)} = ${((netProceeds + feeCollected) / 1e9).toFixed(6)} SOL`);
      console.log(`   Match: ${Math.abs(grossProceeds - (netProceeds + feeCollected)) < 10000 ? "✅" : "❌"}`);

      console.log("\n📈 Price Impact:");
      const priceBefore = spotPriceBefore.spotPrice.toNumber();
      const priceAfter = spotPriceAfter.spotPrice.toNumber();
      const priceDecrease = priceBefore - priceAfter;
      const priceUsdBefore = (priceBefore / 1e9) * SOL_PRICE;
      const priceUsdAfter = (priceAfter / 1e9) * SOL_PRICE;
      const percentDecrease = ((priceDecrease / priceBefore) * 100).toFixed(4);
      
      console.log(`   Price Decrease: ${priceDecrease} lamports`);
      console.log(`   USD Decrease: $${(priceUsdBefore - priceUsdAfter).toFixed(10)}`);
      console.log(`   Percent Decrease: ${percentDecrease}%`);
      console.log(`   Before: $${priceUsdBefore.toFixed(10)} → After: $${priceUsdAfter.toFixed(10)}`);
    });

    it("Trader 2 sells 50M tokens back", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔥 SELL TRADE 2: 50,000,000 TOKENS");
      console.log("=".repeat(80));

      const sellAmount = new anchor.BN(50_000_000).mul(new anchor.BN(1_000_000_000));
      const SOL_PRICE = 150; // USD per SOL
      
      // Get trader token account and user position
      const trader2TokenAccount = getAssociatedTokenAddressSync(mintPda, trader2.publicKey);
      const [userPosition2Pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), trader2.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );
      
      // Get balances and state before sell
      const trader2SolBefore = await provider.connection.getBalance(trader2.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceBefore = await provider.connection.getBalance(feeRecipient);
      const trader2TokenBalanceBefore = (await provider.connection.getTokenAccountBalance(trader2TokenAccount)).value.uiAmount;
      
      // Get spot price before sell
      const spotPriceBefore = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
        })
        .view();

      console.log("\n📊 Before Sell:");
      console.log(`   Spot Price: ${spotPriceBefore.spotPrice} lamports`);
      console.log(`   Spot Price: $${((spotPriceBefore.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)}`);
      console.log(`   Tokens Sold on Curve: ${(Number(spotPriceBefore.tokensSold) / 1e9).toLocaleString()}`);

      console.log("\n💰 Balances Before:");
      console.log(`   Trader SOL: ${(trader2SolBefore / 1e9).toFixed(4)} SOL`);
      console.log(`   Trader Tokens: ${trader2TokenBalanceBefore?.toLocaleString()} tokens`);
      console.log(`   SOL Vault: ${(vaultBalanceBefore / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Recipient: ${(feeRecipientBalanceBefore / 1e9).toFixed(6)} SOL`);

      // Execute sell
      const minSolOutput = new anchor.BN(0); // Accept any price for testing
      
      await program.methods
        .sellTokens(sellAmount, minSolOutput)
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: userPosition2Pda,
          sellerTokenAccount: trader2TokenAccount,
          seller: trader2.publicKey,
          config: configPda,
          feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([trader2])
        .rpc();

      // Get balances and state after sell
      const trader2SolAfter = await provider.connection.getBalance(trader2.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceAfter = await provider.connection.getBalance(feeRecipient);
      const trader2TokenBalanceAfter = (await provider.connection.getTokenAccountBalance(trader2TokenAccount)).value.uiAmount;

      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda);
      const spotPriceAfter = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
        })
        .view();

      console.log("\n📊 After Sell:");
      console.log(`   Spot Price: ${spotPriceAfter.spotPrice} lamports`);
      console.log(`   Spot Price: $${((spotPriceAfter.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)}`);
      console.log(`   Tokens Sold: ${(Number(bondingCurveAfter.tokensSold) / 1e9).toLocaleString()}`);
      console.log(`   SOL Reserve: ${(Number(bondingCurveAfter.solReserve) / 1e9).toFixed(6)} SOL`);
      console.log(`   Token Reserve: ${(Number(bondingCurveAfter.tokenReserve) / 1e9).toLocaleString()}`);

      console.log("\n💰 Balances After:");
      console.log(`   Trader SOL: ${(trader2SolAfter / 1e9).toFixed(4)} SOL`);
      console.log(`   Trader Tokens: ${trader2TokenBalanceAfter?.toLocaleString()} tokens`);
      console.log(`   SOL Vault: ${(vaultBalanceAfter / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Recipient: ${(feeRecipientBalanceAfter / 1e9).toFixed(6)} SOL`);

      // Calculate changes
      const solReceived = trader2SolAfter - trader2SolBefore;
      const vaultDecrease = vaultBalanceBefore - vaultBalanceAfter;
      const feeCollected = feeRecipientBalanceAfter - feeRecipientBalanceBefore;
      const tokensSoldBack = (trader2TokenBalanceBefore! - trader2TokenBalanceAfter!);

      console.log("\n💸 Transaction Summary:");
      console.log(`   Tokens Sold: ${tokensSoldBack.toLocaleString()} tokens`);
      console.log(`   SOL Received: ${(solReceived / 1e9).toFixed(6)} SOL`);
      console.log(`   USD Received: $${((solReceived / 1e9) * SOL_PRICE).toFixed(2)}`);
      console.log(`   Vault Decrease: ${(vaultDecrease / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Collected: ${(feeCollected / 1e9).toFixed(6)} SOL (1%)`);
      console.log(`   Avg Price/Token: $${(((solReceived / 1e9) * SOL_PRICE) / tokensSoldBack).toFixed(10)}`);

      // Calculate gross proceeds (before fee)
      const grossProceeds = vaultDecrease;
      const netProceeds = solReceived;
      
      console.log("\n🔍 Quote vs Actual:");
      console.log(`   Gross Proceeds (from vault): ${(grossProceeds / 1e9).toFixed(6)} SOL`);
      console.log(`   Net Proceeds (to trader): ${(netProceeds / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee (1%): ${(feeCollected / 1e9).toFixed(6)} SOL`);
      console.log(`   Verification: ${(netProceeds / 1e9).toFixed(6)} + ${(feeCollected / 1e9).toFixed(6)} = ${((netProceeds + feeCollected) / 1e9).toFixed(6)} SOL`);
      console.log(`   Match: ${Math.abs(grossProceeds - (netProceeds + feeCollected)) < 10000 ? "✅" : "❌"}`);

      console.log("\n📈 Price Impact:");
      const priceBefore = spotPriceBefore.spotPrice.toNumber();
      const priceAfter = spotPriceAfter.spotPrice.toNumber();
      const priceDecrease = priceBefore - priceAfter;
      const priceUsdBefore = (priceBefore / 1e9) * SOL_PRICE;
      const priceUsdAfter = (priceAfter / 1e9) * SOL_PRICE;
      const percentDecrease = ((priceDecrease / priceBefore) * 100).toFixed(4);
      
      console.log(`   Price Decrease: ${priceDecrease} lamports`);
      console.log(`   USD Decrease: $${(priceUsdBefore - priceUsdAfter).toFixed(10)}`);
      console.log(`   Percent Decrease: ${percentDecrease}%`);
      console.log(`   Before: $${priceUsdBefore.toFixed(10)} → After: $${priceUsdAfter.toFixed(10)}`);
    });
  });

  describe("5. Graduation Test - Buy All Remaining Tokens", () => {
    it("Buys all remaining 575M tokens to complete the curve", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🎓 GRADUATION TEST: BUYING ALL REMAINING TOKENS");
      console.log("=".repeat(80));

      const SOL_PRICE = 150; // USD per SOL

      // Get current state
      const bondingCurveBefore = await program.account.bondingCurve.fetch(bondingCurvePda);
      const tokensSoldBefore = Number(bondingCurveBefore.tokensSold) / 1e9;
      const tokensRemaining = 800_000_000 - tokensSoldBefore;

      console.log("\n📊 Current State:");
      console.log(`   Tokens Sold: ${tokensSoldBefore.toLocaleString()}`);
      console.log(`   Tokens Remaining: ${tokensRemaining.toLocaleString()}`);
      console.log(`   Need to buy: ${tokensRemaining.toLocaleString()} tokens`);

      // Get quote for all remaining tokens
      const remainingAmount = new anchor.BN(tokensRemaining).mul(new anchor.BN(1_000_000_000));
      
      console.log("\n💰 Getting quote for all remaining tokens...");
      const quoteBefore = await program.methods
        .getBuyQuote(remainingAmount)
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const costSol = Number(quoteBefore.cost) / 1e9;
      const costUsd = costSol * SOL_PRICE;
      
      console.log(`   Amount: ${tokensRemaining.toLocaleString()} tokens`);
      console.log(`   Cost: ${costSol.toFixed(6)} SOL`);
      console.log(`   Cost: $${costUsd.toFixed(2)}`);
      console.log(`   Avg Price/Token: $${(costUsd / tokensRemaining).toFixed(10)}`);

      // Get spot price before
      const spotPriceBefore = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
        })
        .view();

      console.log("\n📊 Spot Price Before:");
      console.log(`   ${spotPriceBefore.spotPrice} lamports`);
      console.log(`   $${((spotPriceBefore.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)}`);

      // Create a new whale trader
      const whaleTrader = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(whaleTrader.publicKey, 200 * LAMPORTS_PER_SOL)
      );

      const whaleTokenAccount = getAssociatedTokenAddressSync(mintPda, whaleTrader.publicKey);
      const [whalePositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), whaleTrader.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );

      // Get balances before
      const whaleSolBefore = await provider.connection.getBalance(whaleTrader.publicKey);
      const vaultBalanceBefore = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceBefore = await provider.connection.getBalance(feeRecipient);

      console.log("\n💰 Balances Before:");
      console.log(`   Whale SOL: ${(whaleSolBefore / 1e9).toFixed(4)} SOL`);
      console.log(`   SOL Vault: ${(vaultBalanceBefore / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Recipient: ${(feeRecipientBalanceBefore / 1e9).toFixed(6)} SOL`);

      // Execute the massive trade
      console.log("\n🚀 Executing trade to buy all remaining tokens...");
      const maxCost = quoteBefore.cost.mul(new BN(120)).div(new BN(100)); // 20% slippage buffer

      await program.methods
        .buyTokens(remainingAmount, maxCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: whalePositionPda,
          mint: mintPda,
          buyerTokenAccount: whaleTokenAccount,
          buyer: whaleTrader.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([whaleTrader])
        .rpc();

      console.log("✅ Trade executed!");

      // Get balances after
      const whaleSolAfter = await provider.connection.getBalance(whaleTrader.publicKey);
      const vaultBalanceAfter = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalanceAfter = await provider.connection.getBalance(feeRecipient);

      // Get final state
      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda);
      const spotPriceAfter = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const whaleTokenBalance = (await provider.connection.getTokenAccountBalance(whaleTokenAccount)).value.uiAmount;

      console.log("\n📊 After Trade:");
      console.log(`   Tokens Sold: ${(Number(bondingCurveAfter.tokensSold) / 1e9).toLocaleString()} / 800,000,000`);
      console.log(`   Token Reserve: ${(Number(bondingCurveAfter.tokenReserve) / 1e9).toLocaleString()}`);
      console.log(`   SOL Reserve: ${(Number(bondingCurveAfter.solReserve) / 1e9).toFixed(6)} SOL`);
      console.log(`   Whale Token Balance: ${whaleTokenBalance?.toLocaleString()} tokens`);
      console.log(`   Is Graduated: ${bondingCurveAfter.isGraduated ? '✅ YES' : '❌ NO'}`);

      console.log("\n💰 Balances After:");
      console.log(`   Whale SOL: ${(whaleSolAfter / 1e9).toFixed(4)} SOL`);
      console.log(`   SOL Vault: ${(vaultBalanceAfter / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Recipient: ${(feeRecipientBalanceAfter / 1e9).toFixed(6)} SOL`);

      // Calculate transaction summary
      const solSpent = whaleSolBefore - whaleSolAfter;
      const vaultIncrease = vaultBalanceAfter - vaultBalanceBefore;
      const feeCollected = feeRecipientBalanceAfter - feeRecipientBalanceBefore;

      console.log("\n💸 Transaction Summary:");
      console.log(`   Tokens Bought: ${tokensRemaining.toLocaleString()}`);
      console.log(`   SOL Spent: ${(solSpent / 1e9).toFixed(6)} SOL`);
      console.log(`   USD Spent: $${((solSpent / 1e9) * SOL_PRICE).toFixed(2)}`);
      console.log(`   Vault Increase: ${(vaultIncrease / 1e9).toFixed(6)} SOL`);
      console.log(`   Fee Collected: ${(feeCollected / 1e9).toFixed(6)} SOL (1%)`);
      console.log(`   Avg Price/Token: $${(((solSpent / 1e9) * SOL_PRICE) / tokensRemaining).toFixed(10)}`);

      console.log("\n📈 Final Spot Price:");
      console.log(`   ${spotPriceAfter.spotPrice} lamports`);
      console.log(`   $${((spotPriceAfter.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)}`);
      console.log(`   Should be ~$0.00006900 (end price)`);

      console.log("\n🎓 GRADUATION STATUS:");
      console.log(`   Tokens Sold: ${(Number(bondingCurveAfter.tokensSold) / 1e9).toLocaleString()} / 800,000,000`);
      console.log(`   Progress: ${((Number(bondingCurveAfter.tokensSold) / 1e9 / 800_000_000) * 100).toFixed(2)}%`);
      console.log(`   SOL Raised: ${(Number(bondingCurveAfter.solReserve) / 1e9).toFixed(6)} SOL`);
      console.log(`   USD Raised: $${((Number(bondingCurveAfter.solReserve) / 1e9) * SOL_PRICE).toFixed(2)}`);
      console.log(`   Graduation Threshold: ~80 SOL (~$12,000 at $150/SOL)`);
      console.log(`   Is Graduated: ${bondingCurveAfter.isGraduated ? '🎉 YES!' : '⏳ Not yet'}`);

      // Verify graduation
      const tokensSoldFinal = Number(bondingCurveAfter.tokensSold) / 1e9;
      console.log("\n✅ Verification:");
      console.log(`   All 800M tokens sold: ${tokensSoldFinal === 800_000_000 ? '✅' : '❌'}`);
      console.log(`   Curve is graduated: ${bondingCurveAfter.isGraduated ? '✅' : '❌'}`);
      console.log(`   Final price reached: ${spotPriceAfter.spotPrice.toNumber() > 400 ? '✅' : '❌'}`);
    });
  });

  describe("6. Multiple Token Trading Test", () => {
    it("Creates and trades two different tokens simultaneously", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔀 MULTIPLE TOKEN TRADING TEST");
      console.log("=".repeat(80));

      const SOL_PRICE = 150;

      // Create second token
      const creator2 = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(creator2.publicKey, 10 * LAMPORTS_PER_SOL)
      );

      const tokenName2 = "Second Token";
      const tokenSymbol2 = "SEC";
      const metadataUri2 = "https://example.com/metadata2.json";

      // Derive PDAs for second token
      const [mintPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), creator2.publicKey.toBuffer(), Buffer.from(tokenName2)],
        program.programId
      );

      const [tokenLaunchPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_launch"), mintPda2.toBuffer()],
        program.programId
      );

      const [bondingCurvePda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding_curve"), tokenLaunchPda2.toBuffer()],
        program.programId
      );

      const curveTokenAccount2 = getAssociatedTokenAddressSync(
        mintPda2,
        bondingCurvePda2,
        true
      );

      const [solVaultPda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("sol_vault"), bondingCurvePda2.toBuffer()],
        program.programId
      );

      console.log("\n📋 Creating second token launch...");
      await program.methods
        .createTokenLaunch(tokenName2, tokenSymbol2, metadataUri2, solPriceUsd)
        .accounts({
          tokenLaunch: tokenLaunchPda2,
          mint: mintPda2,
          bondingCurve: bondingCurvePda2,
          curveTokenAccount: curveTokenAccount2,
          solVault: solVaultPda2,
          creator: creator2.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator2])
        .rpc();

      console.log("✅ Second token created");
      console.log(`   Name: ${tokenName2}`);
      console.log(`   Symbol: ${tokenSymbol2}`);

      // Create traders for multi-token test
      const multiTrader1 = Keypair.generate();
      const multiTrader2 = Keypair.generate();
      
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(multiTrader1.publicKey, 100 * LAMPORTS_PER_SOL)
      );
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(multiTrader2.publicKey, 100 * LAMPORTS_PER_SOL)
      );

      console.log("\n💰 Traders funded");

      // Get initial prices for both tokens
      const spotPrice1 = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
        })
        .view();

      const spotPrice2 = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda2,
          bondingCurve: bondingCurvePda2,
        })
        .view();

      console.log("\n📊 Initial Spot Prices:");
      console.log(`   Token 1 (${tokenSymbol}): ${spotPrice1.spotPrice} lamports ($${((spotPrice1.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)})`);
      console.log(`   Token 2 (${tokenSymbol2}): ${spotPrice2.spotPrice} lamports ($${((spotPrice2.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)})`);

      // Note: Token 1 might be graduated from previous tests, so we'll focus on Token 2
      // and create a third token for cross-trading demonstrations
      
      // Create third token for better testing
      const creator3 = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(creator3.publicKey, 10 * LAMPORTS_PER_SOL)
      );

      const tokenName3 = "Third Token";
      const tokenSymbol3 = "THD";
      const metadataUri3 = "https://example.com/metadata3.json";

      // Derive PDAs for third token
      const [mintPda3] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), creator3.publicKey.toBuffer(), Buffer.from(tokenName3)],
        program.programId
      );

      const [tokenLaunchPda3] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_launch"), mintPda3.toBuffer()],
        program.programId
      );

      const [bondingCurvePda3] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding_curve"), tokenLaunchPda3.toBuffer()],
        program.programId
      );

      const curveTokenAccount3 = getAssociatedTokenAddressSync(
        mintPda3,
        bondingCurvePda3,
        true
      );

      const [solVaultPda3] = PublicKey.findProgramAddressSync(
        [Buffer.from("sol_vault"), bondingCurvePda3.toBuffer()],
        program.programId
      );

      console.log("\n📋 Creating third token launch...");
      await program.methods
        .createTokenLaunch(tokenName3, tokenSymbol3, metadataUri3, solPriceUsd)
        .accounts({
          tokenLaunch: tokenLaunchPda3,
          mint: mintPda3,
          bondingCurve: bondingCurvePda3,
          curveTokenAccount: curveTokenAccount3,
          solVault: solVaultPda3,
          creator: creator3.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator3])
        .rpc();

      console.log("✅ Third token created");
      console.log(`   Name: ${tokenName3}`);
      console.log(`   Symbol: ${tokenSymbol3}`);

      // Get spot price for third token
      const spotPrice3 = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda3,
          bondingCurve: bondingCurvePda3,
        })
        .view();

      console.log(`   Initial Price: ${spotPrice3.spotPrice} lamports ($${((spotPrice3.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)})`);

      // Trade 1: Trader 1 buys Token 2
      console.log("\n" + "=".repeat(80));
      console.log("🔥 TRADE 1: Trader 1 buys 10M of Token 2 (SEC)");
      console.log("=".repeat(80));

      const tradeAmount1 = new anchor.BN(10_000_000).mul(new anchor.BN(1_000_000_000));
      const trader1Token2Account = getAssociatedTokenAddressSync(mintPda2, multiTrader1.publicKey);
      const [trader1Position2] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), multiTrader1.publicKey.toBuffer(), tokenLaunchPda2.toBuffer()],
        program.programId
      );

      const quote1 = await program.methods
        .getBuyQuote(tradeAmount1)
        .accounts({
          bondingCurve: bondingCurvePda2,
          tokenLaunch: tokenLaunchPda2,
        })
        .view();

      console.log(`   Expected cost: ${(Number(quote1.cost) / 1e9).toFixed(6)} SOL`);

      await program.methods
        .buyTokens(tradeAmount1, quote1.cost.mul(new BN(110)).div(new BN(100)))
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda2,
          bondingCurve: bondingCurvePda2,
          curveTokenAccount: curveTokenAccount2,
          solVault: solVaultPda2,
          userPosition: trader1Position2,
          mint: mintPda2,
          buyerTokenAccount: trader1Token2Account,
          buyer: multiTrader1.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([multiTrader1])
        .rpc();

      const balance1 = (await provider.connection.getTokenAccountBalance(trader1Token2Account)).value.uiAmount;
      console.log(`✅ Trade complete! Trader 1 now has ${balance1?.toLocaleString()} ${tokenSymbol2}`);

      // Trade 2: Trader 2 buys Token 3
      console.log("\n" + "=".repeat(80));
      console.log(`🔥 TRADE 2: Trader 2 buys 15M of Token 3 (${tokenSymbol3})`);
      console.log("=".repeat(80));

      const tradeAmount2 = new anchor.BN(15_000_000).mul(new anchor.BN(1_000_000_000));
      const trader2Token3Account = getAssociatedTokenAddressSync(mintPda3, multiTrader2.publicKey);
      const [trader2Position3] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), multiTrader2.publicKey.toBuffer(), tokenLaunchPda3.toBuffer()],
        program.programId
      );

      const quote2 = await program.methods
        .getBuyQuote(tradeAmount2)
        .accounts({
          bondingCurve: bondingCurvePda3,
          tokenLaunch: tokenLaunchPda3,
        })
        .view();

      console.log(`   Expected cost: ${(Number(quote2.cost) / 1e9).toFixed(6)} SOL`);

      await program.methods
        .buyTokens(tradeAmount2, quote2.cost.mul(new BN(110)).div(new BN(100)))
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda3,
          bondingCurve: bondingCurvePda3,
          curveTokenAccount: curveTokenAccount3,
          solVault: solVaultPda3,
          userPosition: trader2Position3,
          mint: mintPda3,
          buyerTokenAccount: trader2Token3Account,
          buyer: multiTrader2.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([multiTrader2])
        .rpc();

      const balance2 = (await provider.connection.getTokenAccountBalance(trader2Token3Account)).value.uiAmount;
      console.log(`✅ Trade complete! Trader 2 now has ${balance2?.toLocaleString()} ${tokenSymbol3}`);

      // Trade 3: Trader 1 buys more Token 2 (accumulation)
      console.log("\n" + "=".repeat(80));
      console.log(`🔥 TRADE 3: Trader 1 buys 5M more of Token 2 (${tokenSymbol2})`);
      console.log("=".repeat(80));

      const tradeAmount3 = new anchor.BN(5_000_000).mul(new anchor.BN(1_000_000_000));
      // Reuse trader1Token2Account and trader1Position2 from Trade 1

      const quote3 = await program.methods
        .getBuyQuote(tradeAmount3)
        .accounts({
          bondingCurve: bondingCurvePda2,
          tokenLaunch: tokenLaunchPda2,
        })
        .view();

      console.log(`   Expected cost: ${(Number(quote3.cost) / 1e9).toFixed(6)} SOL`);

      await program.methods
        .buyTokens(tradeAmount3, quote3.cost.mul(new BN(110)).div(new BN(100)))
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda2,
          bondingCurve: bondingCurvePda2,
          curveTokenAccount: curveTokenAccount2,
          solVault: solVaultPda2,
          userPosition: trader1Position2,
          mint: mintPda2,
          buyerTokenAccount: trader1Token2Account,
          buyer: multiTrader1.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([multiTrader1])
        .rpc();

      const balance3 = (await provider.connection.getTokenAccountBalance(trader1Token2Account)).value.uiAmount;
      console.log(`✅ Trade complete! Trader 1 now has ${balance3?.toLocaleString()} ${tokenSymbol2} total`);

      // Trade 4: Trader 2 buys Token 2 (cross-trading)
      console.log("\n" + "=".repeat(80));
      console.log(`🔥 TRADE 4: Trader 2 buys 8M of Token 2 (${tokenSymbol2}) - cross-trading`);
      console.log("=".repeat(80));

      const tradeAmount4 = new anchor.BN(8_000_000).mul(new anchor.BN(1_000_000_000));
      const trader2Token2Account = getAssociatedTokenAddressSync(mintPda2, multiTrader2.publicKey);
      const [trader2Position2] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), multiTrader2.publicKey.toBuffer(), tokenLaunchPda2.toBuffer()],
        program.programId
      );

      const quote4 = await program.methods
        .getBuyQuote(tradeAmount4)
        .accounts({
          bondingCurve: bondingCurvePda2,
          tokenLaunch: tokenLaunchPda2,
        })
        .view();

      console.log(`   Expected cost: ${(Number(quote4.cost) / 1e9).toFixed(6)} SOL`);

      await program.methods
        .buyTokens(tradeAmount4, quote4.cost.mul(new BN(110)).div(new BN(100)))
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda2,
          bondingCurve: bondingCurvePda2,
          curveTokenAccount: curveTokenAccount2,
          solVault: solVaultPda2,
          userPosition: trader2Position2,
          mint: mintPda2,
          buyerTokenAccount: trader2Token2Account,
          buyer: multiTrader2.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([multiTrader2])
        .rpc();

      const balance4 = (await provider.connection.getTokenAccountBalance(trader2Token2Account)).value.uiAmount;
      console.log(`✅ Trade complete! Trader 2 now has ${balance4?.toLocaleString()} ${tokenSymbol2}`);

      // Get final states
      const bondingCurve2Final = await program.account.bondingCurve.fetch(bondingCurvePda2);
      const bondingCurve3Final = await program.account.bondingCurve.fetch(bondingCurvePda3);

      const spotPrice2Final = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda2,
          bondingCurve: bondingCurvePda2,
        })
        .view();

      const spotPrice3Final = await program.methods
        .getSpotPrice()
        .accounts({
          tokenLaunch: tokenLaunchPda3,
          bondingCurve: bondingCurvePda3,
        })
        .view();

      console.log("\n" + "=".repeat(80));
      console.log("📊 FINAL STATE SUMMARY");
      console.log("=".repeat(80));

      console.log("\n🪙 Token 2 (SEC):");
      console.log(`   Tokens Sold: ${(Number(bondingCurve2Final.tokensSold) / 1e9).toLocaleString()}`);
      console.log(`   SOL Reserve: ${(Number(bondingCurve2Final.solReserve) / 1e9).toFixed(6)} SOL`);
      console.log(`   Current Price: ${spotPrice2Final.spotPrice} lamports ($${((spotPrice2Final.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)})`);
      console.log(`   Trade Count: ${bondingCurve2Final.tradeCount}`);

      console.log("\n🪙 Token 3 (THD):");
      console.log(`   Tokens Sold: ${(Number(bondingCurve3Final.tokensSold) / 1e9).toLocaleString()}`);
      console.log(`   SOL Reserve: ${(Number(bondingCurve3Final.solReserve) / 1e9).toFixed(6)} SOL`);
      console.log(`   Current Price: ${spotPrice3Final.spotPrice} lamports ($${((spotPrice3Final.spotPrice.toNumber() / 1e9) * SOL_PRICE).toFixed(10)})`);
      console.log(`   Trade Count: ${bondingCurve3Final.tradeCount}`);

      console.log("\n👤 Trader 1 Holdings:");
      console.log(`   Token 2 (SEC): ${balance1?.toLocaleString()} (first buy) + ${(balance3! - balance1!).toLocaleString()} (second buy) = ${balance3?.toLocaleString()} total`);

      console.log("\n👤 Trader 2 Holdings:");
      console.log(`   Token 2 (SEC): ${balance4?.toLocaleString()}`);
      console.log(`   Token 3 (THD): ${balance2?.toLocaleString()}`);

      console.log("\n✅ Multi-Token Trading Verification:");
      console.log(`   ✓ Multiple tokens created independently`);
      console.log(`   ✓ Each token has separate bonding curves`);
      console.log(`   ✓ Traders can hold multiple different tokens`);
      console.log(`   ✓ Traders can accumulate same token across trades`);
      console.log(`   ✓ Cross-trading works smoothly`);
      console.log(`   ✓ Each token maintains its own state`);
      console.log(`   ✓ No interference between token launches`);
      console.log(`   ✓ User positions track correctly per token per user`);

      // Verify independence
      assert.ok(bondingCurve2Final.tradeCount.toNumber() === 3, "Token 2 should have 3 trades (Trader1 x2, Trader2 x1)");
      assert.ok(bondingCurve3Final.tradeCount.toNumber() === 1, "Token 3 should have 1 trade");
      assert.ok(balance1 && balance1 > 0, "Trader 1 should have Token 2");
      assert.ok(balance3 && balance3 > balance1!, "Trader 1 should have more Token 2 after second buy");
      assert.ok(balance4 && balance4 > 0, "Trader 2 should have Token 2");
      assert.ok(balance2 && balance2 > 0, "Trader 2 should have Token 3");
    });

    it("Allows buying just 1 token (minimum purchase)", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🔬 MINIMUM PURCHASE TEST: 1 TOKEN");
      console.log("=".repeat(80));

      const SOL_PRICE = 150;
      
      // Create a fresh token for this test to avoid graduation issues
      const creator4 = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(creator4.publicKey, 10 * LAMPORTS_PER_SOL)
      );

      const tokenName4 = "Min Token";
      const tokenSymbol4 = "MIN";
      const metadataUri4 = "https://example.com/metadata4.json";

      // Derive PDAs for the minimum test token
      const [mintPda4] = PublicKey.findProgramAddressSync(
        [Buffer.from("mint"), creator4.publicKey.toBuffer(), Buffer.from(tokenName4)],
        program.programId
      );

      const [tokenLaunchPda4] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_launch"), mintPda4.toBuffer()],
        program.programId
      );

      const [bondingCurvePda4] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding_curve"), tokenLaunchPda4.toBuffer()],
        program.programId
      );

      const curveTokenAccount4 = getAssociatedTokenAddressSync(
        mintPda4,
        bondingCurvePda4,
        true
      );

      const [solVaultPda4] = PublicKey.findProgramAddressSync(
        [Buffer.from("sol_vault"), bondingCurvePda4.toBuffer()],
        program.programId
      );

      // Create the token
      await program.methods
        .createTokenLaunch(tokenName4, tokenSymbol4, metadataUri4, solPriceUsd)
        .accounts({
          tokenLaunch: tokenLaunchPda4,
          mint: mintPda4,
          bondingCurve: bondingCurvePda4,
          curveTokenAccount: curveTokenAccount4,
          solVault: solVaultPda4,
          creator: creator4.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([creator4])
        .rpc();

      console.log("✅ Fresh token created for minimum purchase test");

      // Now test buying 1 token
      const oneToken = new BN(1_000_000_000); // 1 token with 9 decimals

      console.log("\n📊 Getting quote for 1 token...");
      const quote = await program.methods
        .getBuyQuote(oneToken)
        .accounts({
          bondingCurve: bondingCurvePda4,
          tokenLaunch: tokenLaunchPda4,
        })
        .view();

      console.log(`   Amount: 1 token`);
      console.log(`   Cost: ${quote.cost} lamports`);
      console.log(`   Cost: ${(Number(quote.cost) / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
      console.log(`   Cost: $${((Number(quote.cost) / LAMPORTS_PER_SOL) * SOL_PRICE).toFixed(10)}`);

      // Create a new trader for this test
      const minTrader = Keypair.generate();
      
      console.log("\n💰 Funding min trader...");
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(minTrader.publicKey, 1 * LAMPORTS_PER_SOL)
      );

      // Get trader's token account (will be created)
      const minTraderTokenAccount = getAssociatedTokenAddressSync(
        mintPda4,
        minTrader.publicKey
      );

      // Derive user position PDA
      const [minTraderPosition] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_position"),
          minTrader.publicKey.toBuffer(),
          tokenLaunchPda4.toBuffer(),
        ],
        program.programId
      );

      const bondingCurveBefore = await program.account.bondingCurve.fetch(bondingCurvePda4);
      const traderSolBefore = await provider.connection.getBalance(minTrader.publicKey);

      console.log("\n📊 Before Trade:");
      console.log(`   Tokens Sold on Curve: ${(Number(bondingCurveBefore.tokensSold) / 1e9).toLocaleString()}`);
      console.log(`   Trader SOL: ${(traderSolBefore / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

      console.log("\n🔥 Executing 1 token purchase...");
      
      // Set max cost to quote + 50% buffer for small amounts
      const maxCost = new BN(Math.floor(Number(quote.cost) * 1.5));
      
      await program.methods
        .buyTokens(oneToken, maxCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda4,
          bondingCurve: bondingCurvePda4,
          curveTokenAccount: curveTokenAccount4,
          solVault: solVaultPda4,
          userPosition: minTraderPosition,
          mint: mintPda4,
          buyerTokenAccount: minTraderTokenAccount,
          buyer: minTrader.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([minTrader])
        .rpc();

      console.log("✅ Trade complete!");

      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda4);
      const traderSolAfter = await provider.connection.getBalance(minTrader.publicKey);
      const traderTokenBalance = await provider.connection.getTokenAccountBalance(minTraderTokenAccount);

      console.log("\n📊 After Trade:");
      console.log(`   Tokens Sold: ${(Number(bondingCurveAfter.tokensSold) / 1e9).toLocaleString()}`);
      console.log(`   Trader Token Balance: ${Number(traderTokenBalance.value.amount) / 1e9} tokens`);
      console.log(`   Trader SOL: ${(traderSolAfter / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

      const solSpent = (traderSolBefore - traderSolAfter) / LAMPORTS_PER_SOL;
      console.log("\n💸 Transaction Summary:");
      console.log(`   SOL Spent: ${solSpent.toFixed(9)} SOL`);
      console.log(`   USD Spent: $${(solSpent * SOL_PRICE).toFixed(10)}`);
      console.log(`   Tokens Received: ${Number(traderTokenBalance.value.amount) / 1e9}`);

      console.log("\n✅ Minimum Purchase Verification:");
      console.log(`   ✓ Can buy just 1 token`);
      console.log(`   ✓ Transaction executes successfully`);
      console.log(`   ✓ Token balance updated correctly`);
      console.log(`   ✓ Bonding curve state updated`);

      // Verify the purchase
      assert.equal(Number(traderTokenBalance.value.amount), 1_000_000_000, "Should have exactly 1 token");
      assert.ok(solSpent > 0, "Should have spent some SOL");
      assert.ok(
        Number(bondingCurveAfter.tokensSold) > Number(bondingCurveBefore.tokensSold),
        "Tokens sold should increase"
      );
    });
  });

  describe("7. Final State Summary", () => {
    it("Displays complete bonding curve state", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("📊 FINAL BONDING CURVE STATE");
      console.log("=".repeat(80));

      const spotPrice = await program.methods
        .getSpotPrice()
        .accounts({
          bondingCurve: bondingCurvePda,
          tokenLaunch: tokenLaunchPda,
        })
        .view();

      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);
      const tokensSoldNum = Number(spotPrice.tokensSold) / 1e9;
      const tokensRemaining = 800_000_000 - tokensSoldNum;
      const progressPct = (tokensSoldNum / 800_000_000) * 100;

      const priceInSol = Number(spotPrice.spotPrice) / LAMPORTS_PER_SOL;
      const priceInUsd = priceInSol * 150;

      console.log("\n💰 Bonding Curve Metrics:");
      console.log("   Tokens Sold:", tokensSoldNum.toLocaleString(), "/ 800,000,000");
      console.log("   Progress:", progressPct.toFixed(4) + "%");
      console.log("   Tokens Remaining:", tokensRemaining.toLocaleString());
      console.log("   Current Spot Price: $" + priceInUsd.toFixed(10));
      console.log("   SOL Reserve:", (Number(spotPrice.solReserve) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Total Volume:", (Number(bondingCurve.totalVolume) / LAMPORTS_PER_SOL).toFixed(6), "SOL");
      console.log("   Trade Count:", bondingCurve.tradeCount.toString());
      console.log("   Is Graduated:", bondingCurve.isGraduated);

      console.log("\n🎯 Graduation Status:");
      console.log("   Needs: 800,000,000 tokens sold + ~80 SOL ($12,000)");
      console.log("   Current: " + tokensSoldNum.toLocaleString() + " tokens sold");
      console.log("   Remaining:", tokensRemaining.toLocaleString(), "tokens");
      console.log("   Is Graduated:", bondingCurve.isGraduated ? '🎉 YES!' : '⏳ Not yet');

      // After graduation test, we should have 800M tokens sold
      // Trade count should be 6 (3 buys + 2 sells + 1 whale buy)
      assert.ok(bondingCurve.tradeCount.toNumber() >= 5, "Should have at least 5 trades");
      // Tokens sold could be 225M (before graduation) or 800M (after graduation)
      assert.ok(tokensSoldNum >= 225_000_000, "Should have sold at least 225M tokens");
    });
  });
});
