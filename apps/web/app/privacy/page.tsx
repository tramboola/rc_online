import type { Metadata } from "next";

import {
  LEGAL_REVISION,
  operator,
  privacySections,
} from "../legal-content";

export const metadata: Metadata = {
  title: "Privacy Policy | RC Mania",
};

export default function PrivacyPage() {
  return (
    <div className="legal-page-shell">
      <main className="legal-page">
        <p className="eyebrow">PRIVACY / EFFECTIVE {LEGAL_REVISION}</p>
        <h1>PRIVACY POLICY</h1>
        <section className="legal-operator" aria-labelledby="privacy-operator">
          <h2 id="privacy-operator">Operator and contact</h2>
          <p>{operator.company}<br />{operator.ico} · {operator.dic}<br />{operator.address}<br />Commercial Register: {operator.register}<br /><a href={`mailto:${operator.email}`}>{operator.email}</a></p>
        </section>
        {privacySections.map((section) => (
          <section className="legal-section" key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </main>
    </div>
  );
}
