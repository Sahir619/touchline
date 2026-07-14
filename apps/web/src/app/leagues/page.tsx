"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * /leagues — leagues live under the Friends tab of the leaderboard.
 * Redirect there to keep one home for all standings.
 */
export default function LeaguesIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/leaderboard");
  }, [router]);

  return null;
}
