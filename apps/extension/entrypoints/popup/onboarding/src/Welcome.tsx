import { BeamMark } from "@gleam/ui/src/components/onboarding/index.ts";
import { Button } from "@gleam/ui/src/primitives/button.tsx";

/**
 * 1.1 Welcome (onboarding.html) — the only screen allowed the tagline as
 * hero copy (brand/guidelines.md's onboarding allowance), one primary +
 * one secondary action, nothing else.
 */
export interface WelcomeProps {
  onCreate: () => void;
  onImport: () => void;
}

export function Welcome({ onCreate, onImport }: WelcomeProps) {
  return (
    <div className="flex min-h-full flex-col items-center px-8 pb-8 pt-7">
      <div className="mt-14 mb-3">
        <BeamMark tagline="Crypto, without the clutter." />
      </div>
      <div className="mt-auto flex w-full flex-col gap-2.5">
        <Button type="button" onClick={onCreate}>
          Create a wallet
        </Button>
        <Button type="button" variant="secondary" onClick={onImport}>
          Import a wallet
        </Button>
      </div>
    </div>
  );
}
