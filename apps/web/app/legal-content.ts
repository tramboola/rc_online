export const LEGAL_REVISION = "2026-08-24";

export const operator = {
  company: "Aspect Estates s.r.o.",
  ico: "IČO 28355920",
  dic: "DIČ CZ28355920",
  address: "Gorazdova 355/5, Nové Město, 120 00 Praha 2, Czech Republic",
  register: "C 215134/MSPH",
  email: "support@rcmania.live",
} as const;

export type LegalSection = {
  heading: string;
  body: string;
};

export const privacySections: readonly LegalSection[] = [
  {
    heading: "Data we process",
    body: "We process account and profile data such as email address, display name, preset avatar choice and authentication records; necessary session, security and rate-limit data; service and ride-operation records; support correspondence; and payment information only if a paid service is introduced. We do not store plain-text passwords or raw account-action tokens.",
  },
  {
    heading: "Purposes and lawful bases",
    body: "We use this data to provide and secure the service, authenticate accounts, operate remote sessions, respond to support requests, prevent abuse, meet legal obligations and, where applicable, manage a purchase. Depending on the purpose, our lawful bases are performance of a contract, compliance with a legal obligation, our legitimate interests in security and operating the service, or consent where we specifically ask for it.",
  },
  {
    heading: "Service providers",
    body: "Google acts as an identity provider only when you choose Google sign-in. Resend delivers transactional account email. Hosting and infrastructure providers operate the systems needed to provide RC Mania. A future payment processor would process payment data only if you choose a paid offering. These providers do not necessarily receive every category of data described in this notice.",
  },
  {
    heading: "International transfers",
    body: "Some service providers may process data outside the European Economic Area. Where a transfer is required, we will use the transfer mechanism and safeguards applicable to that provider and processing activity, such as an adequacy decision or appropriate contractual safeguards.",
  },
  {
    heading: "Retention",
    body: "We keep personal data only for as long as needed for the purpose described here. Account and operational records are retained while the account or service relationship is active; security, fraud-prevention, accounting and legal-claim records may be kept longer where necessary. We review retention against those purposes and applicable obligations rather than promising one period for all data.",
  },
  {
    heading: "Your rights and deletion",
    body: "Subject to applicable law, you may request access, correction, deletion, restriction, objection, portability, or withdrawal of consent where consent is the basis. You can request account deletion through the account tools when available or by contacting support. Deletion may leave limited de-identified or retained records where required for accounting, fraud prevention, legal claims or other legal duties.",
  },
  {
    heading: "Necessary authentication and browser storage",
    body: "RC Mania uses only necessary authentication cookies and browser storage needed to keep a session secure and operate the service. We use no advertising analytics, pixels, behavioral tracking, or marketing email in this scope.",
  },
  {
    heading: "Security and contact",
    body: `We use proportionate technical and organisational measures to protect the service. For a privacy or security question, contact ${operator.email}.`,
  },
];

export const termsSections: readonly LegalSection[] = [
  {
    heading: "Account use",
    body: "Keep your account credentials confidential, provide accurate account information and use RC Mania only for lawful purposes. You are responsible for activity carried out through your account unless applicable law provides otherwise.",
  },
  {
    heading: "Remote vehicles and safety",
    body: "RC Mania may let you remotely control physical vehicles. Connectivity, video, hardware and environmental conditions can change unexpectedly. Follow on-screen safety instructions, use controls attentively and do not attempt unsafe, abusive, unlawful or disruptive behaviour. We may stop or limit a session to protect people, vehicles, property or the service.",
  },
  {
    heading: "Session limit and availability",
    body: "A driving session has a five-minute limit unless RC Mania clearly states otherwise for a specific service. Availability depends on vehicles, networks, maintenance and other operational conditions; we do not promise uninterrupted access or a particular vehicle at a particular time.",
  },
  {
    heading: "Pricing, payment and refunds",
    body: "If RC Mania offers a paid service, the applicable price, payment terms and material conditions will be shown before purchase. A payment provider is not implied by these Terms and may be introduced later. Refunds and withdrawal requests will be handled under the terms shown at purchase and applicable law; these Terms do not remove any mandatory consumer right.",
  },
  {
    heading: "Intellectual property",
    body: "RC Mania, its software, visual materials, brand and service content are protected by applicable intellectual-property laws. Except for the limited right to use the service under these Terms, no ownership or licence is granted to you.",
  },
  {
    heading: "Suspension and deletion",
    body: "We may suspend or restrict an account or session where reasonably necessary for safety, security, abuse prevention, legal compliance or a material breach of these Terms. You may request deletion of your account as described in the Privacy Policy.",
  },
  {
    heading: "Liability and consumer rights",
    body: "To the extent permitted by law, RC Mania is not liable for indirect or consequential loss arising from use of the service. Nothing in these Terms excludes or limits liability that cannot be excluded or limited under mandatory consumer law or other mandatory law.",
  },
  {
    heading: "Governing law and contact",
    body: `These Terms are governed by the laws of the Czech Republic, without limiting protections that mandatory consumer law gives you. Questions about the service may be sent to ${operator.email}.`,
  },
  {
    heading: "Children under 13",
    body: "RC Mania is not directed to children under 13, and we do not knowingly collect their account data. If you believe a child under 13 has provided account data, please contact us so we can review and take appropriate action.",
  },
];

export const legalDraftNotice = "These documents are implementation-ready product drafts, not legal advice, and should be reviewed by Czech counsel before consumer payments are offered internationally.";
