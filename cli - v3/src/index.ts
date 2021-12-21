import * as pool_api from './pool_api'
import * as logger from './logger'

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
  LAMPORTS_PER_SOL,
  SystemProgram,
  clusterApiUrl
} from "@solana/web3.js"
import * as bs58 from 'bs58'
import * as splToken from '@solana/spl-token'
import fs from 'fs'
import * as anchor from '@project-serum/anchor'
import moment from 'moment'


const sleep = (ms : number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
};

const n_allInvolvedUsers = 3; // 20
const n_firstStakers = 2; // 15
const n_secondStakers = 1;
const n_unstakers = 1;

const saveInfrastructureForTheFuture = false;
const infrastructureExternalFileName = './infrastructure.json';

let loadedInfrastructure : any = {};

const conn = new Connection("https://api.devnet.solana.com")
const sale_mint = new PublicKey("5Pdw82Xqs6kzSZf2p472LbKb4FqegtQkgoaXCnE4URfa")
const ddd_mint = new PublicKey("FwSgEjN1okgGomujPCLAbS8S3JjpWMGahKEnHoBfjZ5G")



/// This prints balance of DDD, also ownership NFTs and corresponding earnings
async function logAccountBalances(b: any, pool: PublicKey) {
  logger.debug(
  "Bidder : " + b.publicKey.toBase58(), 
  "Stake/DDD balance: ", (await conn.getTokenAccountBalance(b.dddAccount) ).value.uiAmountString,
  "sale: balance", (await conn.getTokenAccountBalance(b.saleAccount) ).value.uiAmountString
 )

  const oNfts = await pool_api.getStakeNftsForOwner(conn, b.publicKey, pool);
  for(const n of oNfts) {
    const w = await pool_api.getWithdrawableAmountForNft(conn, pool, n.mint)
    logger.debug("      ownershipNFT", n.mint.toBase58(), " generated earning ", w);
  }
}


function loadInfrastructure() : any {
  const rawdata = fs.readFileSync(infrastructureExternalFileName);
  const infJSON = JSON.parse(rawdata.toString())
  if(infJSON.bidders.length < n_allInvolvedUsers) {
    throw 'Not enough bidder data in the json file'
  }
  const parsedBidders : any[] = [];
  for(let b of infJSON.bidders) {
    const a = Keypair.fromSecretKey(bs58.decode(b.secretKeyString) );
    parsedBidders.push(
      {
        bidderKeypair: a,
        publicKey: a.publicKey,
        dddAccount: new PublicKey( b.dddAccountString ),
        saleAccount: new PublicKey( b.saleAccountString ),
      })

  }
  return { pool: infJSON.pool, bidders: parsedBidders };
}

