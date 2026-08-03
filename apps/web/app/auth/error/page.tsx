import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";

export default function AuthenticationErrorPage() {
  return (
    <main className="auth-error-page">
      <section className="data-panel auth-error-panel">
        <WarningCircle aria-hidden="true" size={48} />
        <p className="eyebrow">AUTHENTICATION INTERRUPTED</p>
        <h1>GOOGLE SIGN-IN DIDN&apos;T COMPLETE</h1>
        <p>
          No account was created and no balance was changed. Return to the track
          and try signing in again.
        </p>
        <Link className="hero-link" href="/">RETURN TO TRACK</Link>
      </section>
    </main>
  );
}
