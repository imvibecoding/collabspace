import { NextResponse, type NextRequest } from "next/server";
import { resolveDueWindows } from "@/lib/queue/service";

export const dynamic = "force-dynamic";

/**
 * Resolves closed queue windows. Hit by Vercel Cron (see vercel.json) every
 * minute; can also be called manually. Protected by CRON_SECRET when set.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await resolveDueWindows();
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}
