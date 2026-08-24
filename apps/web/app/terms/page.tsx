import type { Metadata } from "next";

import { LegalFooter } from "../legal-footer";
import {
  LEGAL_REVISION,
  legalDraftNotice,
  operator,
  termsSections,
} from "../legal-content";

export const metadata: Metadata = {
  title: "Terms of Service | RC Mania",
};

export default function TermsPage() {
  return (
    <div className="legal-page-shell">
      <main className="legal-page">
        <p className="eyebrow">TERMS / EFFECTIVE {LEGAL_REVISION}</p>
        <h1>TERMS OF SERVICE</h1>
        <p className="legal-draft-notice">{legalDraftNotice}</p>
        <section className="legal-operator" aria-labelledby="terms-operator">
          <h2 id="terms-operator">Operator and contact</h2>
          <p>{operator.company}<br />{operator.ico} · {operator.dic}<br />{operator.address}<br />Commercial Register: {operator.register}<br /><a href={`mailto:${operator.email}`}>{operator.email}</a></p>
        </section>
        {termsSections.map((section) => (
          <section className="legal-section" key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </main>
      <LegalFooter />
    </div>
  );
}
