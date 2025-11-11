import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { NotmarketSolana } from "../target/types/notmarket_solana";

/**
 * Example script demonstrating admin and whitelist management
 */

async function main() {
  // Configure the client
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NotmarketSolana as Program<NotmarketSolana>;
  
  // Admin wallet (current authority)
  const admin = provider.wallet as anchor.Wallet;
  console.log("Admin:", admin.publicKey.toString());

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launchpad_config")],
    program.programId
  );
  console.log("Config PDA:", configPda.toString());

  // ============================================================================
  // Example 1: Update Whitelisted Wallets
  // ============================================================================
  
  console.log("\n=== Example 1: Update Whitelisted Wallets ===");
  
  // Generate new whitelisted wallets (or use existing ones)
  const whitelistedWallet1 = Keypair.generate();
  const whitelistedWallet2 = Keypair.generate();
  
  console.log("Whitelisted Wallet 1:", whitelistedWallet1.publicKey.toString());
  console.log("Whitelisted Wallet 2:", whitelistedWallet2.publicKey.toString());
  
  try {
    const tx1 = await program.methods
      .updateWhitelistedWallets(
        whitelistedWallet1.publicKey,
        whitelistedWallet2.publicKey
      )
      .accounts({
        config: configPda,
        authority: admin.publicKey,
      })
      .rpc();
    
    console.log("✅ Whitelisted wallets updated!");
    console.log("Transaction signature:", tx1);
    
    // Fetch and verify the config
    const config = await program.account.launchpadConfig.fetch(configPda);
    console.log("\nUpdated Config:");
    console.log("  Authority:", config.authority.toString());
    console.log("  Whitelisted Wallet 1:", config.whitelistedWallet1.toString());
    console.log("  Whitelisted Wallet 2:", config.whitelistedWallet2.toString());
  } catch (error) {
    console.error("❌ Failed to update whitelisted wallets:", error);
  }

  // ============================================================================
  // Example 2: Update Admin Authority
  // ============================================================================
  
  console.log("\n=== Example 2: Update Admin Authority ===");
  
  // Generate new admin wallet (or use existing one)
  const newAdmin = Keypair.generate();
  console.log("New Admin:", newAdmin.publicKey.toString());
  
  try {
    const tx2 = await program.methods
      .updateAdmin(newAdmin.publicKey)
      .accounts({
        config: configPda,
        authority: admin.publicKey,
        newAuthority: newAdmin.publicKey,
      })
      .rpc();
    
    console.log("✅ Admin authority updated!");
    console.log("Transaction signature:", tx2);
    
    // Fetch and verify the config
    const config = await program.account.launchpadConfig.fetch(configPda);
    console.log("\nUpdated Config:");
    console.log("  Old Authority:", admin.publicKey.toString());
    console.log("  New Authority:", config.authority.toString());
    console.log("  Match:", config.authority.equals(newAdmin.publicKey));
  } catch (error) {
    console.error("❌ Failed to update admin authority:", error);
  }

  // ============================================================================
  // Example 3: Check Authorization
  // ============================================================================
  
  console.log("\n=== Example 3: Check Authorization ===");
  
  try {
    const config = await program.account.launchpadConfig.fetch(configPda);
    
    // Helper function to check if a wallet is authorized
    const isAuthorized = (wallet: PublicKey): boolean => {
      return (
        wallet.equals(config.authority) ||
        wallet.equals(config.whitelistedWallet1) ||
        wallet.equals(config.whitelistedWallet2)
      );
    };
    
    console.log("\nAuthorization Status:");
    console.log("  Admin authorized:", isAuthorized(config.authority));
    console.log("  Wallet 1 authorized:", isAuthorized(config.whitelistedWallet1));
    console.log("  Wallet 2 authorized:", isAuthorized(config.whitelistedWallet2));
    
    // Test with a random wallet
    const randomWallet = Keypair.generate();
    console.log("  Random wallet authorized:", isAuthorized(randomWallet.publicKey));
  } catch (error) {
    console.error("❌ Failed to check authorization:", error);
  }

  // ============================================================================
  // Example 4: Create Token Launch as Whitelisted Wallet
  // ============================================================================
  
  console.log("\n=== Example 4: Create Token Launch as Whitelisted Wallet ===");
  console.log("Note: This example shows the structure but won't execute without proper setup");
  
  const exampleCode = `
  // Airdrop SOL to whitelisted wallet for testing
  const signature = await provider.connection.requestAirdrop(
    whitelistedWallet1.publicKey,
    2 * anchor.web3.LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(signature);
  
  const tokenName = "Example Token";
  const tokenSymbol = "EXMPL";
  const metadataUri = "https://example.com/metadata.json";
  const solPriceUsd = 150_00000000; // $150 with 8 decimals
  
  // Derive PDAs
  const [mintPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("mint"),
      whitelistedWallet1.publicKey.toBuffer(),
      Buffer.from(tokenName),
    ],
    program.programId
  );
  
  const [tokenLaunchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_launch"), mintPda.toBuffer()],
    program.programId
  );
  
  const [bondingCurvePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding_curve"), tokenLaunchPda.toBuffer()],
    program.programId
  );
  
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), bondingCurvePda.toBuffer()],
    program.programId
  );
  
  // Create token launch
  const tx = await program.methods
    .createTokenLaunch(tokenName, tokenSymbol, metadataUri, solPriceUsd)
    .accounts({
      config: configPda, // Required for authorization check
      tokenLaunch: tokenLaunchPda,
      mint: mintPda,
      bondingCurve: bondingCurvePda,
      curveTokenAccount: await getAssociatedTokenAddress(
        mintPda,
        bondingCurvePda,
        true
      ),
      solVault: solVaultPda,
      creator: whitelistedWallet1.publicKey, // Whitelisted wallet
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([whitelistedWallet1])
    .rpc();
  
  console.log("✅ Token launch created by whitelisted wallet!");
  console.log("Transaction signature:", tx);
  `;
  
  console.log(exampleCode);
}

main()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
