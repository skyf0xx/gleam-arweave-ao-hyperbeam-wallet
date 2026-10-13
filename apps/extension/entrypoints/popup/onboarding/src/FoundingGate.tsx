import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { InviteRedeemResult, InviteUnlock, RuntimePort } from "@gleam/core";
import { BeamMark } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { ChevronIcon } from "@gleam/ui/src/primitives/chevron-icon.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { cn } from "@gleam/ui/src/primitives/cn.ts";
import { browser } from "wxt/browser";
import { askInvitePost, fullInvitePost, xIntentUrl } from "@/src/points-share";
import { sitePageUrl } from "@/src/site-pages";

const X_PROFILE_URL = "https://x.com/gleam_wallet";

const MESSAGES: Record<Exclude<InviteRedeemResult, "ok">, string> = {
  full: "That code is full. Its seats have all been taken.",
  unknown: "We couldn't find that code. Check it and try again.",
  offline: "Gleam can't reach the invite server. Try again in a moment.",
};

/**
 * Accepts a typed or pasted code, or a whole invite link (`invite.html?c=`),
 * so nobody has to retype a code they were sent. Separators, spaces and
 * case are dropped.
 */
export function codeFromInput(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const params = new URL(trimmed).searchParams;
      return codeFromInput(params.get("c") ?? params.get("code") ?? "");
    } catch {
      // Not a parseable link: fall through and treat it as a code.
    }
  }
  return trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 16);
}

/** Long enough for the beam to finish drawing before Welcome replaces it. */
const UNLOCKED_HOLD_MS = 1400;

export interface FoundingGateProps {
  runtime: RuntimePort;
  /** The stored outcome of an earlier attempt, if any. */
  initialUnlock: InviteUnlock | null;
  onUnlocked: () => void;
}

