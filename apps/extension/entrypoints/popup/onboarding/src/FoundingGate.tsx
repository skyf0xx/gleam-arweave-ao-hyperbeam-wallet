import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { InviteRedeemResult, InviteUnlock, RuntimePort } from "@gleam/core";
import { BeamMark } from "@gleam/ui/src/components/onboarding/index.ts";
import { Beam } from "@gleam/ui/src/primitives/beam.tsx";
import { Button } from "@gleam/ui/src/primitives/button.tsx";
import { TextField } from "@gleam/ui/src/primitives/text-field.tsx";
import { browser } from "wxt/browser";
import { sitePageUrl } from "@/src/site-pages";

const X_PROFILE_URL = "https://x.com/gleam_wallet";
const ASK_POST = "Looking for a @gleam_wallet invite. Anyone have one to spare? It's the new wallet for AO.";
const FULL_POST = "Tried a @gleam_wallet invite and it was already full. Anyone have a spare?";

function intentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

const MESSAGES: Record<Exclude<InviteRedeemResult, "ok">, string> = {
  full: "That code is full. Its seats have all been taken.",
  unknown: "We couldn't find that code. Check it and try again.",
  offline: "Gleam can't reach the invite server. Try again in a moment.",
};

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

  const count = useQuery({
    queryKey: ["points", "foundingCount"],
    queryFn: () => runtime.send<undefined, number | null>({ type: "getFoundingCount", payload: undefined }),
    staleTime: 60_000,
    retry: false,
  });

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

  if (unlocked) {
    return (
      <div role="status" aria-live="polite" className="flex min-h-full flex-col items-center justify-center gap-4 px-8">
        <BeamMark animated />
        <h1 className="text-h3 font-semibold tracking-tight text-foreground">You&apos;re in.</h1>
      </div>
    );
  }

  const checking = redeem.isPending;
  const full = verdict === "full";
  const foundingMembers = count.data;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (code.length > 0 && !checking) submit(code);
  };

  return (
    <div className="flex min-h-full flex-col items-center px-8 pb-6 pt-7">
      <div className="mt-6">
        <BeamMark animated />
      </div>

      <div className="mt-7 flex flex-col items-center gap-2 text-center">
        <h1 className="text-h2 font-semibold tracking-tight text-foreground">You&apos;re early.</h1>
        <p className="text-body text-muted">
          Gleam is invite-only while the founding group forms. Founding members get a number that never changes and
          earn Gleam Points from day one.
        </p>
        {typeof foundingMembers === "number" ? (
          <p className="text-caption text-faint">{foundingMembers.toLocaleString("en-US")} founding members so far.</p>
        ) : null}
      </div>

      <form className="mt-6 flex w-full flex-col gap-3" onSubmit={onSubmit}>
        <TextField
          aria-label="Invite code"
          placeholder="INVITE CODE"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\s/g, "").toUpperCase());
            setVerdict(null);
          }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={16}
          className="text-center font-mono uppercase tracking-[0.12em]"
          errorMessage={verdict ? MESSAGES[verdict] : undefined}
        />
        <Button type="submit" variant={full ? "secondary" : "primary"} disabled={checking || code.length === 0}>
          {checking ? "Checking…" : "Unlock Gleam"}
        </Button>
        <span role="status" aria-live="polite" className="sr-only">
          {checking ? "Checking your code" : ""}
        </span>
      </form>

      <div className="mt-6 flex w-full flex-col items-center gap-3">
        <Beam />
        <p className="mt-1 text-caption font-semibold text-muted">No code yet?</p>
        <Button asChild variant={full ? "primary" : "secondary"}>
          <a href={intentUrl(full ? FULL_POST : ASK_POST)} target="_blank" rel="noreferrer">
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

      <a
        href={sitePageUrl("future", browser.runtime.getManifest().version)}
        target="_blank"
        rel="noreferrer"
        className="mt-auto pt-6 text-caption text-faint underline hover:text-muted"
      >
        What are Gleam Points?
      </a>
    </div>
  );
}
