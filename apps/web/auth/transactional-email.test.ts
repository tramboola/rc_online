import { describe, expect, test, vi } from "vitest";

import {
  createResendTransactionalEmail,
  TransactionalEmailError,
  type TransactionalEmailFetcher,
} from "./transactional-email";

const config = {
  apiKey: "unit-test-api-key-not-secret",
  authUrl: "https://rcmania.live",
  from: "RC Mania <accounts@updates.rcmania.live>",
  supportEmail: "support@rcmania.live",
};

function successfulFetcher() {
  return vi.fn<TransactionalEmailFetcher>(async (_input, _init) => (
    new Response(JSON.stringify({ id: "email-id" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  ));
}

describe("Resend transactional email", () => {
  test("sends verification from the configured identity with a canonical link", async () => {
    const fetcher = successfulFetcher();
    const email = createResendTransactionalEmail(config, fetcher);

    await email.sendVerification({
      to: "driver@example.com",
      token: "verify-token/?secret",
    });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer unit-test-api-key-not-secret",
        "content-type": "application/json",
      },
    });
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      from: "RC Mania <accounts@updates.rcmania.live>",
      to: ["driver@example.com"],
      reply_to: "support@rcmania.live",
    });
    expect(payload.subject).toBe("RC Mania: verify your email");
    expect(payload.text).toContain(
      "https://rcmania.live/auth/verify?token=verify-token%2F%3Fsecret",
    );
    expect(payload.html).toContain(
      "https://rcmania.live/auth/verify?token=verify-token%2F%3Fsecret",
    );
  });

  test("uses the canonical reset path and never accepts an alternate origin", async () => {
    const fetcher = successfulFetcher();
    const email = createResendTransactionalEmail(config, fetcher);

    await email.sendPasswordReset({ to: "driver@example.com", token: "reset-token" });

    const payload = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {
      text: string;
      html: string;
    };
    expect(payload.text).toContain(
      "https://rcmania.live/auth/reset-password#token=reset-token",
    );
    expect(payload.html).toContain(
      "https://rcmania.live/auth/reset-password#token=reset-token",
    );
    expect(`${payload.text}${payload.html}`).not.toContain("/auth/reset-password?token=");
    expect(payload.html).not.toContain("driver@example.com");
    expect(() => createResendTransactionalEmail({
      ...config,
      authUrl: "https://rcmania.live.evil.example",
    }, fetcher)).not.toThrow();
    expect(() => createResendTransactionalEmail({
      ...config,
      authUrl: "http://rcmania.live",
    }, fetcher)).toThrow("authUrl must be a canonical HTTPS origin");
  });

  test("sends notification-only password-changed and account-deleted messages", async () => {
    const fetcher = successfulFetcher();
    const email = createResendTransactionalEmail(config, fetcher);

    await email.sendPasswordChanged({ to: "driver@example.com" });
    await email.sendAccountDeleted({ to: "driver@example.com" });

    const payloads = fetcher.mock.calls.map((call) => JSON.parse(
      String(call[1]?.body),
    ) as { subject: string; text: string; html: string });
    expect(payloads.map(({ subject }) => subject)).toEqual([
      "RC Mania: password changed",
      "RC Mania: account deleted",
    ]);
    for (const payload of payloads) {
      expect(`${payload.text}${payload.html}`).not.toContain("https://");
      expect(`${payload.text}${payload.html}`).not.toContain("$0.00");
      expect(`${payload.text}${payload.html}`).not.toContain("session-token");
      expect(`${payload.text}${payload.html}`).not.toContain("internal-user-id");
    }
  });

  test("throws a redacted error for a rejected Resend request", async () => {
    const fetcher = vi.fn<TransactionalEmailFetcher>(async (_input, _init) => (
      new Response(
        "provider-body-with-driver@example.com-and-reset-token-and-api-key",
        { status: 422 },
      )
    ));
    const email = createResendTransactionalEmail(config, fetcher);

    const failure = email.sendPasswordReset({
      to: "driver@example.com",
      token: "reset-token",
    });

    await expect(failure).rejects.toMatchObject({
      name: "TransactionalEmailError",
      status: 422,
      templateKind: "password_reset",
    });
    const error = await failure.catch((caught: unknown) => caught) as Error;
    expect(error).toBeInstanceOf(TransactionalEmailError);
    expect(JSON.stringify(error)).not.toMatch(
      /driver@example\.com|reset-token|api-key|provider-body/i,
    );
    expect(error.message).toBe(
      "Transactional email delivery failed (password_reset, HTTP 422)",
    );
  });

  test("redacts every fetch rejection without retaining the original cause", async () => {
    const fetcher = vi.fn<TransactionalEmailFetcher>(async (_input, _init) => {
      throw new Error(
        "leaked unit-test-api-key-not-secret driver@example.com reset-token",
      );
    });
    const email = createResendTransactionalEmail(config, fetcher);

    const error = await email.sendPasswordReset({
      to: "driver@example.com",
      token: "reset-token",
    }).catch((caught: unknown) => caught) as Error & { cause?: unknown };

    expect(error).toMatchObject({
      name: "TransactionalEmailError",
      status: undefined,
      templateKind: "password_reset",
      message: "Transactional email delivery failed (password_reset, network error)",
    });
    expect(error.cause).toBeUndefined();
    expect(`${error.message}${error.stack}${JSON.stringify(error)}`).not.toMatch(
      /driver@example\.com|reset-token|re_test_api_key/i,
    );
  });

  test("validates one plain support mailbox and escapes it in HTML", async () => {
    const fetcher = successfulFetcher();
    const email = createResendTransactionalEmail({
      ...config,
      supportEmail: "support&ops@rcmania.live",
    }, fetcher);

    await email.sendPasswordChanged({ to: "driver@example.com" });

    const payload = JSON.parse(String(fetcher.mock.calls[0]![1]?.body)) as {
      text: string;
      html: string;
    };
    expect(payload.text).toContain("support&ops@rcmania.live");
    expect(payload.html).toContain("support&amp;ops@rcmania.live");
    expect(payload.html).not.toContain("support&ops@rcmania.live");

    expect(() => createResendTransactionalEmail({
      ...config,
      supportEmail: "RC Mania <support@rcmania.live>",
    }, fetcher)).toThrow("supportEmail must be one plain email address");
    expect(() => createResendTransactionalEmail({
      ...config,
      supportEmail: "support@rcmania.live\n",
    }, fetcher)).toThrow("supportEmail must be one plain email address");
  });

  test.each([
    ["apiKey", "apiKey must be configured"],
    ["from", "from must be configured"],
    ["supportEmail", "supportEmail must be configured"],
  ] as const)("requires %s when the email service is constructed", (key, message) => {
    expect(() => createResendTransactionalEmail({
      ...config,
      [key]: "   ",
    }, successfulFetcher())).toThrow(message);
  });
});
