"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";

import { webAuthMode } from "../lib/auth-mode";
import { createBrowserSupabaseClient } from "../lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  if (webAuthMode() === "development") return null;
  const signOut = async () => {
    await createBrowserSupabaseClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  return (
    <button
      aria-label="Sign out"
      className="profile-sign-out"
      onClick={() => {
        void signOut();
      }}
      type="button"
    >
      <LogOut aria-hidden="true" size={16} />
    </button>
  );
}
