import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Usdc } from "../target/types/usdc";
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import { expect } from "chai";

describe("Mock USDC", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Usdc as Program<Usdc>;
  
  // Generate keypairs for testing
  const mintKeypair = anchor.web3.Keypair.generate();
  const userWallet = anchor.web3.Keypair.generate();
  
  it("Initializes mock USDC mint", async () => {
    // Airdrop SOL to user for rent
    const airdropSignature = await provider.connection.requestAirdrop(
      userWallet.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);

    // Initialize the mint
    const tx = await program.methods
      .initializeMint()
      .accounts({
        mint: mintKeypair.publicKey,
        authority: provider.wallet.publicKey,
      })
      .signers([mintKeypair])
      .rpc();

    console.log("Mock USDC mint initialized:", tx);
    console.log("Mint address:", mintKeypair.publicKey.toString());

    // Verify mint was created with correct decimals
    const mintInfo = await provider.connection.getParsedAccountInfo(
      mintKeypair.publicKey
    );
    
    expect(mintInfo.value).to.not.be.null;
    const data = mintInfo.value?.data as any;
    expect(data.parsed.info.decimals).to.equal(6);
    expect(data.parsed.info.mintAuthority).to.equal(
      provider.wallet.publicKey.toString()
    );
  });

  it("Mints mock USDC tokens to a user", async () => {
    // Get or create associated token account for user
    const userTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      userWallet.publicKey
    );

    // Create the associated token account
    const createAtaIx = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userTokenAccount,
      userWallet.publicKey,
      mintKeypair.publicKey
    );

    const createAtaTx = new anchor.web3.Transaction().add(createAtaIx);
    await provider.sendAndConfirm(createAtaTx);

    // Mint 1000 USDC (with 6 decimals = 1000000000)
    const amount = new anchor.BN(1000_000_000);
    
    const tx = await program.methods
      .mintTo(amount)
      .accounts({
        mint: mintKeypair.publicKey,
        destination: userTokenAccount,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    console.log("Minted mock USDC:", tx);

    // Verify the balance
    const tokenBalance = await provider.connection.getTokenAccountBalance(
      userTokenAccount
    );
    
    expect(tokenBalance.value.amount).to.equal(amount.toString());
    expect(tokenBalance.value.uiAmount).to.equal(1000);
  });

  it("Transfers mock USDC between accounts", async () => {
    // Create another user
    const recipient = anchor.web3.Keypair.generate();
    
    // Airdrop SOL to recipient for rent
    const airdropSignature = await provider.connection.requestAirdrop(
      recipient.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);

    // Get token accounts
    const senderTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      userWallet.publicKey
    );

    const recipientTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      recipient.publicKey
    );

    // Create recipient's token account
    const createAtaIx = createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      recipientTokenAccount,
      recipient.publicKey,
      mintKeypair.publicKey
    );

    const createAtaTx = new anchor.web3.Transaction().add(createAtaIx);
    await provider.sendAndConfirm(createAtaTx);

    // Transfer 100 USDC
    const transferAmount = new anchor.BN(100_000_000);

    const tx = await program.methods
      .transfer(transferAmount)
      .accounts({
        from: senderTokenAccount,
        to: recipientTokenAccount,
        authority: userWallet.publicKey,
      })
      .signers([userWallet])
      .rpc();

    console.log("Transferred mock USDC:", tx);

    // Verify balances
    const senderBalance = await provider.connection.getTokenAccountBalance(
      senderTokenAccount
    );
    const recipientBalance = await provider.connection.getTokenAccountBalance(
      recipientTokenAccount
    );

    expect(senderBalance.value.uiAmount).to.equal(900); // 1000 - 100
    expect(recipientBalance.value.uiAmount).to.equal(100);
  });

  it("Can mint additional tokens (simulating faucet)", async () => {
    const userTokenAccount = await getAssociatedTokenAddress(
      mintKeypair.publicKey,
      userWallet.publicKey
    );

    // Get initial balance
    const initialBalance = await provider.connection.getTokenAccountBalance(
      userTokenAccount
    );

    // Mint 5000 more USDC
    const additionalAmount = new anchor.BN(5000_000_000);
    
    await program.methods
      .mintTo(additionalAmount)
      .accounts({
        mint: mintKeypair.publicKey,
        destination: userTokenAccount,
        authority: provider.wallet.publicKey,
      })
      .rpc();

    // Verify new balance
    const newBalance = await provider.connection.getTokenAccountBalance(
      userTokenAccount
    );
    
    const expectedBalance = 
      parseInt(initialBalance.value.amount) + additionalAmount.toNumber();
    
    expect(newBalance.value.amount).to.equal(expectedBalance.toString());
    console.log(
      `Balance increased from ${initialBalance.value.uiAmount} to ${newBalance.value.uiAmount} USDC`
    );
  });
});
