// TxLINE authentication — guest JWT + on-chain subscribe + activate → API token.
// Ports the proven flow in _extracted/txline_reference/txline_subscribe_activate_probe.cjs
// (verified live on devnet 2026-06-27). All data calls then send BOTH the JWT and the
// X-Api-Token; do this ONCE under a single server-side app wallet.

import { readFileSync } from 'node:fs';
import * as anchor from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

// Read the devnet IDL at runtime (avoids JSON import-attribute friction in tsx/ESM).
const idl = JSON.parse(
  readFileSync(new URL('./txoracle.devnet.idl.json', import.meta.url), 'utf8'),
) as anchor.Idl & { constants: Array<{ name: string; value: string }> };

const TXLINE_MINT = new PublicKey(
  idl.constants.find((c) => c.name === 'TXLINE_MINT')!.value,
);

export interface SubscribeActivateParams {
  /** Solana RPC URL (devnet). */
  rpc: string;
  /** base58-encoded 64-byte secret key for the single app wallet. */
  walletSecret: string;
  /** TxLINE auth host (devnet: https://txline-dev.txodds.com). */
  authHost: string;
  /** Free World Cup tier = 1. */
  serviceLevelId?: number;
  /** Must be a multiple of 4 (program enforces it). */
  weeks?: number;
  /** Empty for the standard/free bundle. */
  leagues?: number[];
}

export interface TxLineCredentials {
  jwt: string;
  apiToken: string;
  wallet: Keypair;
}

/** Bootstrap an anonymous guest JWT (30-day expiry). */
export async function getGuestToken(authHost: string): Promise<string> {
  const res = await fetch(`${authHost}/auth/guest/start`, { method: 'POST' });
  if (!res.ok) {
    throw new Error(`guest/start failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('guest/start returned no token');
  return body.token;
}

/**
 * Full one-time access flow: guest JWT → on-chain `subscribe(serviceLevelId, weeks)`
 * (free row charges 0 TxL) → sign `${txSig}:${leagues}:${jwt}` → POST /api/token/activate.
 * Returns the long-lived `txoracle_api_…` token plus the JWT used to mint it.
 */
export async function subscribeAndActivate(
  params: SubscribeActivateParams,
): Promise<TxLineCredentials> {
  const {
    rpc,
    walletSecret,
    authHost,
    serviceLevelId = 1,
    weeks = 4,
    leagues = [],
  } = params;

  if (weeks % 4 !== 0) throw new Error('weeks must be a multiple of 4');

  const connection = new Connection(rpc, 'confirmed');
  const kp = Keypair.fromSecretKey(bs58.decode(walletSecret));
  const wallet = new anchor.Wallet(kp);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });
  const program = new anchor.Program(idl as anchor.Idl, provider);

  // Ensure the user's Token-2022 TxL ATA exists (rent paid from the wallet).
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    kp,
    TXLINE_MINT,
    kp.publicKey,
    false,
    'confirmed',
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pricing_matrix')],
    program.programId,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_treasury_v2')],
    program.programId,
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    TXLINE_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
  );

  // subscribe(service_level_id: u16, weeks: u8). Methods are untyped on a generic
  // Program<Idl>, so the call is cast to keep this strict-mode clean.
  const txSig: string = await (program.methods as any)
    .subscribe(serviceLevelId, weeks)
    .accounts({
      user: kp.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: TXLINE_MINT,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  // Guest JWT used both to sign the binding message and to authorize activation.
  const jwt = await getGuestToken(authHost);
  const messageString = `${txSig}:${leagues.join(',')}:${jwt}`;
  const walletSignature = Buffer.from(
    nacl.sign.detached(new TextEncoder().encode(messageString), kp.secretKey),
  ).toString('base64');

  const actRes = await fetch(`${authHost}/api/token/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  const actText = await actRes.text();
  if (!actRes.ok) {
    throw new Error(`activate failed: ${actRes.status} ${actText}`);
  }
  // Activation returns either a bare token string or { token }.
  let apiToken = actText;
  try {
    const parsed = JSON.parse(actText) as { token?: string };
    if (parsed.token) apiToken = parsed.token;
  } catch {
    /* plain-text token */
  }

  return { jwt, apiToken, wallet: kp };
}
