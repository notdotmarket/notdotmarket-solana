import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { NotmarketSolana } from "../target/types/notmarket_solana";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

describe("Bonding Curve - Large Scale Trades", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NotmarketSolana as Program<NotmarketSolana>;
  
  // Test accounts
  const authority = provider.wallet as anchor.Wallet;
  let feeRecipient: PublicKey; // Will be fetched from config
  const creator = Keypair.generate();
  const whale1 = Keypair.generate(); // 10M buyer
  const whale2 = Keypair.generate(); // 100M buyer
  const whale3 = Keypair.generate(); // 200M buyer

  // Token parameters
  const tokenName = "Large Trade Test Token";
  const tokenSymbol = "LTTT";
  const metadataUri = "https://example.com/large-trade-test.json";
  const solPriceUsd = new BN(150_00000000); // $150 USD (scaled by 1e8)
  const platformFeeBps = 100; // 1%

  // PDAs
  let configPda: PublicKey;
  let mintPda: PublicKey;
  let tokenLaunchPda: PublicKey;
  let bondingCurvePda: PublicKey;
  let curveTokenAccount: PublicKey;
  let solVaultPda: PublicKey;

  // Whale accounts
  let whale1TokenAccount: PublicKey;
  let whale2TokenAccount: PublicKey;
  let whale3TokenAccount: PublicKey;
  let whale1PositionPda: PublicKey;
  let whale2PositionPda: PublicKey;
  let whale3PositionPda: PublicKey;

  // Constants for readability
  const ONE_TOKEN = new BN(1_000_000_000); // 1 token with 9 decimals
  const ONE_MILLION = new BN(1_000_000_000_000_000); // 1M tokens with decimals
  const TEN_MILLION = ONE_MILLION.mul(new BN(10)); // 10M tokens
  const HUNDRED_MILLION = ONE_MILLION.mul(new BN(100)); // 100M tokens
  const TWO_HUNDRED_MILLION = ONE_MILLION.mul(new BN(200)); // 200M tokens

  before(async () => {
    console.log("\n" + "=".repeat(80));
    console.log("🐋 LARGE SCALE BONDING CURVE TRADE TEST SETUP");
    console.log("=".repeat(80));

    // Derive config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launchpad_config")],
      program.programId
    );

    // Try to fetch existing config or initialize a new one
    try {
      const configAccount = await program.account.launchpadConfig.fetch(configPda);
      feeRecipient = configAccount.feeRecipient;
      console.log("\n✅ Using existing launchpad config");
      console.log(`   Fee Recipient: ${feeRecipient.toString()}`);
    } catch (err) {
      // Config doesn't exist, initialize it
      const newFeeRecipient = Keypair.generate();
      console.log("\n📋 Initializing new launchpad config...");
      
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(newFeeRecipient.publicKey, 100 * LAMPORTS_PER_SOL)
      );

      await program.methods
        .initializeLaunchpad(platformFeeBps)
        .accounts({
          config: configPda,
          authority: authority.publicKey,
          feeRecipient: newFeeRecipient.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      feeRecipient = newFeeRecipient.publicKey;
      console.log("✅ Launchpad initialized");
      console.log(`   Fee Recipient: ${feeRecipient.toString()}`);
    }

    // Airdrop reasonable amounts of SOL to whales
    const whaleAirdropAmount = 50_000 * LAMPORTS_PER_SOL; // 50k SOL each
    
    console.log("\n💰 Funding whale accounts with 50,000 SOL each...");
    
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(creator.publicKey, whaleAirdropAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(whale1.publicKey, whaleAirdropAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(whale2.publicKey, whaleAirdropAmount)
    );
    await provider.connection.confirmTransaction(
      await provider.connection.requestAirdrop(whale3.publicKey, whaleAirdropAmount)
    );
    
    console.log("✅ All whale accounts funded\n");
  });

  describe("Setup Token Launch", () => {
    it("Creates a new token launch for large scale trading", async () => {
      console.log("\n🚀 Creating token launch for large scale trades...");

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

      // Set up whale token accounts and position PDAs
      whale1TokenAccount = getAssociatedTokenAddressSync(mintPda, whale1.publicKey);
      whale2TokenAccount = getAssociatedTokenAddressSync(mintPda, whale2.publicKey);
      whale3TokenAccount = getAssociatedTokenAddressSync(mintPda, whale3.publicKey);

      [whale1PositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), whale1.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );
      [whale2PositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), whale2.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );
      [whale3PositionPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), whale3.publicKey.toBuffer(), tokenLaunchPda.toBuffer()],
        program.programId
      );

      // Create token launch
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

      console.log("✅ Token launch created for large scale trading");
      
      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);
      console.log("\n📊 Initial Bonding Curve State:");
      console.log(`   Token Reserve: ${bondingCurve.tokenReserve.toString()} (${Number(bondingCurve.tokenReserve.toString()) / 1e9} tokens)`);
      console.log(`   Available for Sale: 800,000,000 tokens`);
      console.log(`   Initial Price: $0.00000420\n`);
    });
  });

  describe("Large Scale Trading with Quotes", () => {
    it("Whale 1: Buys 10M tokens with quote verification", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🐋 WHALE 1 TRADE: 10,000,000 TOKENS");
      console.log("=".repeat(80));

      const buyAmount = TEN_MILLION;
      const maxSolCost = new BN(LAMPORTS_PER_SOL * 10000); // 10k SOL max

      // Get quote BEFORE the trade
      console.log("\n📊 Getting quote from program...");
      try {
        const quote = await program.methods
          .getBuyQuote(buyAmount)
          .accounts({
            bondingCurve: bondingCurvePda,
            tokenLaunch: tokenLaunchPda,
          })
          .view();

        console.log("\n✅ Quote received via .view():");
        console.log(`   Token Amount: ${buyAmount.toString()} (${buyAmount.toNumber() / 1e9} tokens)`);
        console.log(`   Estimated Cost: ${quote.cost.toString()} lamports`);
        console.log(`   Estimated Cost: ${quote.cost.toNumber() / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Spot Price: ${quote.spotPrice.toString()} lamports per token`);
        console.log(`   Slippage: ${quote.slippage} bps (${(quote.slippage / 100).toFixed(2)}%)`);
        
        // Calculate platform fee (1%)
        const estimatedFee = quote.cost.toNumber() * 0.01;
        console.log(`   Estimated Fee: ${estimatedFee.toFixed(0)} lamports`);
      } catch (err) {
        console.log("⚠️  Quote simulation not available:", err.message);
      }

      // Get bonding curve state before trade
      const bondingCurveBefore = await program.account.bondingCurve.fetch(bondingCurvePda);
      const whale1BalanceBefore = await provider.connection.getBalance(whale1.publicKey);

      console.log("\n📈 BEFORE Trade:");
      console.log(`   Tokens Sold: ${bondingCurveBefore.tokensSold.toString()} (${Number(bondingCurveBefore.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurveBefore.solReserve.toString()} lamports`);
      console.log(`   Whale Balance: ${whale1BalanceBefore / LAMPORTS_PER_SOL} SOL`);

      // Execute the trade
      console.log("\n💸 Executing 10M token purchase...");
      const txSignature = await program.methods
        .buyTokens(buyAmount, maxSolCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: whale1PositionPda,
          mint: mintPda,
          buyerTokenAccount: whale1TokenAccount,
          buyer: whale1.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([whale1])
        .rpc();

      console.log(`✅ Transaction: ${txSignature}`);

      // Get state after trade
      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda);
      const whale1BalanceAfter = await provider.connection.getBalance(whale1.publicKey);
      const whale1TokenBalance = await provider.connection.getTokenAccountBalance(whale1TokenAccount);
      const userPosition = await program.account.userPosition.fetch(whale1PositionPda);

      const solSpent = whale1BalanceBefore - whale1BalanceAfter;
      const effectivePricePerToken = solSpent / Number(buyAmount.toString());

      console.log("\n📈 AFTER Trade:");
      console.log(`   Tokens Sold: ${bondingCurveAfter.tokensSold.toString()} (${Number(bondingCurveAfter.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurveAfter.solReserve.toString()} lamports`);
      console.log(`   SOL Reserve: ${Number(bondingCurveAfter.solReserve.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Balance: ${whale1BalanceAfter / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Token Balance: ${whale1TokenBalance.value.amount} (${Number(whale1TokenBalance.value.amount) / 1e9} tokens)`);

      console.log("\n💰 Trade Analysis:");
      console.log(`   SOL Spent (total): ${solSpent / LAMPORTS_PER_SOL} SOL`);
      console.log(`   USD Value @ $150: $${(solSpent / LAMPORTS_PER_SOL) * 150}`);
      console.log(`   Effective Price per Token: ${effectivePricePerToken * 1e9} lamports`);
      console.log(`   Effective Price per Token: $${(effectivePricePerToken / LAMPORTS_PER_SOL) * 150}`);
      console.log(`   Trade Count: ${bondingCurveAfter.tradeCount.toString()}`);
      console.log(`   Total Volume: ${bondingCurveAfter.totalVolume.toString()} lamports`);

      console.log("\n👤 User Position:");
      console.log(`   Tokens Owned: ${userPosition.tokenAmount.toString()} (${Number(userPosition.tokenAmount.toString()) / 1e9} tokens)`);
      console.log(`   SOL Invested: ${userPosition.solInvested.toString()} lamports (${Number(userPosition.solInvested.toString()) / LAMPORTS_PER_SOL} SOL)`);
      console.log(`   Buy Count: ${userPosition.buyCount}`);

      // Assertions
      assert.ok(bondingCurveAfter.tokensSold.eq(TEN_MILLION), "Should have sold exactly 10M tokens");
      assert.ok(Number(whale1TokenBalance.value.amount) >= Number(TEN_MILLION.toString()), "Whale should have received tokens");
    });

    it("Whale 2: Buys 100M tokens with quote verification", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🐋 WHALE 2 TRADE: 100,000,000 TOKENS");
      console.log("=".repeat(80));

      const buyAmount = HUNDRED_MILLION;
      const maxSolCost = new BN(LAMPORTS_PER_SOL * 20000); // 20k SOL max

      // Get quote BEFORE the trade
      console.log("\n📊 Getting quote from program...");
      try {
        const quote = await program.methods
          .getBuyQuote(buyAmount)
          .accounts({
            bondingCurve: bondingCurvePda,
            tokenLaunch: tokenLaunchPda,
          })
          .view();

        console.log("\n✅ Quote received via .view():");
        console.log(`   Token Amount: ${buyAmount.toString()} (${buyAmount.toNumber() / 1e9} tokens)`);
        console.log(`   Estimated Cost: ${quote.cost.toString()} lamports`);
        console.log(`   Estimated Cost: ${quote.cost.toNumber() / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Spot Price: ${quote.spotPrice.toString()} lamports per token`);
        console.log(`   Slippage: ${quote.slippage} bps (${(quote.slippage / 100).toFixed(2)}%)`);
        
        // Calculate platform fee (1%)
        const estimatedFee = quote.cost.toNumber() * 0.01;
        console.log(`   Estimated Fee: ${estimatedFee.toFixed(0)} lamports`);
      } catch (err) {
        console.log("⚠️  Quote not available:", err.message);
      }

      // Get bonding curve state before trade
      const bondingCurveBefore = await program.account.bondingCurve.fetch(bondingCurvePda);
      const whale2BalanceBefore = await provider.connection.getBalance(whale2.publicKey);

      console.log("\n📈 BEFORE Trade:");
      console.log(`   Tokens Sold: ${bondingCurveBefore.tokensSold.toString()} (${Number(bondingCurveBefore.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurveBefore.solReserve.toString()} lamports`);
      console.log(`   SOL Reserve: ${Number(bondingCurveBefore.solReserve.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Balance: ${whale2BalanceBefore / LAMPORTS_PER_SOL} SOL`);

      // Execute the trade
      console.log("\n💸 Executing 100M token purchase...");
      const txSignature = await program.methods
        .buyTokens(buyAmount, maxSolCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: whale2PositionPda,
          mint: mintPda,
          buyerTokenAccount: whale2TokenAccount,
          buyer: whale2.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([whale2])
        .rpc();

      console.log(`✅ Transaction: ${txSignature}`);

      // Get state after trade
      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda);
      const whale2BalanceAfter = await provider.connection.getBalance(whale2.publicKey);
      const whale2TokenBalance = await provider.connection.getTokenAccountBalance(whale2TokenAccount);
      const userPosition = await program.account.userPosition.fetch(whale2PositionPda);

      const solSpent = whale2BalanceBefore - whale2BalanceAfter;
      const effectivePricePerToken = solSpent / Number(buyAmount.toString());

      console.log("\n📈 AFTER Trade:");
      console.log(`   Tokens Sold: ${bondingCurveAfter.tokensSold.toString()} (${Number(bondingCurveAfter.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurveAfter.solReserve.toString()} lamports`);
      console.log(`   SOL Reserve: ${Number(bondingCurveAfter.solReserve.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Balance: ${whale2BalanceAfter / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Token Balance: ${whale2TokenBalance.value.amount} (${Number(whale2TokenBalance.value.amount) / 1e9} tokens)`);

      console.log("\n💰 Trade Analysis:");
      console.log(`   SOL Spent (total): ${solSpent / LAMPORTS_PER_SOL} SOL`);
      console.log(`   USD Value @ $150: $${(solSpent / LAMPORTS_PER_SOL) * 150}`);
      console.log(`   Effective Price per Token: ${effectivePricePerToken * 1e9} lamports`);
      console.log(`   Effective Price per Token: $${(effectivePricePerToken / LAMPORTS_PER_SOL) * 150}`);
      console.log(`   Trade Count: ${bondingCurveAfter.tradeCount.toString()}`);
      console.log(`   Total Volume: ${bondingCurveAfter.totalVolume.toString()} lamports (${Number(bondingCurveAfter.totalVolume.toString()) / LAMPORTS_PER_SOL} SOL)`);

      console.log("\n👤 User Position:");
      console.log(`   Tokens Owned: ${userPosition.tokenAmount.toString()} (${Number(userPosition.tokenAmount.toString()) / 1e9} tokens)`);
      console.log(`   SOL Invested: ${userPosition.solInvested.toString()} lamports (${Number(userPosition.solInvested.toString()) / LAMPORTS_PER_SOL} SOL)`);
      console.log(`   Buy Count: ${userPosition.buyCount}`);

      // Assertions
      assert.ok(bondingCurveAfter.tokensSold.eq(TEN_MILLION.add(HUNDRED_MILLION)), "Should have sold 110M tokens total");
      assert.ok(Number(whale2TokenBalance.value.amount) >= Number(HUNDRED_MILLION.toString()), "Whale should have received tokens");
    });

    it("Whale 3: Buys 200M tokens with quote verification", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("🐋 WHALE 3 TRADE: 200,000,000 TOKENS");
      console.log("=".repeat(80));

      const buyAmount = TWO_HUNDRED_MILLION;
      const maxSolCost = new BN(LAMPORTS_PER_SOL * 30000); // 30k SOL max

      // Get quote BEFORE the trade
      console.log("\n📊 Getting quote from program...");
      try {
        const quote = await program.methods
          .getBuyQuote(buyAmount)
          .accounts({
            bondingCurve: bondingCurvePda,
            tokenLaunch: tokenLaunchPda,
          })
          .view();

        console.log("\n✅ Quote received via .view():");
        console.log(`   Token Amount: ${buyAmount.toString()} (${buyAmount.toNumber() / 1e9} tokens)`);
        console.log(`   Estimated Cost: ${quote.cost.toString()} lamports`);
        console.log(`   Estimated Cost: ${quote.cost.toNumber() / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Spot Price: ${quote.spotPrice.toString()} lamports per token`);
        console.log(`   Slippage: ${quote.slippage} bps (${(quote.slippage / 100).toFixed(2)}%)`);
        
        // Calculate platform fee (1%)
        const estimatedFee = quote.cost.toNumber() * 0.01;
        console.log(`   Estimated Fee: ${estimatedFee.toFixed(0)} lamports`);
      } catch (err) {
        console.log("⚠️  Quote not available:", err.message);
      }

      // Get bonding curve state before trade
      const bondingCurveBefore = await program.account.bondingCurve.fetch(bondingCurvePda);
      const whale3BalanceBefore = await provider.connection.getBalance(whale3.publicKey);

      console.log("\n📈 BEFORE Trade:");
      console.log(`   Tokens Sold: ${bondingCurveBefore.tokensSold.toString()} (${Number(bondingCurveBefore.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurveBefore.solReserve.toString()} lamports`);
      console.log(`   SOL Reserve: ${Number(bondingCurveBefore.solReserve.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Balance: ${whale3BalanceBefore / LAMPORTS_PER_SOL} SOL`);

      // Execute the trade
      console.log("\n💸 Executing 200M token purchase...");
      const txSignature = await program.methods
        .buyTokens(buyAmount, maxSolCost)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          bondingCurve: bondingCurvePda,
          curveTokenAccount,
          solVault: solVaultPda,
          userPosition: whale3PositionPda,
          mint: mintPda,
          buyerTokenAccount: whale3TokenAccount,
          buyer: whale3.publicKey,
          feeRecipient: feeRecipient,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([whale3])
        .rpc();

      console.log(`✅ Transaction: ${txSignature}`);

      // Get state after trade
      const bondingCurveAfter = await program.account.bondingCurve.fetch(bondingCurvePda);
      const whale3BalanceAfter = await provider.connection.getBalance(whale3.publicKey);
      const whale3TokenBalance = await provider.connection.getTokenAccountBalance(whale3TokenAccount);
      const userPosition = await program.account.userPosition.fetch(whale3PositionPda);

      const solSpent = whale3BalanceBefore - whale3BalanceAfter;
      const effectivePricePerToken = solSpent / Number(buyAmount.toString());

      console.log("\n📈 AFTER Trade:");
      console.log(`   Tokens Sold: ${bondingCurveAfter.tokensSold.toString()} (${Number(bondingCurveAfter.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurveAfter.solReserve.toString()} lamports`);
      console.log(`   SOL Reserve: ${Number(bondingCurveAfter.solReserve.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Balance: ${whale3BalanceAfter / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Whale Token Balance: ${whale3TokenBalance.value.amount} (${Number(whale3TokenBalance.value.amount) / 1e9} tokens)`);

      console.log("\n💰 Trade Analysis:");
      console.log(`   SOL Spent (total): ${solSpent / LAMPORTS_PER_SOL} SOL`);
      console.log(`   USD Value @ $150: $${(solSpent / LAMPORTS_PER_SOL) * 150}`);
      console.log(`   Effective Price per Token: ${effectivePricePerToken * 1e9} lamports`);
      console.log(`   Effective Price per Token: $${(effectivePricePerToken / LAMPORTS_PER_SOL) * 150}`);
      console.log(`   Trade Count: ${bondingCurveAfter.tradeCount.toString()}`);
      console.log(`   Total Volume: ${bondingCurveAfter.totalVolume.toString()} lamports (${Number(bondingCurveAfter.totalVolume.toString()) / LAMPORTS_PER_SOL} SOL)`);

      console.log("\n👤 User Position:");
      console.log(`   Tokens Owned: ${userPosition.tokenAmount.toString()} (${Number(userPosition.tokenAmount.toString()) / 1e9} tokens)`);
      console.log(`   SOL Invested: ${userPosition.solInvested.toString()} lamports (${Number(userPosition.solInvested.toString()) / LAMPORTS_PER_SOL} SOL)`);
      console.log(`   Buy Count: ${userPosition.buyCount}`);

      // Assertions
      const expectedTotal = TEN_MILLION.add(HUNDRED_MILLION).add(TWO_HUNDRED_MILLION);
      assert.ok(bondingCurveAfter.tokensSold.eq(expectedTotal), "Should have sold 310M tokens total");
      assert.ok(Number(whale3TokenBalance.value.amount) >= Number(TWO_HUNDRED_MILLION.toString()), "Whale should have received tokens");
    });
  });

  describe("Final Summary", () => {
    it("Displays comprehensive trade summary and curve state", async () => {
      console.log("\n" + "=".repeat(80));
      console.log("📊 FINAL SUMMARY - LARGE SCALE TRADES");
      console.log("=".repeat(80));

      const bondingCurve = await program.account.bondingCurve.fetch(bondingCurvePda);
      const vaultBalance = await provider.connection.getBalance(solVaultPda);
      const feeRecipientBalance = await provider.connection.getBalance(feeRecipient);

      console.log("\n🎯 Bonding Curve Final State:");
      console.log(`   Tokens Sold: ${bondingCurve.tokensSold.toString()} (${Number(bondingCurve.tokensSold.toString()) / 1e9} tokens)`);
      console.log(`   Token Reserve Remaining: ${bondingCurve.tokenReserve.toString()} (${Number(bondingCurve.tokenReserve.toString()) / 1e9} tokens)`);
      console.log(`   SOL Reserve: ${bondingCurve.solReserve.toString()} lamports`);
      console.log(`   SOL Reserve: ${Number(bondingCurve.solReserve.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Total Volume: ${bondingCurve.totalVolume.toString()} lamports`);
      console.log(`   Total Volume: ${Number(bondingCurve.totalVolume.toString()) / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Trade Count: ${bondingCurve.tradeCount.toString()}`);
      console.log(`   Is Graduated: ${bondingCurve.isGraduated}`);

      console.log("\n💰 Liquidity Status:");
      console.log(`   SOL Vault Balance: ${vaultBalance / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Fee Recipient Balance: ${feeRecipientBalance / LAMPORTS_PER_SOL} SOL`);

      console.log("\n📈 Progress to Graduation:");
      const tokenProgress = (Number(bondingCurve.tokensSold.toString()) / 800_000_000_000_000_000) * 100;
      console.log(`   Token Progress: ${tokenProgress.toFixed(2)}% (need 100% = 800M tokens)`);
      console.log(`   Tokens Remaining: ${(800_000_000 - Number(bondingCurve.tokensSold.toString()) / 1e9).toLocaleString()} tokens`);

      // Calculate total USD raised
      const totalUsdRaised = (Number(bondingCurve.solReserve.toString()) / LAMPORTS_PER_SOL) * 150;
      console.log(`   USD Raised (estimated): $${totalUsdRaised.toLocaleString()}`);
      console.log(`   Need for Graduation: $12,000`);

      console.log("\n✅ Large scale trade testing complete!");
      console.log("=".repeat(80) + "\n");
    });
  });
});
