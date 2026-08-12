import { createBrowserClient } from "@supabase/ssr";
import { type SupabaseClient } from "@supabase/supabase-js";

import { supabaseBrowserConfiguration } from "./config";

interface AuthDatabase {
  public: {
    Functions: Record<string, never>;
    Tables: Record<string, never>;
    Views: Record<string, never>;
  };
}

let client: SupabaseClient<AuthDatabase> | undefined;

export function createBrowserSupabaseClient(): SupabaseClient<AuthDatabase> {
  if (!client) {
    const configuration = supabaseBrowserConfiguration();
    client = createBrowserClient<AuthDatabase>(configuration.url, configuration.publishableKey);
  }
  return client;
}
