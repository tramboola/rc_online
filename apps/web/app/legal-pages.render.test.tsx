import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

describe("public legal pages", () => {
  it("renders the privacy policy as public product copy without an internal draft warning or duplicate footer", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);

    expect(markup).toContain("PRIVACY POLICY");
    expect(markup).toContain("Aspect Estates s.r.o.");
    expect(markup).toContain("Czech Office for Personal Data Protection");
    expect(markup).not.toContain("implementation-ready product draft");
    expect(markup).not.toContain("legal-draft-notice");
    expect(markup).not.toContain("legal-footer");
  });

  it("renders the terms as public product copy without an internal draft warning or duplicate footer", () => {
    const markup = renderToStaticMarkup(<TermsPage />);

    expect(markup).toContain("TERMS OF SERVICE");
    expect(markup).toContain("Aspect Estates s.r.o.");
    expect(markup).toContain("Remote vehicles and safety");
    expect(markup).not.toContain("implementation-ready product draft");
    expect(markup).not.toContain("legal-draft-notice");
    expect(markup).not.toContain("legal-footer");
  });
});
