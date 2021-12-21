
import {
  Connection,
  Keypair,
  Signer,
  PublicKey,
  Transaction,
  TransactionSignature,
  ConfirmOptions,
  sendAndConfirmRawTransaction,
  sendAndConfirmTransaction,
  RpcResponseAndContext,
  SimulatedTransactionResponse,
  Commitment,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY
} from "@solana/web3.js";
import * as splToken from '@solana/spl-token'
import fs from 'fs'
import * as anchor from '@project-serum/anchor'
import moment from 'moment'
import * as logger from './logger'

const confirmOption : ConfirmOptions = {
    commitment : 'finalized',
    preflightCommitment : 'finalized',
    skipPreflight : false
}

const sleep = (ms : number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

export let programId = new PublicKey('Ebo3DJjKqeLyZripRcEfbjdhtSENa5xCCXy8YxLUQiuG')
const idl=JSON.parse(fs.readFileSync('src/solana_anchor.json','utf8'))
const POOL_LEDGER_SIZE =8 +32+8+8+ 17 * 365 * 10;
const LEDGER_SEED = "Ledger"

const getTokenWallet = async (
  wallet: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey
) => {
  return (
    await anchor.web3.PublicKey.findProgramAddress(
      [wallet.toBuffer(), splToken.TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
      splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
    )
  )[0];
}

const createAssociatedTokenAccountInstruction = (
  associatedTokenAddress: anchor.web3.PublicKey,
  payer: anchor.web3.PublicKey,
  walletAddress: anchor.web3.PublicKey,
  splTokenMintAddress: anchor.web3.PublicKey
) => {
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
    { pubkey: walletAddress, isSigner: false, isWritable: false },
    { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
    { pubkey: splToken.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    {
      pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
      isSigner: false,
      isWritable: false,
    },
  ];
  return new anchor.web3.TransactionInstruction({
    keys,
    programId: splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([]),
  });
}

export async function initPool(
    conn : Connection,
    owner : Keypair,
    sale_mint : PublicKey,
    stake_mint : PublicKey,
    period : number,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let randomPubkey = Keypair.generate().publicKey
    let [pool, bump] = await PublicKey.findProgramAddress(
        [randomPubkey.toBuffer()],
        programId
    )
    let saleMint = new splToken.Token(conn,sale_mint,splToken.TOKEN_PROGRAM_ID,owner)
    let saleAccount = await saleMint.createAccount(pool)
    let stakeMint = new splToken.Token(conn,stake_mint,splToken.TOKEN_PROGRAM_ID,owner)
    let stakeAccount = await stakeMint.createAccount(pool)

    let transaction = new Transaction()
    let lamports = await conn.getMinimumBalanceForRentExemption(POOL_LEDGER_SIZE)
    let poolLedger = Keypair.generate()
    transaction.add(SystemProgram.createAccount({
        fromPubkey : owner.publicKey,
        lamports : lamports,
        newAccountPubkey : poolLedger.publicKey,
        programId : programId,
        space : POOL_LEDGER_SIZE,
    }))
    const tx = await sendAndConfirmTransaction(conn,transaction,[owner,poolLedger],confirmOption)
    // let poolLedger = await PublicKey.createWithSeed(owner.publicKey,LEDGER_SEED,programId)
    // transaction.add(SystemProgram.createAccountWithSeed({
    //     basePubkey : owner.publicKey,
    //     fromPubkey : owner.publicKey,
    //     lamports : lamports,
    //     newAccountPubkey : poolLedger,
    //     programId : programId,
    //     seed : LEDGER_SEED,
    //     space :  POOL_LEDGER_SIZE,
    // }))
    // const tx = await sendAndConfirmTransaction(conn,transaction,[owner],confirmOption)
    // logger.debug("    TX: Create poolLedger account tx: ", tx)

    // let [poolLedger, bump2] = await PublicKey.findProgramAddress([Buffer.from(LEDGER_SEED),pool.toBuffer()],programId)
    let now = moment().startOf('minute')
    logger.log("Start date in the pool ledger is  ", now.format('MMMMDoYYYYThh:mm:ss') )

    try {
        const tx = await program.rpc.initPool(
            new anchor.BN(bump),
            new anchor.BN( now.unix() ),
            new anchor.BN(period),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolLedger.publicKey,
                    rand : randomPubkey,
                    saleMint : sale_mint,
                    saleAccount : saleAccount,
                    stakeMint : stake_mint,
                    stakeAccount : stakeAccount,
                    systemProgram :  anchor.web3.SystemProgram.programId,
                },
                signers: [owner]
            }
        )
        logger.log("    TX: program.rpc.initPool", tx)
    } catch(err) {
        logger.debug(err)
    }
    logger.debug("poolLedger.publicKey.toBase58()", poolLedger.publicKey.toBase58())
    return pool
}

export async function stakeToken(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    stakeAccount : PublicKey,
    amount : number,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    
    // let nft_mint = await splToken.Token.createMint(conn,owner,owner.publicKey,null,0,splToken.TOKEN_PROGRAM_ID)
    // let nft_account = await nft_mint.createAccount(owner.publicKey)
    // await nft_mint.mintTo(nft_account,owner,[],1)
    let nft_mint = Keypair.generate()
    let rent = await conn.getMinimumBalanceForRentExemption(splToken.MintLayout.span)
    let nft_account = await getTokenWallet(owner.publicKey,nft_mint.publicKey)
    let [metadataExtended,bump] = await PublicKey.findProgramAddress([nft_mint.publicKey.toBuffer()],programId)

    let transaction = new Transaction()
    transaction.add(
        SystemProgram.createAccount({
            fromPubkey : owner.publicKey,
            newAccountPubkey : nft_mint.publicKey,
            space : splToken.MintLayout.span,
            lamports : rent,
            programId : splToken.TOKEN_PROGRAM_ID,
        }),
        splToken.Token.createInitMintInstruction(
            splToken.TOKEN_PROGRAM_ID,
            nft_mint.publicKey,
            0,
            owner.publicKey,
            owner.publicKey
        ),
        createAssociatedTokenAccountInstruction(
            nft_account,
            owner.publicKey,
            owner.publicKey,
            nft_mint.publicKey,
        ),
        splToken.Token.createMintToInstruction(
            splToken.TOKEN_PROGRAM_ID,
            nft_mint.publicKey,
            nft_account,
            owner.publicKey,
            [],
            1
        ),
    )
    const tx = await sendAndConfirmTransaction(conn,transaction,[owner,nft_mint],confirmOption)
    try{
        const tx = await program.rpc.stakeToken(
            new anchor.BN(bump),
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    sourceStakeAccount : stakeAccount,
                    destStakeAccount : poolData.stakeAccount,
                    nftMint : nft_mint.publicKey,
                    metadataExtended : metadataExtended,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    systemProgram : anchor.web3.SystemProgram.programId,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
        logger.log("    TX: program.rpc.stakeToken", tx)
        logger.log("NFT Address : ", nft_mint.publicKey.toBase58())

    } catch(err) {
        logger.debug(err)
    }
    return nft_mint.publicKey     
}

export async function unstakeToken(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    stakeAccount : PublicKey,
    nft_mint : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    
    let nft_account = await getTokenWallet(owner.publicKey, nft_mint)
    let [metadataExtended,bump] = await PublicKey.findProgramAddress([nft_mint.toBuffer()],programId)
    try{
        await program.rpc.unstakeToken(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    nftMint : nft_mint,
                    nftAccount : nft_account,
                    metadataExtended : metadataExtended,
                    sourceStakeAccount : poolData.stakeAccount,
                    destStakeAccount : stakeAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        logger.debug(err)
    }     
}

export async function unstakeTokenAll(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    stakeAccount : PublicKey,
    ){
    let stakedNfts = await getStakeNftsForOwner(conn, owner.publicKey, pool)
    for(let nft of stakedNfts){
        await unstakeToken(conn,owner,pool,stakeAccount,nft.mint)
    }    
}

export async function deposit(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    saleAccount : PublicKey,
    amount : number,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    try {
        const tx = await program.rpc.deposit(
            new anchor.BN(amount),
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    sourceSaleAccount : saleAccount,
                    destSaleAccount : poolData.saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
        logger.debug("    TX: program.rpc.deposit tx: ", tx)
    } catch(err) {
        logger.debug(err)
    }
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    return poolLedgerData.lastNumber.toNumber()       
}

export async function withdraw(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    saleAccount : PublicKey,
    nft_mint : PublicKey,
    ){
    let wallet = new anchor.Wallet(owner)
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let nft_account = await getTokenWallet(owner.publicKey, nft_mint)
    let [metadataExtended,bump] = await PublicKey.findProgramAddress([nft_mint.toBuffer()],programId)    
    try{
        await program.rpc.withdraw(
            {
                accounts:{
                    owner : owner.publicKey,
                    pool : pool,
                    poolLedger : poolData.poolLedger,
                    nftMint : nft_mint,
                    nftAccount : nft_account,
                    metadataExtended : metadataExtended,
                    sourceSaleAccount : poolData.saleAccount,
                    destSaleAccount : saleAccount,
                    tokenProgram : splToken.TOKEN_PROGRAM_ID,
                    clock : SYSVAR_CLOCK_PUBKEY,
                },
                signers:[owner]
            }
        )
    } catch(err) {
        logger.debug(err)
    }       
}

export async function withdrawAll(
    conn : Connection,
    owner : Keypair,
    pool : PublicKey,
    saleAccount : PublicKey,
    ){
    let stakedNfts = await getStakeNftsForOwner(conn, owner.publicKey, pool)
    for(let nft of stakedNfts){
        await withdraw(conn,owner,pool,saleAccount,nft.mint)
    }
}

export async function getPoolData(
    conn : Connection,
    pool : PublicKey,
    ) {
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn, wallet,confirmOption)
    const program = new anchor.Program(idl, programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    logger.debug("---------- Pool Data ---------")
    logger.debug("Pool owner : " + poolData.owner.toBase58())
    logger.debug("Pool ledger account : " + poolData.poolLedger.toBase58())
    logger.debug("Pool ledger last number : " + poolData.poolLedger.lastNumber )

    logger.debug("Sale token mint : " + poolData.saleMint.toBase58())
    logger.debug("Sale token account : " + poolData.saleAccount.toBase58())
    logger.debug("Sale token balance : ", 
        (await conn.getTokenAccountBalance(poolData.saleAccount) ).value.uiAmountString )

    logger.debug("Stake token mint: " + poolData.stakeMint.toBase58())
    logger.debug("Stake token account: " + poolData.stakeAccount.toBase58())
    logger.debug("Stake token balance : ", 
        (await conn.getTokenAccountBalance(poolData.stakeAccount) ).value.uiAmountString )

    logger.debug("Start at : " + poolData.startAt.toNumber())
    logger.debug("Period : " + poolData.period.toNumber())
    
    // logger.debug(poolData)
}

export async function getPoolLedgerData(
    conn : Connection,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    logger.debug("@@@@ Pool Ledger Data: LastNo : " + poolLedgerData.lastNumber.toNumber())
    let last = poolLedgerData.lastNumber.toNumber()
    let start = last > 6 ? last-6 : 0;
    for(let i = start; i< last + 2; i++){
        let ledger = poolLedgerData.ledger[i]
        if(i != last){
            if(ledger.changed)
                logger.debug("No "+i+" : "+ledger.totalStakeToken.toNumber()+"(DDD token) and "+ledger.income.toNumber()+"(sol)")
            else
                logger.debug("No "+i+" : Unchanged")
        }
        else{
            if(ledger.changed)
                logger.debug("No "+i+" : "+ledger.totalStakeToken.toNumber()+"(DDD token) and "+ledger.income.toNumber()+"(sol)  -----   Currect Time")
            else
                logger.debug("No "+i+" : Unchanged  -----   Currect Time")
        }
    }         
}


export async function getStakerData(
    conn : Connection,
    owner : PublicKey,
    pool : PublicKey,
    ){
    let nfts = await getStakeNftsForOwner(conn,owner,pool)
    logger.debug("NFTs of "+owner.toBase58())
    for(let nft of nfts){
        logger.debug("NFT : "+nft.mint.toBase58()+", Values : "+nft.values+", CreatedNumber : "+nft.number)
    }
}
// export async function getTokenBalance(
//     conn : Connection,
//     tokenAccount : PublicKey,
//     ){
//     let amount = (await conn.getTokenAccountBalance(tokenAccount)).value.uiAmount
//     logger.debug(tokenAccount.toBase58() + " - " + amount)
// }

export async function getStakeNftsForOwner(
    conn: Connection,
    owner: PublicKey,
    pool : PublicKey,
    ){
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    const allTokens: any = []
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(owner, {
        programId: splToken.TOKEN_PROGRAM_ID
    });
    for (let index = 0; index < tokenAccounts.value.length; index++) {
        const tokenAccount = tokenAccounts.value[index];
        const tokenAmount = tokenAccount.account.data.parsed.info.tokenAmount;
        const mint = new PublicKey(tokenAccount.account.data.parsed.info.mint)
        if (tokenAmount.amount == "1" && tokenAmount.decimals == "0") {
            let [metadataExtended,bump] = await PublicKey.findProgramAddress([mint.toBuffer()],programId)
            if((await conn.getAccountInfo(metadataExtended)) == null) continue;
            try {
                let metadataExtendedData = await program.account.metadataExtended.fetch(metadataExtended)
                if(metadataExtendedData.pool.toBase58() == pool.toBase58() && metadataExtendedData.values.toNumber() != 0){
                    allTokens.push({
                        mint : mint,
                        values : metadataExtendedData.values.toNumber(),
                        number : metadataExtendedData.number.toNumber(),
                        withdrawNumber : metadataExtendedData.number.toNumber(),
                    })
                }
            } catch (err) {

            }
        } else {
            /// tokenAmount does not have NFT-like balance
        }
    }
    return allTokens
}

export async function getWithdrawableAmountForNft(
    conn : Connection,
    pool : PublicKey,
    nftMint : PublicKey,
    ) {
    let wallet = new anchor.Wallet(Keypair.generate())
    let provider = new anchor.Provider(conn,wallet,confirmOption)
    const program = new anchor.Program(idl,programId,provider)
    let poolData = await program.account.pool.fetch(pool)
    let poolLedgerData = await program.account.poolLedger.fetch(poolData.poolLedger)
    let [metadataExtended,bump] = await PublicKey.findProgramAddress([nftMint.toBuffer()],programId)
    try {
        let metadataExtendedData = await program.account.metadataExtended.fetch(metadataExtended)
        let amount = metadataExtendedData.values.toNumber()
        if(metadataExtendedData.pool.toBase58() != pool.toBase58() || amount == 0) return 0
        let first = metadataExtendedData.withdrawNumber.toNumber()
        let last = Math.floor((moment().unix() - poolData.startAt.toNumber()) / poolData.period.toNumber())
        let total = 0
        for(let i = first ; i <= last; i++){
            let ledger = poolLedgerData.ledger[i]
            if(!ledger.changed || ledger.income.toNumber() == 0) continue
            if(ledger.totalStakeToken.toNumber()!=0)
                total += Math.ceil(ledger.income.toNumber() * amount / ledger.totalStakeToken.toNumber())
        }
        return total;        
    } catch(err) {
        return 0
    }
}

export async function predictWithdrawableAmount(
    conn : Connection,
    owner : PublicKey,
    pool : PublicKey,
    ){
    let stakedNfts = await getStakeNftsForOwner(conn,owner,pool)
    let total = 0;
    for(let nft of stakedNfts){
        total += await getWithdrawableAmountForNft(conn,pool,nft.mint)
    }

    return total
}