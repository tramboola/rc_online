import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./styles.css";

import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { connection } from "next/server";

import { auth } from "../auth";
import { LegalFooter } from "./legal-footer";

export const metadata: Metadata = {
  title: "RC Mania — Drive it for real",
  description: "Control real RC cars from your browser.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // A per-request CSP nonce can only be applied during dynamic rendering.
  await connection();
  const session = await auth();

  return (
    <html lang="en">
      <body>
        <SessionProvider session={session}>
          {children}
          <LegalFooter />
        </SessionProvider>
      </body>
    </html>
  );
}
