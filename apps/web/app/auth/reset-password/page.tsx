"use client";

import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

export type ResetPasswordState = "form" | "submitting" | "invalid" | "updated";

const resetPasswordCopy: Record<
  Exclude<ResetPasswordState, "form" | "submitting">,
  { eyebrow: string; heading: string; body: string }
> = {
  invalid: {
    eyebrow: "RECOVERY LINK",
    heading: "LINK EXPIRED",
    body: "This password recovery link is invalid or has expired. Request a new one to continue.",
  },
  updated: {
    eyebrow: "ACCOUNT SECURED",
    heading: "PASSWORD UPDATED",
    body: "Your password was updated and your active sessions were signed out.",
  },
};

export function ResetPasswordStatus({
  state,
  onSubmit,
}: {
  state: ResetPasswordState;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  if (state === "form" || state === "submitting") {
    const submitting = state === "submitting";
    return (
      <main className="auth-error-page">
        <section className="data-panel auth-error-panel">
          <p className="eyebrow">ACCOUNT RECOVERY</p>
          <h1>RESET PASSWORD</h1>
          <p>Choose a new password with 12 to 128 characters.</p>
          <form onSubmit={onSubmit}>
            <label>
              NEW PASSWORD
              <input autoComplete="new-password" disabled={submitting} maxLength={128} minLength={12} name="password" required type="password" />
            </label>
            <button className="hero-link" disabled={submitting} type="submit">
              {submitting ? "UPDATING PASSWORD" : "UPDATE PASSWORD"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const copy = resetPasswordCopy[state];
  return (
    <main className="auth-error-page">
      <section className="data-panel auth-error-panel" aria-live="polite">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.heading}</h1>
        <p>{copy.body}</p>
        <Link className="hero-link" href="/">RETURN TO ACCOUNT</Link>
      </section>
    </main>
  );
}

type ReplaceState = (data: unknown, unused: string, url?: string | URL | null) => void;

export function consumeResetTokenFromLocation(url: URL, replaceState: ReplaceState): string | null {
  const token = new URLSearchParams(url.hash.slice(1)).get("token");
  replaceState({}, "", url.pathname);
  return token;
}

type ResetPasswordFetcher = (input: string | URL, init: RequestInit) => Promise<Response>;

export async function submitResetPassword(input: {
  token: string;
  password: string;
  gate: { current: boolean };
  fetcher: ResetPasswordFetcher;
}): Promise<"updated" | "invalid" | null> {
  if (input.gate.current) return null;
  input.gate.current = true;
  try {
    const response = await input.fetcher("/api/account/reset-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: input.token, password: input.password }),
    });
    return response.ok ? "updated" : "invalid";
  } catch {
    return "invalid";
  } finally {
    input.gate.current = false;
  }
}

export default function ResetPasswordPage() {
  const [state, setState] = useState<ResetPasswordState>("form");
  const tokenRef = useRef<string | null>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    tokenRef.current = consumeResetTokenFromLocation(
      url,
      window.history.replaceState.bind(window.history),
    );
    if (!tokenRef.current) setState("invalid");
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const token = tokenRef.current;
    const password = new FormData(event.currentTarget).get("password");
    if (!token || typeof password !== "string") {
      setState("invalid");
      return;
    }
    setState("submitting");
    void submitResetPassword({
      token,
      password,
      gate: submittingRef,
      fetcher: fetch,
    }).then((result) => {
      if (result) setState(result);
    });
  }

  return <ResetPasswordStatus onSubmit={submit} state={state} />;
}
