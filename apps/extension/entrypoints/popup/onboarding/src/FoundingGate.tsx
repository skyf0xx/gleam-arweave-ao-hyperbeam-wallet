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
    <div className="flex min-h-full flex-col items-center px-8 pb-6 pt-7">
      <div className="mt-6">
        <BeamMark animated />
      </div>

      <div className="mt-7 flex flex-col items-center gap-2 text-center">
        <h1 className="text-h2 font-semibold tracking-tight text-foreground">You&apos;re early.</h1>
        <p className="text-body text-muted">
          Join now and earn{" "}
          <a
            href={sitePageUrl("gleam", browser.runtime.getManifest().version)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-foreground underline underline-offset-2"
          >
            GLEAM
          </a>
          <br />
          <br />
          Invite only
        </p>
      </div>

      <form className="mt-6 flex w-full flex-col gap-3" onSubmit={onSubmit} noValidate>
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
            unlocked && "border-positive",
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

      <div className="mt-6 flex w-full flex-col items-center gap-3">
        <button
          type="button"
          aria-expanded={showAsk}
          aria-controls="founding-gate-ask"
          onClick={() => setAskOpen((open) => !open)}
          className="flex items-center gap-1 text-caption text-muted hover:text-foreground"
        >
          Don&apos;t have an invite?
          <ChevronIcon open={showAsk} />
        </button>
        {showAsk ? (
          <div id="founding-gate-ask" className="flex w-full flex-col items-center gap-3">
            <Button asChild variant={full ? "primary" : "secondary"}>
              <a href={xIntentUrl(full ? fullInvitePost() : askInvitePost())} target="_blank" rel="noreferrer">
                Ask for an invite on X
              </a>
            </Button>
            <a
              href={X_PROFILE_URL}
              target="_blank"
              rel="noreferrer"
              className="text-caption text-muted underline hover:text-foreground"
            >
              Follow @gleam_wallet for code drops
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

