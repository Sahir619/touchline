// Solana Action for a Touchline fixture — "share your pick / challenge a friend" as a
// Blink. GET returns interactive metadata (unfurled card); POST returns an unsigned,
// wallet-signable devnet transaction. No server-held keys are ever used: the friend's
// own wallet pays the (tiny) devnet fee and signs a Memo instruction that's a real,
// verifiable on-chain proof of their call — the on-chain edge a Web2 rival can't fake.
import { type NextRequest } from "next/server";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { decimalOdds } from "@touchline/shared";
import { getFixture, getFixtureOdds, type Selection } from "@/lib/game";
import { actionHeaders, getConnection, MEMO_PROGRAM_ID } from "@/lib/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEL_INDEX: Record<Selection, number> = { part1: 0, draw: 1, part2: 2 };
const SEL_LABEL: Record<Selection, "1" | "X" | "2"> = { part1: "1", draw: "X", part2: "2" };
const SELECTIONS: Selection[] = ["part1", "draw", "part2"];

function isSelection(v: string | null): v is Selection {
  return v === "part1" || v === "draw" || v === "part2";
}

function labelFor(fx: { participant1: string; participant2: string }, sel: Selection): string {
  return sel === "draw" ? "Draw" : sel === "part1" ? fx.participant1 : fx.participant2;
}

export async function OPTIONS() {
  return new Response(null, { headers: await actionHeaders() });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId: raw } = await params;
  const fixtureId = Number(raw);
  const headers = await actionHeaders();
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return Response.json({ message: "Invalid fixture" }, { status: 400, headers });
  }

  const [fxRes, odds] = await Promise.all([getFixture(fixtureId), getFixtureOdds(fixtureId)]);
  if (!fxRes?.fixture) {
    return Response.json({ message: "Match not found" }, { status: 404, headers });
  }
  const fx = fxRes.fixture;
  const oneX2 = odds.find((m) => m.superOddsType === "1X2_PARTICIPANT_RESULT" && m.prices?.length === 3);
  const prices = oneX2?.prices ?? null;

  const by = request.nextUrl.searchParams.get("by");
  const started = fx.startTime <= Date.now();
  const origin = request.nextUrl.origin;
  const kickoff = new Date(fx.startTime).toLocaleString("en-GB", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const actions = SELECTIONS.map((sel) => {
    const price = prices?.[SEL_INDEX[sel]];
    const odd = price != null ? decimalOdds(price) : null;
    const label = labelFor(fx, sel);
    return {
      label: odd ? `${label} · ${odd.toFixed(2)}×` : label,
      href: `/api/actions/pick/${fixtureId}?selection=${sel}${by ? `&by=${encodeURIComponent(by)}` : ""}`,
    };
  });

  const body: Record<string, unknown> = {
    icon: `${origin}/icon.svg`,
    title: `${fx.participant1} vs ${fx.participant2}`,
    label: started ? "Match underway" : "Make your call",
    disabled: started,
    description: started
      ? `Kicked off ${kickoff}. This challenge has closed. Head to Touchline for the next slate.`
      : `${by ? "You've been challenged on Touchline. " : ""}Call it before kickoff (${kickoff}) and sign your pick on-chain. Beat the bookies. Devnet · no funds move, just your on-chain word.`,
    links: { actions },
  };
  if (started) body.error = { message: "This challenge has closed. Kickoff has passed." };

  return Response.json(body, { headers });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ fixtureId: string }> }) {
  const { fixtureId: raw } = await params;
  const fixtureId = Number(raw);
  const headers = await actionHeaders();
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return Response.json({ message: "Invalid fixture" }, { status: 400, headers });
  }

  const selRaw = request.nextUrl.searchParams.get("selection");
  if (!isSelection(selRaw)) {
    return Response.json({ message: "Invalid selection: expected part1, draw, or part2" }, { status: 400, headers });
  }
  const selection = selRaw;

  let account: PublicKey;
  try {
    const body = await request.json();
    account = new PublicKey(String((body as { account?: unknown })?.account ?? ""));
  } catch {
    return Response.json({ message: "Missing or invalid account" }, { status: 400, headers });
  }

  const fxRes = await getFixture(fixtureId);
  if (!fxRes?.fixture) {
    return Response.json({ message: "Match not found" }, { status: 404, headers });
  }
  const fx = fxRes.fixture;
  if (fx.startTime <= Date.now()) {
    return Response.json({ message: "Kickoff has passed. This challenge has closed." }, { status: 400, headers });
  }

  const label = labelFor(fx, selection);
  const selLabel = SEL_LABEL[selection];
  const memoText = `TOUCHLINE PICK #${fixtureId} ${selLabel} (${label}): devnet proof-of-call`;

  const connection = getConnection();
  const { blockhash } = await connection.getLatestBlockhash();

  const ix = new TransactionInstruction({
    keys: [{ pubkey: account, isSigner: true, isWritable: false }],
    programId: new PublicKey(MEMO_PROGRAM_ID),
    data: Buffer.from(memoText, "utf8"),
  });

  const tx = new Transaction({ feePayer: account, recentBlockhash: blockhash }).add(ix);
  const transaction = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

  return Response.json(
    {
      transaction,
      message: `Sign to lock your call: ${label} (${selLabel}) on Touchline. Devnet only, no funds move.`,
    },
    { headers },
  );
}
