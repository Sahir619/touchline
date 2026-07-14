// Solana Actions domain registration — lets Blink-aware clients (wallets, dial.to,
// X/Discord unfurlers) recognize this origin and resolve normal app URLs (e.g. a
// shared /match/[id] link) straight to the Action endpoint, no special URL needed.
import { actionHeaders } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  const headers = await actionHeaders();
  return Response.json(
    {
      rules: [
        { pathPattern: "/match/*", apiPath: "/api/actions/pick/*" },
        { pathPattern: "/api/actions/**", apiPath: "/api/actions/**" },
      ],
    },
    { headers },
  );
}

export async function OPTIONS() {
  return new Response(null, { headers: await actionHeaders() });
}