export function FoundingGate({ runtime, initialUnlock, onUnlocked }: FoundingGateProps) {
  const [code, setCode] = useState(initialUnlock?.code ?? "");
  const [verdict, setVerdict] = useState<Exclude<InviteRedeemResult, "ok"> | null>(
    initialUnlock && initialUnlock.result !== "ok" ? initialUnlock.result : null,
  );
  const [unlocked, setUnlocked] = useState(false);
  const [emptyPrompt, setEmptyPrompt] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLDivElement>(null);

  const redeem = useMutation({
    mutationFn: (value: string) =>
      runtime.send<{ code: string }, InviteUnlock>({ type: "redeemPointsInvite", payload: { code: value } }),
    onSuccess: (unlock) => {
      if (unlock.result === "ok") setUnlocked(true);
      else setVerdict(unlock.result);
    },
    // The background rejects a malformed code before asking the server.
    onError: () => setVerdict("unknown"),
  });

  const submit = (value: string) => {
    setVerdict(null);
    redeem.mutate(value);
  };

  // An earlier attempt that got no answer is retried once on open.
  const retried = useRef(false);
  useEffect(() => {
    if (initialUnlock?.result !== "offline" || retried.current) return;
    retried.current = true;
    submit(initialUnlock.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kept in a ref so a parent re-render can't restart the hold timer.
  const onUnlockedRef = useRef(onUnlocked);
  onUnlockedRef.current = onUnlocked;
  useEffect(() => {
    if (!unlocked) return;
    const timer = window.setTimeout(() => onUnlockedRef.current(), UNLOCKED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [unlocked]);

  const checking = redeem.isPending;
  const full = verdict === "full";

  const hasCode = code.length > 0;
  // A full code is exactly when someone needs another one, so the ask
  // options open by themselves.
  const showAsk = askOpen || full;
  // The ask options open below the fold in the popup, so bring them up.
  useEffect(() => {
    if (askOpen) askRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [askOpen]);

  const errorMessage = verdict ? MESSAGES[verdict] : emptyPrompt ? "Enter your invite code." : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (checking || unlocked) return;
    if (!hasCode) {
      setEmptyPrompt(true);
      inputRef.current?.focus();
      return;
    }
    submit(code);
  };

  return (
    <div className="flex min-h-full flex-col items-center px-7 pt-8">
      <BeamMark animated />

      <div className="mt-7 flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.025em] text-foreground">You&apos;re early.</h1>
        <p className="text-body text-muted">
          Members are earning{" "}
          <EarningWord href={sitePageUrl("gleam", browser.runtime.getManifest().version)} />
        </p>
      </div>

      <form className="mt-8 flex w-full flex-col gap-3" onSubmit={onSubmit} noValidate>
        <TextField
          ref={inputRef}
          aria-label="Invite code"
          placeholder="Paste your invite code or link"
          value={code}
          onChange={(event) => {
            setCode(codeFromInput(event.target.value));
            setVerdict(null);
            setEmptyPrompt(false);
          }}
          readOnly={unlocked}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          className={cn(
            "text-center font-mono tracking-[0.12em] placeholder:font-sans placeholder:tracking-normal",
            hasCode && "uppercase",
            unlocked && "border-positive focus:border-positive",
          )}
          errorMessage={errorMessage}
        />
        {unlocked ? (
          <p role="status" className="flex items-center justify-center gap-1.5 text-caption font-semibold text-positive">
            <CheckIcon />
            You&apos;re in.
          </p>
        ) : null}
        <Button
          type="submit"
          variant={hasCode && !full ? "primary" : "secondary"}
          aria-disabled={checking || unlocked}
          className={cn((checking || unlocked) && "pointer-events-none")}
        >
          {unlocked ? "Unlocked" : checking ? "Checking…" : "Unlock Gleam"}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {checking ? "Checking your code" : ""}
        </span>
      </form>

      <div className="mt-5 flex w-full flex-col items-center gap-3">
        <button
          type="button"
          aria-expanded={showAsk}
          aria-controls="founding-gate-ask"
          onClick={() => setAskOpen((open) => !open)}
          className="flex items-center gap-1 text-label font-semibold text-foreground hover:opacity-70"
        >
          Get an invitation
          <ChevronIcon open={showAsk} />
        </button>
        {showAsk ? (
          <div id="founding-gate-ask" ref={askRef} className="flex w-full flex-col items-center gap-3">
            <p className="text-center text-caption text-muted">
              Get an invite from a member or watch{" "}
              <a
                href={X_PROFILE_URL}
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline underline-offset-2"
              >
                for drops on X
              </a>
            </p>
            <Button asChild variant={full ? "primary" : "secondary"}>
              <a href={xIntentUrl(full ? fullInvitePost() : askInvitePost())} target="_blank" rel="noreferrer">
                Ask for an invite on X
              </a>
            </Button>
          </div>
        ) : null}
      </div>

      <div role="presentation" className="relative -mx-7 mt-auto h-44 w-[calc(100%+3.5rem)] shrink-0">
        <ConvergingLines lit={unlocked} />
      </div>
    </div>
  );
}

const TICK_MS = 2600;

/**
 * GLEAM, with a +1 landing on it every few seconds in the next beam colour,
 * so "are earning" is shown rather than claimed. The word punches as each
 * point lands; the two punch keyframes alternate so the animation restarts
 * without remounting the link. Reduced motion keeps only the underline.
 */
function EarningWord({ href }: { href: string }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-punch={tick === 0 ? undefined : tick % 2 ? "a" : "b"}
      className="gleam-earning-word font-bold tracking-[0.02em] text-foreground"
    >
      GLEAM
      {tick > 0 ? (
        <span
          key={tick}
          aria-hidden="true"
          className="gleam-earning-tick"
          style={{ color: LINE_COLORS[(tick - 1) % LINE_COLORS.length] }}
        >
          +1
        </span>
      ) : null}
    </a>
  );
}

const LINE_COLORS = ["var(--color-beam-red)", "var(--color-beam-purple)", "var(--color-beam-sky)", "var(--color-beam-yellow)", "var(--color-beam-green)"];
const LINES_W = 400;
const LINES_H = 176;
/** Where the lines aim: the beam mark, about this far above the box. */
const MARK_ABOVE = 400;

/**
 * Five beam lines rising from the popup's foot toward the beam mark, each
 * cut where it leaves the box. Pulses run up them while locked; on unlock
 * they light and reach further.
 */
const LINE_PATHS = [-10, 95, 200, 305, 410].map((x0, i) => {
  const tipX = LINES_W / 2 + (i - 2) * 8;
  const y0 = LINES_H + 10;
  const t = y0 / (y0 + MARK_ABOVE);
  return `M${x0} ${y0} L${x0 + (tipX - x0) * t} 0`;
});

function ConvergingLines({ lit }: { lit: boolean }) {
  return (
    <svg
      className="gleam-gate-lines absolute inset-0 h-full w-full"
      data-lit={lit || undefined}
      viewBox={`0 0 ${LINES_W} ${LINES_H}`}
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      {LINE_PATHS.map((d, i) => (
        <g key={d} stroke={LINE_COLORS[i]} vectorEffect="non-scaling-stroke">
          <path className="gleam-gate-line" d={d} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path
            className="gleam-gate-line-pulse"
            d={d}
            strokeWidth="2.5"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ animationDelay: `${i * 0.45}s` }}
          />
        </g>
      ))}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

