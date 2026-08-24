import { describe, expect, it } from "vitest";

import {
  LEGAL_REVISION,
  operator,
  privacySections,
  termsSections,
} from "./legal-content";

describe("versioned legal content", () => {
  it("identifies the operator and current effective revision exactly", () => {
    expect(LEGAL_REVISION).toBe("2026-08-24");
    expect(operator).toEqual({
      company: "Aspect Estates s.r.o.",
      ico: "IČO 28355920",
      dic: "DIČ CZ28355920",
      address: "Gorazdova 355/5, Nové Město, 120 00 Praha 2, Czech Republic",
      register: "C 215134/MSPH",
      email: "support@rcmania.live",
    });
  });

  it("covers the required privacy-policy topics without tracking claims", () => {
    const content = privacySections
      .map((section) => `${section.heading} ${section.body}`)
      .join(" ");

    expect(content).toMatch(/data we process/i);
    expect(content).toMatch(/purposes and lawful bases/i);
    expect(content).toMatch(/Google/i);
    expect(content).toMatch(/Resend/i);
    expect(content).toMatch(/hosting/i);
    expect(content).toMatch(/future payment/i);
    expect(content).toMatch(/international transfers/i);
    expect(content).toMatch(/retention/i);
    expect(content).toMatch(/rights/i);
    expect(content).toMatch(/deletion/i);
    expect(content).toMatch(/security/i);
    expect(content).toMatch(/necessary authentication/i);
    expect(content).toMatch(/required to create and authenticate an account/i);
    expect(content).toMatch(/account or drive access may be unavailable/i);
    expect(content).toMatch(/lodge a complaint/i);
    expect(content).toMatch(/Czech Office for Personal Data Protection/i);
    expect(content).toContain("\u00daOO\u00da");
    expect(content).toContain("https://uoou.gov.cz/en/consultation/contact");
    expect(content).toContain("posta@uoou.gov.cz");
    expect(content).toMatch(
      /no advertising analytics, pixels, behavioral tracking, or marketing email/i,
    );
    expect(content).not.toMatch(
      /(?:we|RC Mania) (?:use|uses) (?:advertising )?analytics/i,
    );
  });

  it("maps each current processing purpose to its lawful basis", () => {
    const content = privacySections
      .map((section) => `${section.heading} ${section.body}`)
      .join(" ");

    expect(content).toMatch(
      /create and authenticate accounts.*operate remote driving sessions.*performance of a contract/i,
    );
    expect(content).toMatch(
      /protect the service.*prevent abuse.*legitimate interests/i,
    );
    expect(content).toMatch(
      /accounting and other records required by law.*legal obligation/i,
    );
    expect(content).toMatch(/optional processing.*specific consent/i);
  });

  it("identifies Google-sourced fields without claiming to consume a Google avatar", () => {
    const sourceSection = privacySections.find(
      (section) => section.heading === "Google sign-in data source",
    );

    expect(sourceSection?.body).toMatch(
      /Google provides.*email address.*profile name.*email verification status.*provider account identifier/i,
    );
    expect(sourceSection?.body).not.toMatch(/Google provides[^.]*avatar/i);
  });

  it("states the current Resend and Google transfer frameworks and access to safeguards", () => {
    const content = privacySections
      .map((section) => `${section.heading} ${section.body}`)
      .join(" ");

    expect(content).toMatch(/Resend.*United States/i);
    expect(content).toMatch(
      /Resend.*EU-U\.S\. Data Privacy Framework.*Standard Contractual Clauses/i,
    );
    expect(content).toContain("https://resend.com/legal/dpa");
    expect(content).toMatch(/Google.*process.*internationally/i);
    expect(content).toMatch(
      /Google.*Data Privacy Framework.*Standard Contractual Clauses/i,
    );
    expect(content).toContain("https://policies.google.com/privacy/frameworks");
    expect(content).toMatch(
      /request.*copy.*safeguards.*support@rcmania\.live/i,
    );
  });

  it("explains that consent withdrawal does not invalidate earlier processing", () => {
    const content = privacySections
      .map((section) => `${section.heading} ${section.body}`)
      .join(" ");

    expect(content).toMatch(
      /withdraw.*consent.*does not affect.*lawfulness.*before.*withdrawal/i,
    );
  });

  it("covers the required terms topics and preserves mandatory consumer protections", () => {
    const content = termsSections
      .map((section) => `${section.heading} ${section.body}`)
      .join(" ");

    expect(content).toMatch(/account use/i);
    expect(content).toMatch(/physical vehicles/i);
    expect(content).toMatch(/safety/i);
    expect(content).toMatch(/five-minute/i);
    expect(content).toMatch(/availability/i);
    expect(content).toMatch(/pricing/i);
    expect(content).toMatch(/payment/i);
    expect(content).toMatch(/refund/i);
    expect(content).toMatch(/intellectual property/i);
    expect(content).toMatch(/suspend/i);
    expect(content).toMatch(/deletion/i);
    expect(content).toMatch(/mandatory consumer law/i);
    expect(content).toMatch(/laws of the Czech Republic/i);
    expect(content).toMatch(/under 13/i);
    expect(content).toContain(operator.email);
    expect(content).toContain("Česká obchodní inspekce");
    expect(content).toContain("Ústřední inspektorát – oddělení ADR");
    expect(content).toContain("Gorazdova 1969/24, 120 00 Praha 2");
    expect(content).toContain("adr@coi.gov.cz");
    expect(content).toContain("https://coi.gov.cz/informace-o-adr/");
  });
});
