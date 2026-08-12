import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { supabaseBrowserConfiguration } from "./config";

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const configuration = supabaseBrowserConfiguration();
  return createServerClient(configuration.url, configuration.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, options, value } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