async function scenario() {
/*******   Constructing environment   *******/
  logger.debug("+ Constructing Environment...")
  let payerKeypair = Keypair.fromSecretKey(bs58.decode("2pUVo4mVSnebLyLmMTHgPRNbk7rgZki77bsYgbsuuQX9585N4aKNXWJRpyc98qnpgRKRH2hzB8VVnqeffurW39F4"))
  const payer = payerKeypair.publicKey

  const saleMint = new splToken.Token(conn,sale_mint,splToken.TOKEN_PROGRAM_ID,payerKeypair)
  const payerSaleToken = new PublicKey("FrucchR8uxjXDssYh6f2Av5r1wEnp9E65mjTTmTGijBS")

  const dddMint = new splToken.Token(conn,ddd_mint,splToken.TOKEN_PROGRAM_ID,payerKeypair);


  let bidders : any[] = [];

  try {
    loadedInfrastructure = loadInfrastructure();
    logger.debug("Loaded infrastructure data from ", infrastructureExternalFileName)
    bidders = loadedInfrastructure.bidders

    if(loadedInfrastructure.bidders.length < n_allInvolvedUsers) {
      throw Error("Not enough bidders in the " + infrastructureExternalFileName)
    }

  } catch (e) {
    logger.debug("Failed to use infrastructure from ", infrastructureExternalFileName, e)
  }

  if(bidders.length == 0) {
    for(let i = 0; i < n_allInvolvedUsers ; i++) {
      const bidder = Keypair.generate()
      let transaction = new Transaction()
      transaction.add(SystemProgram.transfer({
        fromPubkey : payerKeypair.publicKey,
        toPubkey : bidder.publicKey,
        lamports : LAMPORTS_PER_SOL / 10,
      }))
      // logger.debug("Transfering sol that will be used for gas to account", bidder.publicKey.toBase58())
      await sendAndConfirmTransaction(conn, transaction, [payerKeypair])
      
      // logger.debug("Creating stake and sale token accounts for", bidder.publicKey.toBase58())
      const dddAccount = await dddMint.createAccount(bidder.publicKey)
      const saleAccount = await saleMint.createAccount(bidder.publicKey)
      // logger.debug("Minting stake and sale tokens  for", bidder.publicKey.toBase58())
      await dddMint.mintTo(dddAccount, payerKeypair, [], 200)
      await saleMint.mintTo(saleAccount, payerKeypair, [], 100000)
      logger.debug("Generating bidder " + (i + 1) + " : " + bidder.publicKey.toBase58() + " ---> 200 DDD and 100 sol")
      bidders.push({
        bidderKeypair : bidder, publicKey : bidder.publicKey, dddAccount : dddAccount, saleAccount : saleAccount,
        /// only for easy import/export from external file
        secretKeyString: bs58.encode(bidder.secretKey),
        dddAccountString: dddAccount.toBase58(),
        saleAccountString: saleAccount.toBase58(),
      })
    }
  }

  let pool = undefined;
  // if(loadedInfrastructure && loadedInfrastructure.pool) {
  //   pool = new PublicKey(loadedInfrastructure.pool);
  //   logger.debug("1. No need to Init Pool, it loaded!")
  // } else {
    logger.debug("1. Init Pool")
    pool = await pool_api.initPool(conn,payerKeypair,saleMint.publicKey,dddMint.publicKey,30)
  // }
  logger.debug("pool.toBase58()", pool.toBase58())

  logger.debug("  $$$$$$$$$$  Checking account balances & earnings")
  for(let b of bidders) {
    await logAccountBalances(b, pool);
  }

  if(saveInfrastructureForTheFuture) {
    try {
      const fileName = './infrastructure.json'// + moment().format('MMMMDoYYYYThh:mm:ss') + '.json';
      await fs.writeFile(fileName, JSON.stringify( {
        pool: pool.toBase58(), bidders: bidders
      }), ()=>{} )
      logger.log("Saved the POOL info and bidder users to ", fileName)
    } catch(err) {
      logger.debug("Failed to save infrastructure data :(")
    }
  }
  logger.debug("")
  await pool_api.getPoolLedgerData(conn,pool)
  logger.debug("2. " + n_firstStakers, "+ bidders stake their DDD token")
  let first = n_firstStakers;
  for(let i = 0; i < first; i++) {
    let bidder = bidders[i]
    let amountToStake = 20 + 3 * i;
    if(amountToStake > 50) amountToStake = 50;
    await pool_api.stakeToken(conn,bidder.bidderKeypair, pool, bidder.dddAccount, amountToStake)
    await pool_api.getStakerData(conn,bidder.publicKey,pool)
  }
  await pool_api.getPoolLedgerData(conn,pool)
  logger.debug("")

  logger.debug("3. Send 200 sol to the Pool Bank")
  let now = await pool_api.deposit(conn,payerKeypair,pool, payerSaleToken, 200000)
  logger.debug("deposited at No "+now)
  await pool_api.getPoolLedgerData(conn,pool)

  logger.debug("  $$$$$$$$$$  Checking account balances & earnings")
  for(let b of bidders) {
    await logAccountBalances(b, pool);
  }

  logger.debug("4. "+n_secondStakers, "+ other bidders stake their DDD token")
  for(let i = 0; i < n_secondStakers ; i++) {
    let bidder = bidders[first + i]
    let amountToStake = 20 + 3 * i;
    if(amountToStake > 50) amountToStake = 50;
    await pool_api.stakeToken(conn, bidder.bidderKeypair, pool, bidder.dddAccount, amountToStake)
    await pool_api.getStakerData(conn,bidder.publicKey,pool)
  }
  await pool_api.getPoolLedgerData(conn,pool)
  logger.debug("")

  logger.debug("5. Add 100 sol to Pool Bank")
  now = await pool_api.deposit(conn, payerKeypair, pool, payerSaleToken, 100000)
  logger.debug("deposited at No "+now)
  await pool_api.getPoolLedgerData(conn,pool)

  logger.debug("  $$$$$$$$$$  Checking account balances & earnings")
  for(let b of bidders) {
    await logAccountBalances(b, pool);
  }

  logger.debug("6. "+n_unstakers, "-  bidders unstake their DDD token")
  for(let i = 0; i < n_unstakers; i++) {
    let bidder = bidders[i]
    await pool_api.unstakeTokenAll(conn, bidder.bidderKeypair, pool, bidder.dddAccount)
    logger.debug("unstake  " + i)
    await pool_api.getPoolLedgerData(conn,pool)
  }
  await pool_api.getPoolLedgerData(conn,pool)

  logger.debug("7. Add 300 sol to Pool Bank")
  now = await pool_api.deposit(conn, payerKeypair, pool, payerSaleToken, 300000)
  logger.debug("deposited at No "+now)
  await pool_api.getPoolLedgerData(conn,pool)
}

scenario()