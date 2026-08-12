import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SignInForm } from "../../components/sign-in-form";
import { webAuthMode } from "../../lib/auth-mode";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Staff sign in",
};

export default function SignInPage() {
  if (webAuthMode() === "development") redirect("/");
  return (
    <Suspense fallback={<main className="auth-page" />}>
      <SignInForm />
    </Suspense>
  );
}
