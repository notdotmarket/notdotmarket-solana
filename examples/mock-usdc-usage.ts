/**
 * Simple example showing how to use the Mock USDC program
 * Run this with: ts-node examples/mock-usdc-usage.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// Mock USDC Program Configuration
const PROGRAM_ID = new PublicKey("AXsvvaM4CB4ixKBWtcsobwGtQtD32XD6NEaKRvhY8QDz");
const CLUSTER_URL = "http://localhost:8899"; // Change to devnet if needed

async function main() {
  console.log("🚀 Mock USDC Usage Example\n");

  // Setup connection and wallet
  const connection = new anchor.web3.Connection(CLUSTER_URL, "confirmed");
  const wallet = new Wallet(Keypair.generate()); // In practice, load your keypair
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load the program
  const idl = await Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) {
    throw new Error("IDL not found");
  }
  const program = new Program(idl, provider);

  console.log("📋 Program loaded:", PROGRAM_ID.toString());
  console.log("👛 Wallet:", wallet.publicKey.toString());

  // Step 1: Airdrop SOL for rent (localnet/devnet only)
  console.log("\n1️⃣ Requesting SOL airdrop...");
  try {
    const signature = await connection.requestAirdrop(
      wallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature);
    console.log("   ✅ Airdrop confirmed");
  } catch (error) {
    console.log("   ⚠️  Airdrop failed (might be on mainnet)");
  }

  // Step 2: Initialize USDC Mint
  console.log("\n2️⃣ Initializing Mock USDC mint...");
  const mintKeypair = Keypair.generate();
  
  try {
    const tx = await program.methods
      .initializeMint()
      .accounts({
        mint: mintKeypair.publicKey,
        authority: wallet.publicKey,
      })
      .signers([mintKeypair])
      .rpc();
    
    console.log("   ✅ Mint created:", mintKeypair.publicKey.toString());
    console.log("   📝 Transaction:", tx);
  } catch (error) {
    console.error("   ❌ Failed to create mint:", error);
    return;
  }

  // Step 3: Create Associated Token Account
  console.log("\n3️⃣ Creating token account...");
  const userTokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    wallet.publicKey
  );

  try {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      userTokenAccount,
      wallet.publicKey,
      mintKeypair.publicKey
    );

    const tx = new anchor.web3.Transaction().add(createAtaIx);
    const signature = await provider.sendAndConfirm(tx);
    
    console.log("   ✅ Token account created:", userTokenAccount.toString());
    console.log("   📝 Transaction:", signature);
  } catch (error) {
    console.error("   ❌ Failed to create token account:", error);
    return;
  }

  // Step 4: Mint Tokens
  console.log("\n4️⃣ Minting 10,000 USDC...");
  const mintAmount = new anchor.BN(10_000_000_000); // 10,000 USDC with 6 decimals

  try {
    const tx = await program.methods
      .mintTo(mintAmount)
      .accounts({
        mint: mintKeypair.publicKey,
        destination: userTokenAccount,
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log("   ✅ Minted 10,000 USDC");
    console.log("   📝 Transaction:", tx);
  } catch (error) {
    console.error("   ❌ Failed to mint:", error);
    return;
  }

  // Step 5: Check Balance
  console.log("\n5️⃣ Checking balance...");
  try {
    const balance = await connection.getTokenAccountBalance(userTokenAccount);
    console.log("   💰 Balance:", balance.value.uiAmount, "USDC");
    console.log("   💰 Raw amount:", balance.value.amount);
  } catch (error) {
    console.error("   ❌ Failed to get balance:", error);
  }

  // Step 6: Transfer Example
  console.log("\n6️⃣ Creating recipient and transferring 1,000 USDC...");
  const recipient = Keypair.generate();

  // Fund recipient for rent
  try {
    const signature = await connection.requestAirdrop(
      recipient.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(signature);
  } catch (error) {
    console.log("   ⚠️  Recipient airdrop failed");
  }

  // Create recipient token account
  const recipientTokenAccount = await getAssociatedTokenAddress(
    mintKeypair.publicKey,
    recipient.publicKey
  );

  try {
    const createAtaIx = createAssociatedTokenAccountInstruction(
      wallet.publicKey,
      recipientTokenAccount,
      recipient.publicKey,
      mintKeypair.publicKey
    );

    const tx = new anchor.web3.Transaction().add(createAtaIx);
    await provider.sendAndConfirm(tx);
    
    console.log("   ✅ Recipient token account created");
  } catch (error) {
    console.error("   ❌ Failed to create recipient account:", error);
    return;
  }

  // Transfer tokens
  const transferAmount = new anchor.BN(1_000_000_000); // 1,000 USDC

  try {
    const tx = await program.methods
      .transfer(transferAmount)
      .accounts({
        from: userTokenAccount,
        to: recipientTokenAccount,
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log("   ✅ Transferred 1,000 USDC");
    console.log("   📝 Transaction:", tx);
  } catch (error) {
    console.error("   ❌ Failed to transfer:", error);
    return;
  }

  // Check final balances
  console.log("\n7️⃣ Final balances:");
  try {
    const senderBalance = await connection.getTokenAccountBalance(userTokenAccount);
    const recipientBalance = await connection.getTokenAccountBalance(recipientTokenAccount);
    
    console.log("   💰 Your balance:", senderBalance.value.uiAmount, "USDC");
    console.log("   💰 Recipient balance:", recipientBalance.value.uiAmount, "USDC");
  } catch (error) {
    console.error("   ❌ Failed to get balances:", error);
  }

  console.log("\n✨ Example completed successfully!");
  console.log("\n📚 Key Information:");
  console.log("   🔑 Mint Address:", mintKeypair.publicKey.toString());
  console.log("   👛 Your Token Account:", userTokenAccount.toString());
  console.log("   📦 Program ID:", PROGRAM_ID.toString());
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
