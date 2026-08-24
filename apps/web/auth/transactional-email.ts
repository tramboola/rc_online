import { requirePlainEmailAddress } from "./config";

const RESEND_EMAIL_ENDPOINT = "https://api.resend.com/emails";

export type TransactionalEmailTemplateKind =
  | "verification"
  | "password_reset"
  | "password_changed"
  | "account_deleted";

export type TokenEmailInput = {
  to: string;
  token: string;
};

export type NotificationEmailInput = {
  to: string;
};

export interface TransactionalEmail {
  sendVerification(input: TokenEmailInput): Promise<void>;
  sendPasswordReset(input: TokenEmailInput): Promise<void>;
  sendPasswordChanged(input: NotificationEmailInput): Promise<void>;
  sendAccountDeleted(input: NotificationEmailInput): Promise<void>;
}

export type ResendTransactionalEmailConfig = {
  apiKey: string;
  authUrl: string;
  from: string;
  supportEmail: string;
};

export type TransactionalEmailFetcher = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>;

type EmailMessage = {
  subject: string;
  text: string;
  html: string;
};

export class TransactionalEmailError extends Error {
  readonly status: number | undefined;
  readonly templateKind: TransactionalEmailTemplateKind;

  constructor(templateKind: TransactionalEmailTemplateKind, status?: number) {
    const statusText = status === undefined ? "network error" : `HTTP ${status}`;
    super(`Transactional email delivery failed (${templateKind}, ${statusText})`);
    this.name = "TransactionalEmailError";
    this.status = status;
    this.templateKind = templateKind;
  }
}

function readCanonicalHttpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("authUrl must be a canonical HTTPS origin");
  }
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw new Error("authUrl must be a canonical HTTPS origin");
  }
  return parsed.origin;
}

function requireConfiguredValue(value: string, key: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${key} must be configured`);
  }
  return normalized;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function queryActionLink(origin: string, path: string, token: string): string {
  const link = new URL(path, origin);
  link.searchParams.set("token", token);
  return link.toString();
}

function fragmentActionLink(origin: string, path: string, token: string): string {
  const link = new URL(path, origin);
  link.hash = new URLSearchParams({ token }).toString();
  return link.toString();
}

function linkedMessage(options: {
  heading: string;
  intro: string;
  link: string;
  linkLabel: string;
  lifetime: string;
}): Pick<EmailMessage, "text" | "html"> {
  const escapedLink = escapeHtml(options.link);
  return {
    text: [
      "RC Mania",
      "",
      options.intro,
      options.link,
      "",
      options.lifetime,
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;color:#101820">',
      `<h1 style="color:#ef2b2d">${options.heading}</h1>`,
      `<p>${options.intro}</p>`,
      `<p><a href="${escapedLink}">${options.linkLabel}</a></p>`,
      `<p>${options.lifetime}</p>`,
      "<p>If you did not request this, you can ignore this email.</p>",
      "</div>",
    ].join(""),
  };
}

function verificationMessage(origin: string, token: string): EmailMessage {
  const link = queryActionLink(origin, "/auth/verify", token);
  return {
    subject: "RC Mania: verify your email",
    ...linkedMessage({
      heading: "Verify your RC Mania email",
      intro: "Confirm your email address to finish creating your RC Mania account:",
      link,
      linkLabel: "Verify email",
      lifetime: "This link expires in 24 hours.",
    }),
  };
}

function passwordResetMessage(origin: string, token: string): EmailMessage {
  const link = fragmentActionLink(origin, "/auth/reset-password", token);
  return {
    subject: "RC Mania: reset your password",
    ...linkedMessage({
      heading: "Reset your RC Mania password",
      intro: "Use this secure link to choose a new password:",
      link,
      linkLabel: "Reset password",
      lifetime: "This link expires in 30 minutes.",
    }),
  };
}

function passwordChangedMessage(supportEmail: string): EmailMessage {
  const escapedSupportEmail = escapeHtml(supportEmail);
  return {
    subject: "RC Mania: password changed",
    text: [
      "RC Mania",
      "",
      "Your RC Mania password was changed successfully.",
      `If this was not you, contact ${supportEmail} immediately.`,
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;color:#101820">',
      '<h1 style="color:#ef2b2d">Password changed</h1>',
      "<p>Your RC Mania password was changed successfully.</p>",
      `<p>If this was not you, contact ${escapedSupportEmail} immediately.</p>`,
      "</div>",
    ].join(""),
  };
}

function accountDeletedMessage(supportEmail: string): EmailMessage {
  const escapedSupportEmail = escapeHtml(supportEmail);
  return {
    subject: "RC Mania: account deleted",
    text: [
      "RC Mania",
      "",
      "Your RC Mania account has been deleted.",
      `If you did not request this, contact ${supportEmail}.`,
    ].join("\n"),
    html: [
      '<div style="font-family:Arial,sans-serif;color:#101820">',
      '<h1 style="color:#ef2b2d">Account deleted</h1>',
      "<p>Your RC Mania account has been deleted.</p>",
      `<p>If you did not request this, contact ${escapedSupportEmail}.</p>`,
      "</div>",
    ].join(""),
  };
}

export function createResendTransactionalEmail(
  config: ResendTransactionalEmailConfig,
  fetcher: TransactionalEmailFetcher = fetch,
): TransactionalEmail {
  const canonicalOrigin = readCanonicalHttpsOrigin(config.authUrl);
  const apiKey = requireConfiguredValue(config.apiKey, "apiKey");
  const from = requireConfiguredValue(config.from, "from");
  if (!config.supportEmail.trim()) {
    throw new Error("supportEmail must be configured");
  }
  const supportEmail = requirePlainEmailAddress(
    config.supportEmail,
    "supportEmail",
  );

  async function send(
    templateKind: TransactionalEmailTemplateKind,
    to: string,
    message: EmailMessage,
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetcher(RESEND_EMAIL_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          reply_to: supportEmail,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
    } catch {
      throw new TransactionalEmailError(templateKind);
    }

    if (!response.ok) {
      throw new TransactionalEmailError(templateKind, response.status);
    }
  }

  return {
    sendVerification({ to, token }) {
      return send("verification", to, verificationMessage(canonicalOrigin, token));
    },
    sendPasswordReset({ to, token }) {
      return send("password_reset", to, passwordResetMessage(canonicalOrigin, token));
    },
    sendPasswordChanged({ to }) {
      return send("password_changed", to, passwordChangedMessage(supportEmail));
    },
    sendAccountDeleted({ to }) {
      return send("account_deleted", to, accountDeletedMessage(supportEmail));
    },
  };
}
