"use client";

import {
  ArrowRight,
  BatteryHigh,
  CalendarBlank,
  CarProfile,
  ChartBar,
  Check,
  CheckCircle,
  Clock,
  CreditCard,
  Desktop,
  Flag,
  GameController,
  Gauge,
  Headphones,
  Keyboard,
  Lightning,
  Megaphone,
  Repeat,
  ShieldCheck,
  SpeakerHigh,
  SteeringWheel,
  Stop,
  Timer,
  Trophy,
  UserCircle,
  UsersThree,
  Warning,
  WifiHigh,
} from "@phosphor-icons/react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { apiRequest } from "./api-client";
import { AccountControl } from "./account-control";
import { BrowserControlLoop } from "./control-loop";
import {
  ConnectionLoadingScreen,
  getRideUrl,
} from "./connection-loading-screen";
import {
  getHomePresentation,
  getVideoStatusLabel,
  getViewerBadgeText,
} from "./home-presentation";
import type { OperationalStatus } from "./operational-status";
import {
  howItWorksRequirements,
  howItWorksSteps,
} from "./how-it-works-content";
import { getLeaderboardPresentation } from "./leaderboard-presentation";
import {
  controlIntentFromPressedKeys,
  controlKeyForCode,
  isDriveKeyActive,
  updatePressedKeys,
} from "./keyboard-control";
import { RealRideScreen } from "./real-ride-screen";
import { useViewerCount } from "./use-viewer-count";

export type ScreenName =
  | "home"
  | "how-it-works"
  | "pricing"
  | "leaderboard"
  | "preflight"
  | "queue"
  | "loading"
  | "ride"
  | "results"
  | "operator";

type IconType = ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;

const rideId = "30000000-0000-4000-8000-000000000003";
const blueCarId = "40000000-0000-4000-8000-000000000001";
const redCarId = "40000000-0000-4000-8000-000000000002";

type QueueCarPresentation = {
  id: string;
  number: string;
  name: string;
  src: string | null;
  battery: string;
  connection: string;
};

const simulationQueueCars: QueueCarPresentation[] = [
  {
    id: blueCarId,
    number: "CAR 01",
    name: "NIGHT RUNNER",
    src: "/assets/car-blue.webp",
    battery: "86%",
    connection: "EXCELLENT",
  },
  {
    id: redCarId,
    number: "CAR 02",
    name: "RED COMET",
    src: "/assets/car-red.webp",
    battery: "74%",
    connection: "GOOD",
  },
];

function getQueueCars(
  operationalStatus: OperationalStatus | undefined,
): QueueCarPresentation[] {
  if (!operationalStatus) return simulationQueueCars;
  if (operationalStatus.state === "unavailable") return [];
  return operationalStatus.cars.map((car, index) => ({
    id: car.id,
    number: `CAR ${String(index + 1).padStart(2, "0")}`,
    name: car.name.toUpperCase(),
    src: null,
    battery: car.batteryPercent === null ? "—" : `${car.batteryPercent}%`,
    connection: "AVAILABLE",
  }));
}

function Header({ active }: { active: ScreenName }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-lockup"><strong>RC</strong> MANIA</span>
      </Link>
      <nav aria-label="Primary">
        <Link
          aria-current={active === "home" ? "page" : undefined}
          className={active === "home" ? "active" : ""}
          href="/"
        >
          Live Track
        </Link>
        <Link
          aria-current={active === "leaderboard" ? "page" : undefined}
          className={active === "leaderboard" ? "active" : ""}
          href="/leaderboard"
        >
          Leaderboard
        </Link>
        <Link
          aria-current={active === "pricing" ? "page" : undefined}
          className={active === "pricing" ? "active" : ""}
          href="/pricing"
        >
          Pricing
        </Link>
        <Link
          aria-current={active === "how-it-works" ? "page" : undefined}
          className={active === "how-it-works" ? "active" : ""}
          href="/how-it-works"
        >
          How It Works
        </Link>
      </nav>
      <AccountControl />
    </header>
  );
}

function IconLabel({
  icon: Icon,
  title,
  subtitle,
  tone = "cyan",
}: {
  icon: IconType;
  title: ReactNode;
  subtitle?: ReactNode;
  tone?: "cyan" | "lime" | "red" | "amber";
}) {
  return (
    <div className={`icon-label tone-${tone}`}>
      <Icon size={38} weight="regular" />
      <div>
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
    </div>
  );
}

