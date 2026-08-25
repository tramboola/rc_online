import { SteeringWheel } from "@phosphor-icons/react";

export function MobileLandscapeNotice({
  detail,
  title = "ROTATE YOUR PHONE",
}: {
  readonly detail: string;
  readonly title?: string;
}) {
  return (
    <aside className="mobile-landscape-notice" role="status">
      <SteeringWheel aria-hidden="true" size={52} />
      <h2>{title}</h2>
      <p>{detail}</p>
    </aside>
  );
}
