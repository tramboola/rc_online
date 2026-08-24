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
    body: "We process data to create and authenticate accounts, provide account features, respond to service support requests, operate remote driving sessions and, where applicable, manage a purchase because this is necessary for performance of a contract or to take steps you request before entering one. We protect the service, apply rate limits and prevent abuse on the basis of our legitimate interests in operating a reliable and secure service. We keep accounting and other records required by law to comply with a legal obligation. We carry out optional processing that is not needed for the service only when we identify it and ask for your specific consent.",
  },
  {
    heading: "Data required to provide the service",
    body: "An email address, authentication credential or Google identity, and the necessary session and security records are required to create and authenticate an account and provide account and drive access. If you do not provide this necessary account and authentication data, we may be unable to create or authenticate your account, and account or drive access may be unavailable. Optional profile choices, such as a custom nickname or avatar, are not required to use the core service.",
  },
  {
    heading: "Google sign-in data source",
    body: "When you choose Google sign-in, Google provides your email address, Google profile name, email verification status and provider account identifier. We use those fields to create or link your RC Mania account and authenticate later sign-ins. RC Mania does not import your Google avatar.",
  },
  {
    heading: "Service providers",
    body: "Google acts as an identity provider only when you choose Google sign-in. Resend delivers transactional account email. Hosting and infrastructure providers operate the systems needed to provide RC Mania. A future payment processor would process payment data only if you choose a paid offering. These providers do not necessarily receive every category of data described in this notice.",
  },
  {
    heading: "International transfers",
    body: `Resend states that it transfers and primarily processes transactional-email personal data in the United States. Resend's current Data Processing Addendum describes its participation in the EU-U.S. Data Privacy Framework and incorporates the European Commission's Standard Contractual Clauses for transfers not covered by an adequacy decision; see https://resend.com/legal/dpa. Google may process Google sign-in data internationally and publishes transfer frameworks that include adequacy decisions, the EU-U.S. Data Privacy Framework and the European Commission's Standard Contractual Clauses; see https://policies.google.com/privacy/frameworks. RC Mania's dedicated TURN relay is currently hosted in the Netherlands, within the European Economic Area; other infrastructure locations are assessed separately and are not represented here as necessarily EEA-only. Where RC Mania transfers personal data outside the EEA, we use the mechanism applicable to that provider and transfer. You may request current information or a copy of the applicable safeguards by contacting ${operator.email}.`,
  },
  {
    heading: "Retention",
    body: "We keep personal data only for as long as needed for the purpose described here. Account and operational records are retained while the account or service relationship is active; security, fraud-prevention, accounting and legal-claim records may be kept longer where necessary. We review retention against those purposes and applicable obligations rather than promising one period for all data.",
  },
  {
    heading: "Your rights and deletion",
    body: "Subject to applicable law, you may request access, correction, deletion, restriction, objection, portability, or withdrawal of consent where consent is the basis. Withdrawing consent does not affect the lawfulness of processing carried out before the withdrawal. You can request account deletion through the account tools when available or by contacting support. Deletion may leave limited de-identified or retained records where required for accounting, fraud prevention, legal claims or other legal duties. You also have the right to lodge a complaint with a competent supervisory authority, including the Czech Office for Personal Data Protection (\u00da\u0159ad pro ochranu osobn\u00edch \u00fadaj\u016f, \u00daOO\u00da). Its official contact route is https://uoou.gov.cz/en/consultation/contact and its contact email is posta@uoou.gov.cz.",
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
    heading: "Out-of-court consumer dispute resolution",
    body: "If a consumer dispute arising from a purchase contract or a contract for services cannot be resolved directly, the consumer may submit a proposal for out-of-court resolution to: Česká obchodní inspekce, Ústřední inspektorát – oddělení ADR, Gorazdova 1969/24, 120 00 Praha 2, Czech Republic; adr@coi.gov.cz; https://coi.gov.cz/informace-o-adr/.",
  },
  {
    heading: "Children under 13",
    body: "RC Mania is not directed to children under 13, and we do not knowingly collect their account data. If you believe a child under 13 has provided account data, please contact us so we can review and take appropriate action.",
  },
];
