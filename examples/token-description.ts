import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { NotmarketSolana } from "../target/types/notmarket_solana";

/**
 * Example demonstrating token description functionality
 */

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NotmarketSolana as Program<NotmarketSolana>;
  const creator = provider.wallet as anchor.Wallet;

  console.log("Creator:", creator.publicKey.toString());

  // ============================================================================
  // Example 1: Create Token Launch with Description
  // ============================================================================
  
  console.log("\n=== Example 1: Create Token Launch with Description ===");
  
  const tokenName = "Example Token";
  const tokenSymbol = "EXMPL";
  const metadataUri = "https://example.com/metadata.json";
  const description = "This is an example token created on the NotMarket platform. It demonstrates the new description field that can store up to 500 characters of information about the token, including its purpose, utility, and features.";
  const solPriceUsd = new anchor.BN(150_00000000); // $150 with 8 decimals

  // Derive config PDA
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("launchpad_config")],
    program.programId
  );

  // Derive mint PDA
  const [mintPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("mint"),
      creator.publicKey.toBuffer(),
      Buffer.from(tokenName),
    ],
    program.programId
  );

  // Derive token launch PDA
  const [tokenLaunchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_launch"), mintPda.toBuffer()],
    program.programId
  );

  // Derive bonding curve PDA
  const [bondingCurvePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bonding_curve"), tokenLaunchPda.toBuffer()],
    program.programId
  );

  // Derive sol vault PDA
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("sol_vault"), bondingCurvePda.toBuffer()],
    program.programId
  );

  console.log("\nToken Details:");
  console.log("  Name:", tokenName);
  console.log("  Symbol:", tokenSymbol);
  console.log("  Description:", description);
  console.log("  Description Length:", description.length, "characters");

  // Note: This is a skeleton example - you would need to provide all required accounts
  const exampleCreateCode = `
  const tx = await program.methods
    .createTokenLaunch(
      tokenName,
      tokenSymbol,
      metadataUri,
      description,  // New description parameter
      solPriceUsd
    )
    .accounts({
      config: configPda,
      tokenLaunch: tokenLaunchPda,
      mint: mintPda,
      bondingCurve: bondingCurvePda,
      curveTokenAccount: curveTokenAccountPda,
      solVault: solVaultPda,
      creator: creator.publicKey,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log("Token launch created with description!");
  console.log("Transaction:", tx);
  `;

  console.log("\nExample Code:", exampleCreateCode);

  // ============================================================================
  // Example 2: Fetch Token Launch and View Description
  // ============================================================================
  
  console.log("\n=== Example 2: Fetch Token Launch and View Description ===");

  try {
    // Attempt to fetch the token launch
    const tokenLaunch = await program.account.tokenLaunch.fetch(tokenLaunchPda);
    
    console.log("\nToken Launch Details:");
    console.log("  Name:", tokenLaunch.name);
    console.log("  Symbol:", tokenLaunch.symbol);
    console.log("  Description:", tokenLaunch.description);
    console.log("  Creator:", tokenLaunch.creator.toString());
    console.log("  Metadata URI:", tokenLaunch.metadataUri);
    console.log("  Total Supply:", tokenLaunch.totalSupply.toString());
    console.log("  Active:", tokenLaunch.isActive);
  } catch (error) {
    console.log("Token launch not found (this is expected for a new example)");
  }

  // ============================================================================
  // Example 3: Update Token Description
  // ============================================================================
  
  console.log("\n=== Example 3: Update Token Description ===");

  const newDescription = "Updated description: This token has evolved! New features and utilities have been added. The description field allows token creators to keep their community informed about changes, updates, and new developments.";

  console.log("\nNew Description:", newDescription);
  console.log("New Description Length:", newDescription.length, "characters");

  const exampleUpdateCode = `
  const tx = await program.methods
    .updateDescription(newDescription)
    .accounts({
      tokenLaunch: tokenLaunchPda,
      creator: creator.publicKey,
    })
    .rpc();

  console.log("Description updated!");
  console.log("Transaction:", tx);
  
  // Fetch the updated token launch
  const updatedTokenLaunch = await program.account.tokenLaunch.fetch(tokenLaunchPda);
  console.log("Updated Description:", updatedTokenLaunch.description);
  `;

  console.log("\nExample Code:", exampleUpdateCode);

  // ============================================================================
  // Example 4: Description Validation
  // ============================================================================
  
  console.log("\n=== Example 4: Description Validation ===");

  const maxDescriptionLength = 500;
  const validDescription = "A".repeat(maxDescriptionLength);
  const invalidDescription = "A".repeat(maxDescriptionLength + 1);

  console.log("\nValidation Examples:");
  console.log("  Max allowed length:", maxDescriptionLength, "characters");
  console.log("  Valid description length:", validDescription.length, "✅");
  console.log("  Invalid description length:", invalidDescription.length, "❌ (too long)");

  // ============================================================================
  // Example 5: Description in Events
  // ============================================================================
  
  console.log("\n=== Example 5: Description in Events ===");

  const eventExample = `
  // When a token is created, the TokenLaunchCreated event includes the description
  program.addEventListener("TokenLaunchCreated", (event) => {
    console.log("Token Created:");
    console.log("  Name:", event.name);
    console.log("  Symbol:", event.symbol);
    console.log("  Description:", event.description);
    console.log("  Launch:", event.launch.toString());
  });

  // When description is updated, the DescriptionUpdated event is emitted
  program.addEventListener("DescriptionUpdated", (event) => {
    console.log("Description Updated:");
    console.log("  Launch:", event.launch.toString());
    console.log("  New Description:", event.newDescription);
    console.log("  Updated By:", event.updatedBy.toString());
    console.log("  Timestamp:", new Date(event.timestamp * 1000).toISOString());
  });
  `;

  console.log(eventExample);

  // ============================================================================
  // Summary
  // ============================================================================
  
  console.log("\n=== Summary ===");
  console.log("✅ Description field added to TokenLaunch account");
  console.log("✅ Maximum length: 500 characters");
  console.log("✅ Can be set during token creation");
  console.log("✅ Can be updated by token creator using update_description instruction");
  console.log("✅ Included in TokenLaunchCreated event");
  console.log("✅ New DescriptionUpdated event emitted on updates");
  console.log("✅ Validation prevents descriptions longer than 500 characters");
}

main()
  .then(() => {
    console.log("\n✅ Example completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
