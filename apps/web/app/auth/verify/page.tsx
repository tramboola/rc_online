"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type VerificationState = "verifying" | "verified" | "invalid";

const verificationCopy: Record<
  VerificationState,
  { eyebrow: string; heading: string; body: string }
> = {
  verifying: {
    eyebrow: "ACCOUNT VERIFICATION",
    heading: "VERIFYING EMAIL",
    body: "Hold on while we confirm your RC Mania account.",
  },
  verified: {
    eyebrow: "ACCOUNT READY",
    heading: "EMAIL VERIFIED",
    body: "Your email is confirmed. You can now sign in and get ready to drive.",
  },
  invalid: {
    eyebrow: "VERIFICATION FAILED",
    heading: "LINK INVALID OR EXPIRED",
    body: "Request a new verification email from the sign-in screen and try again.",
  },
};

export function VerificationStatus({ state }: { state: VerificationState }) {
  const copy = verificationCopy[state];

  return (
    <main className="auth-error-page">
      <section className="data-panel auth-error-panel" aria-live="polite">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.heading}</h1>
        <p>{copy.body}</p>
        {state !== "verifying" ? (
          <Link className="hero-link" href="/">
            RETURN TO TRACK
          </Link>
        ) : null}
      </section>
    </main>
  );
}

export default function VerifyEmailPage() {
  const [state, setState] = useState<VerificationState>("verifying");

  useEffect(() => {
    let active = true;
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token");

    window.history.replaceState({}, "", window.location.pathname);

    if (!token) {
      setState("invalid");
      return () => {
        active = false;
      };
    }

    void fetch("/api/account/verify-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        if (active) {
          setState(response.ok ? "verified" : "invalid");
        }
      })
      .catch(() => {
        if (active) {
          setState("invalid");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return <VerificationStatus state={state} />;
}
