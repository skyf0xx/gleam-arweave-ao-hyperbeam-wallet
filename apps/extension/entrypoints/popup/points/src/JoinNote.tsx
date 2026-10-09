import { SITE_URL } from "@/src/site-pages";

export const HOW_IT_WORKS_URL = new URL("points.html", SITE_URL).toString();

/** The disclosure shown wherever joining Gleam Points is offered. */
export function JoinNote() {
  return (
    <p className="text-center text-caption text-faint">
      Joining links this wallet's address to this browser on the Gleam Points server.{" "}
      <a href={HOW_IT_WORKS_URL} target="_blank" rel="noreferrer" className="underline hover:text-muted">
        How points work
      </a>
    </p>
  );
}
