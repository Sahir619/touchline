// Solana Actions (Blinks) plumbing — shared by every /api/actions/** route handler.
// Spec: https://solana.com/docs/advanced/actions (GET metadata, POST signable tx).

import { Connection, clusterApiUrl } from "@solana/web3.js";

function rpcUrl(): string {
  return process.env.NEXT_PUBLIC_SOLANA_RPC ?? clusterApiUrl("devnet");
}

let connection: Connection | null = null;

/** Shared devnet Connection — same RPC the client-side wallet UI already uses. */
export function getConnection(): Connection {
  if (!connection) connection = new Connection(rpcUrl(), "confirmed");
  return connection;
}

let blockchainId: Promise<string> | null = null;

/** CAIP-2 chain id for the `X-Blockchain-Ids` header — fetched once, not hardcoded. */
function getBlockchainId(): Promise<string> {
  if (!blockchainId) {
    blockchainId = getConnection()
      .getGenesisHash()
      .then((hash) => `solana:${hash}`)
      .catch(() => "solana:devnet");
  }
  return blockchainId;
}

export const ACTIONS_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Action-Version, X-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
};

/** Standard response headers for every Action GET/POST/OPTIONS reply. */
export async function actionHeaders(): Promise<HeadersInit> {
  return {
    ...ACTIONS_CORS_HEADERS,
    "Content-Type": "application/json",
    "X-Action-Version": "2.4",
    "X-Blockchain-Ids": await getBlockchainId(),
  };
}

/** Well-known SPL Memo program — used to write an on-chain, wallet-signed proof-of-pick. */
export const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
