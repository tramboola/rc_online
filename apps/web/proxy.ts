import { type NextRequest, NextResponse } from "next/server";

function buildContentSecurityPolicy(nonce: string) {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const connectSources = [
    "'self'",
    "https://*.stripe.com",
    ...(isDevelopment
      ? [
          "ws:",
          "http://localhost:3001",
          "http://127.0.0.1:3001",
          "http://localhost:3002",
          "http://127.0.0.1:3002",
        ]
      : []),
  ];

  const configuredOrigins = [
    process.env.NEXT_PUBLIC_API_ORIGIN,
    process.env.NEXT_PUBLIC_EDGE_ORIGIN,
  ];
  for (const configuredOrigin of configuredOrigins) {
    if (!configuredOrigin) continue;
    try {
      connectSources.push(new URL(configuredOrigin).origin);
    } catch {
      // Startup validation owns malformed configuration. Keep the CSP closed.
    }
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDevelopment ? " 'unsafe-eval'" : ""} https://*.stripe.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${[...new Set(connectSources)].join(" ")}`,
    `media-src 'self' blob:${isDevelopment ? " http://localhost:8888 http://127.0.0.1:8888" : ""}`,
    "frame-src https://*.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://*.stripe.com",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
