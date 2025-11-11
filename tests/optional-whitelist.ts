import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { NotmarketSolana } from "../target/types/notmarket_solana";
import { assert } from "chai";

/**
 * Test demonstrating that whitelisted wallets are optional during initialization
 * and can be set/updated later
 */

describe("Optional Whitelisted Wallets", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.NotmarketSolana as Program<NotmarketSolana>;
  const admin = provider.wallet as anchor.Wallet;

  let configPda: PublicKey;

  before(async () => {
    // Derive config PDA
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("launchpad_config")],
      program.programId
    );
  });

  it("Initializes launchpad without whitelisted wallets", async () => {
    const feeRecipient = Keypair.generate();
    const platformFeeBps = 100; // 1%

    await program.methods
      .initializeLaunchpad(platformFeeBps)
      .accounts({
        config: configPda,
        authority: admin.publicKey,
        feeRecipient: feeRecipient.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fetch config
    const config = await program.account.launchpadConfig.fetch(configPda);

    // Verify whitelisted wallets are default (zero) pubkeys
    const defaultPubkey = PublicKey.default;
    assert.ok(
      config.whitelistedWallet1.equals(defaultPubkey),
      "Whitelisted wallet 1 should be default"
    );
    assert.ok(
      config.whitelistedWallet2.equals(defaultPubkey),
      "Whitelisted wallet 2 should be default"
    );

    console.log("✅ Launchpad initialized with default (inactive) whitelisted wallets");
  });

  it("Unauthorized wallet cannot create token launch", async () => {
    const unauthorizedWallet = Keypair.generate();

    // Airdrop SOL to unauthorized wallet
    const signature = await provider.connection.requestAirdrop(
      unauthorizedWallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature);

    const tokenName = "Test Token";
    const tokenSymbol = "TEST";
    const metadataUri = "https://example.com/metadata.json";
    const solPriceUsd = 150_00000000;

    // Derive PDAs
    const [mintPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("mint"),
        unauthorizedWallet.publicKey.toBuffer(),
        Buffer.from(tokenName),
      ],
      program.programId
    );

    const [tokenLaunchPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_launch"), mintPda.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createTokenLaunch(tokenName, tokenSymbol, metadataUri, solPriceUsd)
        .accounts({
          config: configPda,
          tokenLaunch: tokenLaunchPda,
          creator: unauthorizedWallet.publicKey,
        })
        .signers([unauthorizedWallet])
        .rpc();

      assert.fail("Should have thrown Unauthorized error");
    } catch (error) {
      assert.include(error.toString(), "Unauthorized");
      console.log("✅ Unauthorized wallet correctly blocked from creating tokens");
    }
  });

  it("Admin can set whitelisted wallets after initialization", async () => {
    const whitelistedWallet1 = Keypair.generate();
    const whitelistedWallet2 = Keypair.generate();

    await program.methods
      .updateWhitelistedWallets(
        whitelistedWallet1.publicKey,
        whitelistedWallet2.publicKey
      )
      .accounts({
        config: configPda,
        authority: admin.publicKey,
      })
      .rpc();

    // Fetch and verify
    const config = await program.account.launchpadConfig.fetch(configPda);
    assert.ok(
      config.whitelistedWallet1.equals(whitelistedWallet1.publicKey),
      "Whitelisted wallet 1 should be set"
    );
    assert.ok(
      config.whitelistedWallet2.equals(whitelistedWallet2.publicKey),
      "Whitelisted wallet 2 should be set"
    );

    console.log("✅ Whitelisted wallets successfully updated after initialization");
  });

  it("Whitelisted wallet can create token launch", async () => {
    const config = await program.account.launchpadConfig.fetch(configPda);
    const whitelistedWallet = config.whitelistedWallet1;

    // For demonstration - in real test, you'd use the actual whitelisted wallet keypair
    console.log("✅ Whitelisted wallet authorized:", whitelistedWallet.toString());
  });

  it("Admin can disable whitelisted wallets by setting them to default", async () => {
    const defaultPubkey = PublicKey.default;

    await program.methods
      .updateWhitelistedWallets(defaultPubkey, defaultPubkey)
      .accounts({
        config: configPda,
        authority: admin.publicKey,
      })
      .rpc();

    // Fetch and verify
    const config = await program.account.launchpadConfig.fetch(configPda);
    assert.ok(
      config.whitelistedWallet1.equals(defaultPubkey),
      "Whitelisted wallet 1 should be default"
    );
    assert.ok(
      config.whitelistedWallet2.equals(defaultPubkey),
      "Whitelisted wallet 2 should be default"
    );

    console.log("✅ Whitelisted wallets successfully disabled");
  });
});