function ActionButton({
  children,
  tone = "red",
  onClick,
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  tone?: "red" | "cyan" | "ghost" | "lime";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      className={`action-button action-${tone}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
    >
      <span>{children}</span>
      <ArrowRight size={21} weight="bold" />
    </button>
  );
}

function MobileGate() {
  return (
    <aside className="mobile-gate">
      <SteeringWheel size={54} />
      <h2>Desktop required to drive</h2>
      <p>
        Accounts, pricing and leaderboards work on mobile. Preflight, queue and
        car control require a desktop browser.
      </p>
      <Link href="/">Return to live track</Link>
    </aside>
  );
}

function HomeScreen({
  adminAccess,
  authenticated,
  mockMode,
  operationalStatus,
}: {
  adminAccess: boolean;
  authenticated: boolean;
  mockMode: boolean;
  operationalStatus?: OperationalStatus | undefined;
}) {
  const presentation = getHomePresentation(mockMode, adminAccess, authenticated);
  const viewerCount = useViewerCount();
  const useOperationalMetrics = mockMode && adminAccess;
  const operationalReady = operationalStatus?.state === "ready";
  const availableCars = useOperationalMetrics
    ? operationalReady ? operationalStatus.cars.length : "—"
    : "2";
  const queueCount = useOperationalMetrics
    ? operationalReady ? operationalStatus.queueCount : "—"
    : "4";
  const waitMinutes = useOperationalMetrics
    ? operationalReady ? operationalStatus.queueCount * 5 : "—"
    : "~12";
  const queueTitle = useOperationalMetrics
    ? operationalReady
      ? operationalStatus.cars.length > 0 ? "QUEUE OPEN" : "NO CARS ONLINE"
      : "STATUS UNAVAILABLE"
    : "QUEUE OPEN";

  return (
    <div className="page">
      <Header active="home" />
      <main className="home-main">
        <section className="hero-grid">
          <div className="hero-media panel-cut">
            {mockMode ? (
              <video
                aria-label="Black and red RC car racing on the indoor Neon Circuit"
                autoPlay
                disablePictureInPicture
                loop
                muted
                playsInline
                poster="/assets/hero-track.webp"
                preload="metadata"
              >
                <source src="/assets/hero-track.mp4" type="video/mp4" />
              </video>
            ) : (
              <img
                src="/assets/hero-track.webp"
                alt="Black and red RC car racing on the indoor Neon Circuit"
              />
            )}
            {presentation.showLiveBadge ? <span className="live-badge">● LIVE</span> : null}
            <span
              className={`viewer-badge${presentation.showLiveBadge ? "" : " viewer-badge-preview"}`}
            >
              {getViewerBadgeText(viewerCount.count, viewerCount.status)}
            </span>
          </div>
          <div className="hero-copy">
            <p className="eyebrow">{presentation.eyebrow}</p>
            <h1>DRIVE IT FOR REAL</h1>
            <p>Control a real RC car from your browser.</p>
            {presentation.ctaAction === "navigate" && presentation.ctaHref ? (
              <Link className="hero-link" href={presentation.ctaHref}>
                {presentation.ctaLabel} <ArrowRight size={28} weight="bold" />
              </Link>
            ) : presentation.ctaAction === "sign-in" ? (
              <button
                className="hero-link"
                onClick={() => void signIn("google", { redirectTo: "/" })}
                type="button"
              >
                {presentation.ctaLabel} <ArrowRight size={28} weight="bold" />
              </button>
            ) : (
              <span aria-disabled="true" className="hero-link hero-link-disabled">
                {presentation.ctaLabel} <Clock size={28} weight="bold" />
              </span>
            )}
          </div>
        </section>

        <section className="metric-grid" aria-label="Live track metrics">
          <IconLabel icon={CarProfile} title={availableCars} subtitle="CARS AVAILABLE" />
          <IconLabel icon={UsersThree} title={queueCount} subtitle="IN QUEUE" />
          <IconLabel icon={Clock} title={waitMinutes} subtitle="MIN WAIT" />
          <IconLabel
            icon={Flag}
            title={queueTitle}
            subtitle="JOIN THE LINE"
            tone="lime"
          />
        </section>

        <section className="home-cards" id="how-it-works">
          <article className="data-panel record-card">
            <img src="/assets/neon-circuit-map-simple-v2.webp" alt="Neon Circuit track layout" />
            <small>SEASON 01 RECORD</small>
            <h2>00:42.817</h2>
            <p>NIGHTSHIFT · TOP DRIVER</p>
          </article>
          <article className="data-panel value-card">
            <small>STARTING AT</small>
            <h2>$4 <em>/ 5 MIN</em></h2>
            <div className="card-features">
              <span><Timer size={22} /> Real cars</span>
              <span><ShieldCheck size={22} /> Safe & maintained</span>
              <span><ChartBar size={22} /> Low latency</span>
            </div>
            <Link href="/pricing">VIEW PRICING</Link>
          </article>
          <article className="data-panel challenge-card">
            <img
              className="challenge-art"
              src="/assets/challenge-burning-wheel.webp"
              alt="Burning racing wheel"
            />
            <small>SEASON CHALLENGE</small>
            <h3>BEAT THE TRACK RECORD</h3>
            <p>Finish the season with the fastest lap. Win.</p>
            <strong>$1,000</strong>
            <Link href="/leaderboard">LEARN MORE <ArrowRight size={16} /></Link>
          </article>
        </section>
      </main>
      <footer className="home-trust" aria-label="Track service highlights">
        <span><CarProfile size={28} /><b>REAL RC CARS<small>Professionally maintained</small></b></span>
        <span><Flag size={28} /><b>INDOOR TRACK<small>Controlled environment</small></b></span>
        <span><WifiHigh size={28} /><b>LIVE VIDEO<small>Multiple camera angles</small></b></span>
        <span><UsersThree size={28} /><b>GLOBAL COMMUNITY<small>Drivers worldwide</small></b></span>
      </footer>
    </div>
  );
}

const howItWorksIcons = [
  UserCircle,
  CreditCard,
  UsersThree,
  GameController,
  Flag,
] as const;

function HowItWorksScreen() {
  return (
    <div className="page">
      <Header active="how-it-works" />
      <main className="how-main">
        <section className="how-hero panel-cut">
          <div>
            <p className="eyebrow">HOW IT WORKS / REMOTE RACING</p>
            <h1>FROM SCREEN<br />TO TRACK</h1>
            <p>
              Five clear steps take you from a Google profile to driving a
              real RC car through your browser.
            </p>
          </div>
          <aside className="how-hero-status" aria-label="Journey summary">
            <span>01 — 05</span>
            <strong>ONE SIMPLE FLOW</strong>
            <small>PROFILE · TIME · QUEUE · CONTROLS · DRIVE</small>
          </aside>
        </section>

        <section className="how-step-grid" aria-label="How RC Mania works">
          {howItWorksSteps.map((step, index) => {
            const StepIcon = howItWorksIcons[index] ?? Flag;
            return (
              <article
                className={`how-step-card data-panel${step.id === "queue" ? " how-step-queue" : ""}`}
                key={step.id}
              >
                <span className="how-step-number">{step.number}</span>
                <StepIcon aria-hidden="true" size={35} />
                <small>STEP {step.number}</small>
                <h2>{step.title}</h2>
                <p>{step.description}</p>
              </article>
            );
          })}
        </section>

        <section className="how-bottom-grid">
          <article className="how-requirements data-panel">
            <div>
              <p className="eyebrow">READY TO CONNECT?</p>
              <h2>WHAT YOU NEED</h2>
            </div>
            <ul>
              {howItWorksRequirements.map((requirement) => (
                <li key={requirement}><CheckCircle size={22} /> {requirement}</li>
              ))}
            </ul>
          </article>

          <aside className="how-fast-lane data-panel">
            <Lightning aria-hidden="true" size={42} />
            <div>
              <small>EMPTY QUEUE</small>
              <strong>START RIGHT AWAY</strong>
              <p>No waiting when the track is available.</p>
            </div>
          </aside>

          <div className="how-actions">
            <Link className="hero-link" href="/pricing#packs">
              VIEW PRICING <ArrowRight size={22} weight="bold" />
            </Link>
            <Link className="action-button action-cyan" href="/">
              BACK TO LIVE TRACK <Flag size={22} />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}

const oneTimePacks = [
  ["STARTER 5", "$4", "5 MIN", "one_time"],
  ["STARTER 10", "$7", "10 MIN", "one_time"],
  ["RACE PACK", "$45", "50 MIN", "one_time"],
] as const;
const memberships = [
  ["CASUAL", "$9", "120 MIN", "Up to 60 min rollover"],
  ["RACER", "$19", "300 MIN", "Up to 150 min rollover"],
  ["PRO", "$29", "600 MIN", "Up to 300 min rollover"],
] as const;

function PricingScreen() {
  const [notice, setNotice] = useState("");
  const [creatorCode, setCreatorCode] = useState("");

  async function checkout(kind: "one_time" | "subscription", index: number) {
    setNotice("Creating secure checkout…");
    try {
      const result = await apiRequest<{ url: string }>("/v1/checkout-sessions", {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          priceId: `price_sim_${kind}_${index}`,
          kind,
        }),
      });
      setNotice(`Checkout ready: ${result.url}`);
    } catch {
      setNotice("Simulation checkout ready — no payment was taken.");
    }
  }

  return (
    <div className="page">
      <Header active="pricing" />
      <main className="pricing-main">
        <div className="title-row pricing-title">
          <div>
            <h1>CHOOSE YOUR DRIVE TIME</h1>
            <p>One-time packs or monthly memberships. More track time, more value.</p>
          </div>
          <div className="pricing-status">
            <article className="balance-panel data-panel">
              <small>CURRENT BALANCE</small>
              <strong><Timer size={34} /> 12:30 <em>MIN</em></strong>
              <Link href="#packs">ADD TIME <ArrowRight size={17} weight="bold" /></Link>
            </article>
            <IconLabel
              icon={ShieldCheck}
              title="SECURE CHECKOUT"
              subtitle="Safe. Encrypted. Built for speed."
            />
          </div>
        </div>
        <section className="product-grid" id="packs">
          {oneTimePacks.map(([name, price, time], index) => (
            <article className={`product-card ${index === 2 ? "popular" : ""}`} key={name}>
              {index === 2 ? <span className="ribbon">POPULAR</span> : null}
              <h3>{name}</h3>
              <strong>{price}</strong>
              <b>{time}</b>
              <div className="product-footer">
                <span><Timer size={29} /> ONE-TIME PACK</span>
                <ActionButton onClick={() => void checkout("one_time", index)}>
                  BUY TIME
                </ActionButton>
              </div>
            </article>
          ))}
          {memberships.map(([name, price, time, rollover], index) => (
            <article
              className={`product-card membership ${index === 1 ? "featured" : ""}`}
              key={name}
            >
              {index === 1 ? <span className="ribbon">BEST VALUE</span> : null}
              <h3>{name}</h3>
              <p>{index === 0 ? "Perfect for occasional drivers" : index === 1 ? "More time. Better value." : "Maximum time for dedicated racers"}</p>
              <div className="membership-features">
                <span><Clock size={27} /> {time}<small>Per month</small></span>
                <span><Repeat size={27} /> {rollover}</span>
                <span><CalendarBlank size={27} /> Cancel anytime</span>
              </div>
              <div className="product-footer">
                <strong>{price}<small>/ MONTH</small></strong>
                <ActionButton onClick={() => void checkout("subscription", index)}>
                  SUBSCRIBE
                </ActionButton>
              </div>
            </article>
          ))}
        </section>
        <form
          className="creator-form"
          onSubmit={(event) => {
            event.preventDefault();
            setNotice(
              creatorCode.trim().toUpperCase() === "GRID10"
                ? "Creator code applied: +60 seconds"
                : "Code not found in this simulation",
            );
          }}
        >
          <label htmlFor="creator-code">CREATOR CODE</label>
          <input
            id="creator-code"
            value={creatorCode}
            onChange={(event) => setCreatorCode(event.target.value)}
            placeholder="Enter code"
          />
          <ActionButton tone="cyan" type="submit">APPLY</ActionButton>
          <output aria-live="polite">{notice}</output>
          {!notice ? <small className="charge-note">Final charge in USD. Local estimate shown for reference.</small> : null}
        </form>
      </main>
    </div>
  );
}

function LeaderboardScreen({ mockMode }: { mockMode: boolean }) {
  const presentation = getLeaderboardPresentation(mockMode);
  const SeasonStatusIcon = mockMode ? Clock : CheckCircle;

  return (
    <div className="page">
      <Header active="leaderboard" />
      <main className="leaderboard-main">
        <section className="season-banner panel-cut">
          <div><small>SEASON 01 —</small><h1>NEON CIRCUIT</h1></div>
          <IconLabel
            icon={SeasonStatusIcon}
            title={presentation.seasonStatus.title}
            subtitle={presentation.seasonStatus.subtitle}
            tone={mockMode ? "cyan" : "lime"}
          />
          <img className="season-track" src="/assets/neon-circuit-map-simple-v2.webp" alt="Neon Circuit track layout" />
          <IconLabel
            icon={Trophy}
            title={presentation.prize.title}
            subtitle={presentation.prize.subtitle}
            tone={mockMode ? "cyan" : "lime"}
          />
          <Link className="action-button action-cyan" href="/how-it-works">
            <span>VIEW RULES</span>
            <ArrowRight size={21} weight="bold" />
          </Link>
        </section>
        <div className="leaderboard-layout">
          <section className="ranking-table data-panel">
            <div className="table-row table-head">
              <span>RANK</span><span>DRIVER</span><span>BEST LAP</span><span>GAP</span><span>DATE</span><span>STATUS</span>
            </div>
            {presentation.emptyMessage ? (
              <div className="leaderboard-empty-note" role="status">
                {presentation.emptyMessage}
              </div>
            ) : null}
            {presentation.rows.map((row, index) => (
              <div
                className={`table-row ${!row.placeholder && index < 3 ? `podium podium-${index + 1}` : ""} ${row.placeholder ? "placeholder-row" : ""}`}
                key={row.key}
              >
                <strong>{row.rank}</strong>
                <b>{row.driver}</b>
                <strong>{row.lap}</strong>
                <span>{row.gap}</span>
                <small>{row.date}</small>
                <em className={row.placeholder ? "" : row.status === "CONFIRMED" ? "confirmed" : "pending"}>{row.status}</em>
              </div>
            ))}
            {presentation.personalRow ? (
              <div className="table-row you-row">
                <strong>{presentation.personalRow.rank}</strong>
                <b>{presentation.personalRow.driver}</b>
                <strong>{presentation.personalRow.lap}</strong>
                <span>{presentation.personalRow.gap}</span>
                <small>{presentation.personalRow.date}</small>
                <em>{presentation.personalRow.status}</em>
              </div>
            ) : null}
          </section>
          <div className="season-side">
            <aside className="your-season data-panel">
              <h2>YOUR SEASON</h2>
              <small>RANK</small><strong>{presentation.personal.rank}</strong>
              <small>PERSONAL BEST</small><b>{presentation.personal.bestLap}</b>
              <IconLabel icon={Gauge} title={presentation.personal.validLaps} subtitle="VALID LAPS" />
              <IconLabel icon={ChartBar} title={presentation.personal.weeklyChange} subtitle="THIS WEEK" tone="lime" />
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepRail({ active }: { active: number }) {
  const labels = ["SYSTEM", "CONNECTION", "CONTROLS", "READY"];
  return (
    <ol className="step-rail">
      {labels.map((label, index) => (
        <li className={index + 1 < active ? "done" : index + 1 === active ? "active" : ""} key={label}>
          <span>{index + 1 < active ? <Check size={20} weight="bold" /> : index + 1}</span>
          <b>{label}</b>
        </li>
      ))}
    </ol>
  );
}

function PreflightScreen() {
  const router = useRouter();
  const [pressedKeys, setPressedKeys] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const update = (event: KeyboardEvent, pressed: boolean) => {
      if (!controlKeyForCode(event.code)) return;
      if (event.code.startsWith("Arrow")) event.preventDefault();
      setPressedKeys((current) => updatePressedKeys(current, event.code, pressed));
    };
    const keyDown = (event: KeyboardEvent) => update(event, true);
    const keyUp = (event: KeyboardEvent) => update(event, false);
    const clear = () => setPressedKeys(new Set());
    const visibility = () => {
      if (document.visibilityState !== "visible") clear();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  return (
    <div className="page desktop-flow">
      <Header active="preflight" />
      <MobileGate />
      <main className="flow-main">
        <StepRail active={3} />
        <div className="flow-content">
          <div className="title-row preflight-title">
            <div><h1>PRE-FLIGHT CHECK</h1><p>Press the controls once to confirm your keyboard responds in the browser.</p></div>
          </div>
          <section className="preflight-grid">
            <article className="data-panel controller-card">
              <div className="panel-heading">
                <h2>CONTROLLER SETUP</h2>
                <div className="segmented">
                  <button
                    aria-pressed="true"
                    className="selected"
                    type="button"
                  >
                    <Keyboard size={18} /> KEYBOARD
                  </button>
                  <button
                    aria-disabled="true"
                    aria-pressed="false"
                    disabled
                    type="button"
                  >
                    <GameController size={18} /> GAMEPAD <small>COMING SOON</small>
                  </button>
                </div>
              </div>
              <div className="keyboard-asset" aria-label="Keyboard driving controls">
                <div className="keyboard-wasd">
                  <span /><PreflightKey active={isDriveKeyActive(pressedKeys, "W")} label="W" alias="↑" /><span />
                  <PreflightKey active={isDriveKeyActive(pressedKeys, "A")} label="A" alias="←" />
                  <PreflightKey active={isDriveKeyActive(pressedKeys, "S")} label="S" alias="↓" />
                  <PreflightKey active={isDriveKeyActive(pressedKeys, "D")} label="D" alias="→" />
                </div>
                <PreflightKey
                  active={isDriveKeyActive(pressedKeys, "NITRO")}
                  className="keyboard-nitro-key"
                  label="N"
                />
              </div>
              <ul className="control-bindings">
                <li><kbd>W / ↑</kbd><span>THROTTLE<small>Forward</small></span></li>
                <li><kbd>A / ←</kbd><span>STEER LEFT<small>Left</small></span></li>
                <li><kbd>S / ↓</kbd><span>REVERSE<small>Backward</small></span></li>
                <li><kbd>D / →</kbd><span>STEER RIGHT<small>Right</small></span></li>
                <li><kbd>N</kbd><span>NITRO<small>Hold with forward</small></span></li>
              </ul>
              <p className="success-line"><CheckCircle size={22} /> Keyboard input is ready</p>
            </article>
          </section>
          <section className="neutral-panel data-panel">
            <IconLabel icon={Keyboard} title="KEYBOARD READY" subtitle="WASD and arrow keys use the same controls." tone="lime" />
            <ActionButton onClick={() => router.push("/queue")}>CONTINUE TO QUEUE</ActionButton>
          </section>
        </div>
      </main>
    </div>
  );
}

function PreflightKey({
  active,
  alias,
  className = "",
  label,
}: {
  readonly active: boolean;
  readonly alias?: string;
  readonly className?: string;
  readonly label: string;
}) {
  const classes = [className, active ? "pressed" : ""].filter(Boolean).join(" ");

  return <kbd aria-pressed={active} className={classes}>{label}{alias ? <small>/{alias}</small> : null}</kbd>;
}

function QueueScreen({
  operationalStatus,
}: {
  operationalStatus?: OperationalStatus | undefined;
}) {
  const router = useRouter();
  const queueCars = getQueueCars(operationalStatus);
  const hasAvailableCars = queueCars.length > 0;
  const [selectedCar, setSelectedCar] = useState(queueCars[0]?.id ?? "");
  const fleetUnavailable = operationalStatus?.state === "unavailable";
  const [status, setStatus] = useState("Joining live queue…");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await apiRequest("/v1/queue", { method: "POST", body: "{}" });
        await apiRequest("/v1/simulation/offers", { method: "POST", body: "{}" });
        if (!cancelled) setStatus("Your car is ready");
      } catch {
        if (!cancelled) setStatus("Simulation offer ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function accept() {
    if (!selectedCar) return;
    setStatus("Connecting…");
    router.push(getRideUrl(selectedCar));
  }

  return (
    <div className="page desktop-flow">
      <Header active="queue" />
      <MobileGate />
      <main className="queue-main">
        <section className="queue-left">
          <div className="title-row"><h1>LIVE QUEUE</h1><IconLabel icon={UsersThree} title={operationalStatus ? queueCars.length : "2"} subtitle="CARS ONLINE" tone="lime" /></div>
          <article className="data-panel queue-position">
            <div className="queue-position-heading">
              <div><h2>YOU ARE #1</h2><p>NEXT TO DRIVE</p></div>
              <small><Clock size={21} /> JOINED 00:45 AGO</small>
            </div>
            <div className="queue-line">
              {[1, 2, 3, 4, 5].map((position) => (
                <span className={position === 1 ? "you" : ""} key={position}>
                  <b>P{position}</b>
                  <img src="/assets/queue-car-top.webp" alt="" />
                  {position === 1 ? <small>YOU</small> : null}
                </span>
              ))}
            </div>
            <div className="safe-note"><ShieldCheck size={25} /> WAITING DOES NOT USE YOUR BALANCE</div>
            <div className="queue-progress" aria-label="Queue progress">
              {[
                ["✓", "JOINED", "00:45"],
                ["2", "IN POSITION", "NOW"],
                ["3", "NEXT UP", ""],
                ["4", "ON DECK", ""],
                ["5", "WAITING", ""],
              ].map(([marker, label, detail], index) => (
                <span className={index < 2 ? "active" : ""} key={label}>
                  <b>{marker}</b><em>{label}</em><small>{detail}</small>
                </span>
              ))}
            </div>
          </article>
          <article className="data-panel queue-closed">
            <Stop size={38} />
            <span><strong>QUEUE CLOSED (PREVIEW)</strong><small>The queue is currently closed. You&apos;ll be notified when it reopens.</small></span>
            <ActionButton tone="ghost" disabled>NOTIFY ME</ActionButton>
          </article>
        </section>
        <section className="offer-panel">
          <div className="offer-heading">
            {hasAvailableCars ? (
              <div><p className="eyebrow">{status}</p><h2>YOUR CAR IS READY</h2><span>Choose a car when you&apos;re ready.</span></div>
            ) : (
              <div><p className="eyebrow">WAITING FOR AVAILABILITY</p><h2>NO CAR IS READY YET</h2><span>Stay in the queue. You can connect as soon as a car comes online.</span></div>
            )}
          </div>
          <h3>SELECT YOUR CAR</h3>
          <div className="car-choice-grid">
            {queueCars.map(({ id, number, name, src, battery, connection }) => (
              <button
                aria-pressed={selectedCar === id}
                className={`car-choice ${selectedCar === id ? "selected" : ""}`}
                key={id}
                onClick={() => setSelectedCar(id)}
                type="button"
              >
                {selectedCar === id ? <CheckCircle className="choice-check" size={32} weight="fill" /> : null}
                {src ? <img src={src} alt={`${name} RC car`} /> : <CarProfile aria-hidden="true" size={72} />}
                <small>{number}</small><strong>{name}</strong>
                <span><BatteryHigh size={28} /> {battery}</span><span><WifiHigh size={28} /> {connection}</span>
              </button>
            ))}
            {queueCars.length === 0 ? (
              <div className="car-choice-empty" role="status">
                <CarProfile aria-hidden="true" size={54} />
                <strong>{fleetUnavailable ? "CAR STATUS UNAVAILABLE" : "NO CARS AVAILABLE"}</strong>
                <span>{fleetUnavailable ? "Live fleet data could not be loaded." : "No production car is currently ready to drive."}</span>
              </div>
            ) : null}
          </div>
          <div className="offer-actions">
            <ActionButton disabled={!selectedCar} onClick={accept}>ACCEPT & CONNECT</ActionButton>
            <ActionButton tone="ghost" onClick={() => router.push("/")}>LEAVE QUEUE</ActionButton>
          </div>
          <p className="fine-print"><ShieldCheck size={17} /> First come, first served. Memberships do not receive priority.</p>
        </section>
      </main>
    </div>
  );
}

function RideScreen({ mockMode }: { mockMode: boolean }) {
  const router = useRouter();
  const videoStatusLabel = getVideoStatusLabel(mockMode);
  const loopRef = useRef<BrowserControlLoop | null>(null);
  const pressedRef = useRef<ReadonlySet<string>>(new Set());
  const [muted, setMuted] = useState(mockMode);
  const [remaining, setRemaining] = useState(138);
  const [lapTime, setLapTime] = useState(31842);
  const [control, setControl] = useState({ steering: 0, throttle: 0, nitro: false });

  useEffect(() => {
    const loop = new BrowserControlLoop(rideId);
    loopRef.current = loop;
    loop.start();
    const neutral = () => {
      loop.neutral("browser_focus_lost");
      pressedRef.current = new Set();
      setControl({ steering: 0, throttle: 0, nitro: false });
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") neutral();
    };
    window.addEventListener("blur", neutral);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", neutral);
      document.removeEventListener("visibilitychange", onVisibility);
      loop.stop();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setRemaining((value) => Math.max(0, value - 1));
      setLapTime((value) => value + 47);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function key(event: KeyboardEvent, pressed: boolean) {
      const logicalKey = controlKeyForCode(event.code);
      if (!logicalKey) return;
      event.preventDefault();
      pressedRef.current = updatePressedKeys(pressedRef.current, event.code, pressed);
      const next = controlIntentFromPressedKeys(pressedRef.current);
      setControl(next);
      loopRef.current?.setInput(next);
    }
    const down = (event: KeyboardEvent) => key(event, true);
    const up = (event: KeyboardEvent) => key(event, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const timeLeft = useMemo(
    () => `${Math.floor(remaining / 60).toString().padStart(2, "0")}:${(remaining % 60).toString().padStart(2, "0")}`,
    [remaining],
  );

  async function endRide() {
    loopRef.current?.neutral("user_ended");
    try {
      await apiRequest(`/v1/rides/${rideId}/end`, { method: "POST", body: "{}" });
    } catch {
      // Offline-friendly reference flow.
    }
    router.push("/results");
  }

  return (
    <div className="ride-page desktop-flow">
      <MobileGate />
      {mockMode ? (
        <video
          aria-label="Onboard view behind a green RC car on the Neon Circuit"
          autoPlay
          className="drive-poster"
          disablePictureInPicture
          loop
          muted={muted}
          playsInline
          poster="/assets/drive-onboard.webp"
          preload="metadata"
        >
          <source src="/assets/drive-onboard.mp4" type="video/mp4" />
        </video>
      ) : (
        <img
          className="drive-poster"
          src="/assets/drive-onboard.webp"
          alt="Onboard view behind a green RC car on the Neon Circuit"
        />
      )}
      <div className="ride-shade" />
      <div className="ride-brand"><span className="brand"><span className="brand-lockup"><strong>RC</strong> MANIA</span></span><b>{videoStatusLabel}</b></div>
      <div className="ride-left-stats"><small>PERSONAL BEST</small><strong>00:47.306</strong><small>SEASON RANK</small><strong>#27</strong></div>
      <div className="lap-clock"><small>LAP 04</small><strong>{`00:${(lapTime / 1000).toFixed(3).padStart(6, "0")}`}</strong><em>-00.684</em></div>
      <div className="time-ring"><small>TIME LEFT</small><strong>{timeLeft}</strong></div>
      <aside className="ride-telemetry">
        <IconLabel icon={BatteryHigh} title="78%" subtitle="BATTERY" tone="lime" />
        <IconLabel icon={WifiHigh} title="GOOD" subtitle="60 ms" tone="lime" />
        <button
          aria-label={muted ? "Unmute ride audio" : "Mute ride audio"}
          aria-pressed={muted}
          onClick={() => setMuted((value) => !value)}
          type="button"
        >
          <SpeakerHigh size={36} /><span>{muted ? "MUTED" : "AUDIO"}</span>
        </button>
        <IconLabel icon={GameController} title="CONNECTED" subtitle={`S ${control.steering} · T ${control.throttle}`} />
      </aside>
      <div className="ride-actions">
        <span><Clock size={27} /> EXTEND RIDE? 5:00 AVAILABLE — QUEUE EMPTY</span>
        <ActionButton onClick={() => setRemaining((value) => value + 300)}>EXTEND +5 MIN</ActionButton>
      </div>
      <button className="end-ride" onClick={() => void endRide()} type="button"><Flag size={28} /> END RIDE</button>
    </div>
  );
}

function ResultsScreen() {
  const router = useRouter();
  const laps = [
    ["1", "00:49.214", "+02.592", "VALID"],
    ["2", "00:47.981", "+01.359", "VALID"],
    ["3", "00:47.055", "+00.433", "VALID"],
    ["4", "00:46.622", "—", "BEST LAP"],
    ["5", "--:--.---", "—", "INVALID"],
  ];
  return (
    <div className="page">
      <Header active="results" />
      <main className="results-main">
        <div className="result-heading">
          <div><h1>/// RIDE COMPLETE</h1><p>Car 01 returned safely</p></div>
          <img src="/assets/neon-circuit-map-simple-v2.webp" alt="Neon Circuit track layout" />
        </div>
        <section className="personal-best-panel">
          <div><small>NEW PERSONAL BEST</small><strong>00:46.622</strong></div>
          <div><small>PREVIOUS BEST</small><b>00:47.306</b></div>
          <div><small>IMPROVEMENT</small><b>-00.684</b></div>
          <div><small>SEASON RANK IMPROVED</small><b>#27 → #19</b></div>
        </section>
        <section className="results-grid">
          <article className="data-panel lap-summary">
            <h2><Timer size={28} /> LAP SUMMARY</h2>
            {laps.map(([number, time, gap, status]) => (
              <div className={status === "BEST LAP" ? "best" : ""} key={number}><span>{number}</span><strong>{time}</strong><em>{gap}</em><b>{status}</b></div>
            ))}
            <small>Only valid laps are used for rankings.</small>
          </article>
          <div className="ride-summary-column">
            <article className="data-panel ride-summary">
              <h2><Flag size={28} /> RIDE SUMMARY</h2>
              <span><small>TOTAL DRIVE TIME</small><strong>09:42</strong></span>
              <span><small>BLOCKS USED</small><strong>2</strong></span>
              <span><small>VALID LAPS</small><strong>5</strong></span>
              <span><small>BEST LAP</small><strong>00:46.622</strong></span>
              <span><small>END REASON</small><strong>USER ENDED</strong></span>
            </article>
            <article className="data-panel settlement">
              <span><small>STARTING BALANCE</small><b>17:30</b></span>
              <strong>−</strong><span><small>TIME USED</small><b>10:00</b></span>
              <strong>+</strong><span><small>COMPENSATION</small><b>+0:00</b></span>
              <strong>=</strong><span><small>NEW BALANCE</small><b>07:30</b></span>
            </article>
          </div>
        </section>
        <section className="result-actions">
          <ActionButton onClick={() => router.push("/preflight")}>DRIVE AGAIN</ActionButton>
          <ActionButton tone="cyan" onClick={() => router.push("/leaderboard")}>VIEW LEADERBOARD</ActionButton>
          <ActionButton tone="ghost"><Warning size={20} /> REPORT A PROBLEM</ActionButton>
          <p>Video evidence is guaranteed for reports filed within 30 minutes.</p>
        </section>
      </main>
    </div>
  );
}

function OperatorScreen() {
  const [scenario, setScenario] = useState("normal");
  const [message, setMessage] = useState("All systems nominal");
  const scenarios = ["normal", "webrtc-five-failures", "tab-reconnect", "pi-offline", "esp32-offline", "uart-corrupt", "battery-low", "battery-critical", "wan-failover", "redis-reset", "timing-offline", "camera-offline", "public-stream-offline", "disk-full", "power-loss"];
  async function applyScenario() {
    try {
      const result = await apiRequest<{ safetyAction: string }>(`/v1/simulation/scenarios/${scenario}`, { method: "POST", body: "{}" });
      setMessage(`Scenario applied · ${result.safetyAction}`);
    } catch {
      setMessage("Scenario selected locally; API is offline");
    }
  }
  return (
    <div className="page">
      <Header active="operator" />
      <main className="operator-main">
        <div className="title-row"><div><p className="eyebrow">OPERATIONS / PRAGUE NEON</p><h1>TRACK CONTROL</h1></div><IconLabel icon={Headphones} title="OPERATOR ONLINE" subtitle={message} tone="lime" /></div>
        <section className="operator-grid">
          <article className="data-panel fleet-panel">
            <h2>FLEET STATUS</h2>
            {[
              ["Night Runner", "AVAILABLE", "86%", "Pi online · ESP32 online"],
              ["Red Comet", "AVAILABLE", "74%", "Pi online · ESP32 online"],
              ["Reserve 03", "RECOVERY", "58%", "Camera calibration pending"],
            ].map(([name, state, battery, health]) => <div key={name}><CarProfile size={36} /><strong>{name}</strong><em>{state}</em><span>{battery}</span><small>{health}</small></div>)}
          </article>
          <article className="data-panel scenario-panel">
            <h2>SCENARIO CONTROLLER</h2>
            <label htmlFor="scenario">Failure or normal path</label>
            <select id="scenario" value={scenario} onChange={(event) => setScenario(event.target.value)}>
              {scenarios.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ActionButton tone="cyan" onClick={() => void applyScenario()}>APPLY SCENARIO</ActionButton>
            <p>Simulation adapters share production contracts. Ledger, queue and state transitions remain authoritative.</p>
          </article>
          <article className="data-panel stop-panel">
            <Warning size={52} /><h2>SAFETY CONTROL</h2><p>Operator stop overrides browser, WebRTC, Pi and UART control commands.</p>
            <ActionButton tone="red"><Stop size={22} weight="fill" /> STOP ALL CARS</ActionButton>
          </article>
        </section>
      </main>
    </div>
  );
}

export function SimulationScreen({
  adminAccess = false,
  authenticated = false,
  mockMode = false,
  operationalStatus,
  screen,
}: {
  adminAccess?: boolean;
  authenticated?: boolean;
  mockMode?: boolean;
  operationalStatus?: OperationalStatus | undefined;
  screen: ScreenName;
}) {
  if (screen === "pricing") return <PricingScreen />;
  if (screen === "how-it-works") return <HowItWorksScreen />;
  if (screen === "leaderboard") return <LeaderboardScreen mockMode={mockMode} />;
  if (screen === "preflight") return <PreflightScreen />;
  if (screen === "queue") return <QueueScreen operationalStatus={operationalStatus} />;
  if (screen === "loading") {
    return (
      <ConnectionLoadingScreen
        adminAccess={adminAccess}
        mockMode={mockMode}
        operationalStatus={operationalStatus}
      />
    );
  }
  if (screen === "ride") return mockMode && adminAccess ? <RealRideScreen /> : <RideScreen mockMode={mockMode} />;
  if (screen === "results") return <ResultsScreen />;
  if (screen === "operator") return <OperatorScreen />;
  return (
    <HomeScreen
      adminAccess={adminAccess}
      authenticated={authenticated || adminAccess}
      mockMode={mockMode}
      operationalStatus={operationalStatus}
    />
  );
}
