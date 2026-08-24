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
    const content = privacySections.map((section) => `${section.heading} ${section.body}`).join(" ");

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
    expect(content).toMatch(/no advertising analytics, pixels, behavioral tracking, or marketing email/i);
  });

  it("covers the required terms topics and preserves mandatory consumer protections", () => {
    const content = termsSections.map((section) => `${section.heading} ${section.body}`).join(" ");

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
  });
});
