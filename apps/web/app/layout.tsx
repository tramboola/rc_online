import "@fontsource/oswald/400.css";
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/600.css";
import "@fontsource/rajdhani/400.css";
import "@fontsource/rajdhani/500.css";
import "@fontsource/rajdhani/600.css";
import "@fontsource/rajdhani/700.css";
import "./styles.css";

import type { Metadata } from "next";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: "RC Racing — Drive it for real",
  description: "Control real RC cars from your browser.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // A per-request CSP nonce can only be applied during dynamic rendering.
  await connection();

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
