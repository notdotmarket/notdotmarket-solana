/**
 * Example: Fix Fee Recipient Issue
 * 
 * This script demonstrates how to update the fee recipient from the program
 * to a valid wallet address, fixing the ConstraintMut error (0x7d0).
 * 
 * Run this on Devnet to fix your integration issue.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { NotmarketSolana } from "../target/types/notmarket_solana";
import { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

// ============================================================================
// CONFIGURATION - Update these values for your deployment
// ============================================================================

const PROGRAM_ID = new PublicKey("D2EDhFF3HcNuwdSWpPE7z1QxVSdMVPFHv4N4vW7mXTwT");
const RPC_URL = "https://api.devnet.solana.com";

// Your authority wallet (must match the config authority)
// Replace this with your actual wallet path or use environment variable
const WALLET_PATH = process.env.ANCHOR_WALLET || "~/.config/solana/phantom.json";

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function fixFeeRecipient() {
  console.log("🔧 Fee Recipient Fix Tool");
  console.log("=" .repeat(80));
  
  // Setup connection and provider
  const connection = new Connection(RPC_URL, "confirmed");
  
  // Load your wallet
  const wallet = loadWallet(WALLET_PATH);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  
  // Load the program
  const program = new Program<NotmarketSolana>(
    require("../target/idl/notmarket_solana.json"),
    PROGRAM_ID,
    provider
  );
  
  console.log("\n📊 Current Setup:");
  console.log("   Program ID:", PROGRAM_ID.toString());
  console.log("   Authority Wallet:", wallet.publicKey.toString());
  console.log("   RPC URL:", RPC_URL);
  
  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launchpad_config")],
    PROGRAM_ID
  );
  
  console.log("   Config PDA:", configPda.toString());
  
  // ============================================================================
  // STEP 1: Check current fee recipient
  // ============================================================================
  
  console.log("\n" + "=".repeat(80));
  console.log("STEP 1: Checking Current Configuration");
  console.log("=".repeat(80));
  
  let config;
  try {
    config = await program.account.launchpadConfig.fetch(configPda);
    
    console.log("\n✅ Config found!");
    console.log("   Authority:", config.authority.toString());
    console.log("   Fee Recipient:", config.feeRecipient.toString());
    console.log("   Platform Fee:", config.platformFeeBps, "bps");
    
    // Check if fee recipient is the program itself (common error)
    if (config.feeRecipient.equals(PROGRAM_ID)) {
      console.log("\n⚠️  ERROR DETECTED: Fee recipient is set to the PROGRAM itself!");
      console.log("   This causes ConstraintMut errors during buy/sell transactions.");
      console.log("   We will fix this now...");
    } else {
      console.log("\n✅ Fee recipient is valid (not the program)");
      
      // Check if it's a valid account
      const feeRecipientInfo = await connection.getAccountInfo(config.feeRecipient);
      if (feeRecipientInfo) {
        const balance = await connection.getBalance(config.feeRecipient);
        console.log("   Fee Recipient Balance:", balance / LAMPORTS_PER_SOL, "SOL");
        
        if (balance === 0) {
          console.log("\n⚠️  WARNING: Fee recipient has 0 SOL balance");
          console.log("   Consider funding it for rent exemption");
        }
      }
    }
    
    // Verify authority
    if (!config.authority.equals(wallet.publicKey)) {
      console.log("\n❌ ERROR: Your wallet is not the authority!");
      console.log("   Your Wallet:", wallet.publicKey.toString());
      console.log("   Config Authority:", config.authority.toString());
      console.log("\n   You cannot update the fee recipient without the authority wallet.");
      return;
    }
    
  } catch (error) {
    console.log("\n❌ Config not found! You may need to initialize the launchpad first.");
    console.log("   Error:", error.message);
    return;
  }
  
  // ============================================================================
  // STEP 2: Update fee recipient (if needed)
  // ============================================================================
  
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2: Updating Fee Recipient");
  console.log("=".repeat(80));
  
  // Option 1: Use your authority wallet as fee recipient (recommended)
  const newFeeRecipient = wallet.publicKey;
  
  // Option 2: Use a different wallet (uncomment if needed)
  // const newFeeRecipient = new PublicKey("YOUR_FEE_RECIPIENT_WALLET_HERE");
  
  console.log("\n📝 Update Plan:");
  console.log("   Old Fee Recipient:", config.feeRecipient.toString());
  console.log("   New Fee Recipient:", newFeeRecipient.toString());
  
  // Skip if already correct
  if (config.feeRecipient.equals(newFeeRecipient)) {
    console.log("\n✅ Fee recipient is already set correctly!");
    console.log("   No update needed.");
    return;
  }
  
  // Confirm with user (if running interactively)
  console.log("\n⏳ Updating fee recipient...");
  
  try {
    const tx = await program.methods
      .updateFeeRecipient(newFeeRecipient)
      .accounts({
        config: configPda,
        authority: wallet.publicKey,
      })
      .rpc();
    
    console.log("✅ Transaction successful!");
    console.log("   Signature:", tx);
    console.log("   View on Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");
    
  } catch (error) {
    console.log("\n❌ Transaction failed!");
    console.log("   Error:", error.message);
    
    if (error.toString().includes("2012")) {
      console.log("\n   This is an Unauthorized error (2012)");
      console.log("   Make sure you're using the correct authority wallet.");
    }
    
    throw error;
  }
  
  // ============================================================================
  // STEP 3: Verify the update
  // ============================================================================
  
  console.log("\n" + "=".repeat(80));
  console.log("STEP 3: Verifying Update");
  console.log("=".repeat(80));
  
  // Wait a moment for confirmation
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  const updatedConfig = await program.account.launchpadConfig.fetch(configPda);
  
  console.log("\n✅ Updated Configuration:");
  console.log("   Authority:", updatedConfig.authority.toString());
  console.log("   Fee Recipient:", updatedConfig.feeRecipient.toString());
  console.log("   Platform Fee:", updatedConfig.platformFeeBps, "bps");
  
  if (updatedConfig.feeRecipient.equals(newFeeRecipient)) {
    console.log("\n✅ SUCCESS! Fee recipient updated correctly!");
    console.log("   Your integration should now work without ConstraintMut errors.");
  } else {
    console.log("\n⚠️  WARNING: Fee recipient doesn't match expected value!");
  }
  
  // ============================================================================
  // STEP 4: Test a transaction (optional)
  // ============================================================================
  
  console.log("\n" + "=".repeat(80));
  console.log("STEP 4: Next Steps");
  console.log("=".repeat(80));
  
  console.log("\n✅ Fee recipient has been updated!");
  console.log("\n📝 What to do next:");
  console.log("   1. Test a buy transaction in your integration");
  console.log("   2. Verify fees are being collected correctly");
  console.log("   3. Monitor the fee recipient balance");
  
  console.log("\n🎉 Done! Your integration should now work correctly.");
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function loadWallet(walletPath: string): Wallet {
  try {
    // Expand ~ to home directory
    const expandedPath = walletPath.replace('~', process.env.HOME || '');
    const fs = require('fs');
    const keypairFile = fs.readFileSync(expandedPath, 'utf-8');
    const keypairData = JSON.parse(keypairFile);
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    return new Wallet(keypair);
  } catch (error) {
    console.error("❌ Error loading wallet:", error.message);
    console.error("   Make sure ANCHOR_WALLET is set or update WALLET_PATH in the script");
    process.exit(1);
  }
}

// ============================================================================
// EXAMPLE: Manual Transaction Construction (for advanced users)
// ============================================================================

async function advancedExample() {
  console.log("\n" + "=".repeat(80));
  console.log("ADVANCED EXAMPLE: Manual Transaction Construction");
  console.log("=".repeat(80));
  
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadWallet(WALLET_PATH);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new Program<NotmarketSolana>(
    require("../target/idl/notmarket_solana.json"),
    PROGRAM_ID,
    provider
  );
  
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launchpad_config")],
    PROGRAM_ID
  );
  
  const newFeeRecipient = wallet.publicKey;
  
  // Build transaction manually
  const tx = await program.methods
    .updateFeeRecipient(newFeeRecipient)
    .accounts({
      config: configPda,
      authority: wallet.publicKey,
    })
    .transaction();
  
  // Add compute budget or other instructions if needed
  // tx.add(...);
  
  // Send transaction
  const signature = await provider.sendAndConfirm(tx);
  console.log("   Transaction Signature:", signature);
}

// ============================================================================
// RUN THE SCRIPT
// ============================================================================

if (require.main === module) {
  fixFeeRecipient()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\n❌ Script failed:");
      console.error(error);
      process.exit(1);
    });
}

// Export for use in other scripts
export { fixFeeRecipient };
