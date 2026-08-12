import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "../../../lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type");
  if (tokenHash && type) {
    const { error } = await (
      await createServerSupabaseClient()
    ).auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error) return NextResponse.redirect(new URL("/", requestUrl.origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=confirmation", requestUrl.origin));
}
