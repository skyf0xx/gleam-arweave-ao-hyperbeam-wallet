---
name: architecture-readme
description: Use when asked to document a directory or package, or when a code change alters a package's purpose, its main parts, or how it connects to the rest of the repo. Creates or updates a short README.md that lets an engineer exploring the repo understand what a folder is for, what is in it, and where it sits in the system.
---

# Architecture README

A README helps an engineer who is exploring the repo build a mental
model of one folder: what it is for, what is in it, and where it sits.
It is a map, not a reference manual, and it does not need to cover
every detail. A loose but helpful description beats an exhaustive one.

## 1. Which folders get one

- Each package and app: `packages/*`, `apps/*`.
- Each top-level tool folder with its own purpose, such as
  `scripts/scan`.
- Not subfolders inside a package's `src/`, and not generated folders
  (for example Capacitor's `CapApp-SPM`).

The root `README.md` has a **Repository layout** section with a small
diagram of how the apps and packages connect, and a one-line linked entry
for each folder that has a README. Add or update an entry whenever a
folder's README is added, removed or changes its one-line summary.

If a folder is deployed as-is (a static site), keep its README out of
the deploy, for example with a `.vercelignore` that lists `README.md`.

## 2. Explore before writing

Read the folder's entry points, exports and main callers before writing
anything. Do not describe a file from its name alone. Check every claim
against the code, such as which apps use a package or what a script
does. Earlier READMEs in this repo had drifted, and checking was what
found the errors.

## 3. Layout

Every README uses the same layout:

~~~markdown
# <package name or folder title>

<Paragraph 1: what this folder is and what it does for the wallet,
starting with "This package is…" or "This is…".>

<Paragraph 2: the one idea that explains how it is built, usually the
pattern it follows and the main rule it keeps.>

## Structure

- **`file-or-folder`**: what it does, in one or two lines.

## Where it sits

```text
caller → this folder → what it calls
```
~~~

- **Intro**: two short paragraphs. Don't start with a sentence fragment
  such as "Every screen of the wallet, and…".
- **Structure**: one bulleted line per important file or folder, with the
  name in bold. Group related items under `###` subheadings when there
  are more than about ten (see `packages/core`). Mention a few examples
  rather than listing every file.
- **Where it sits**: a small `text` diagram showing what calls this
  folder and what it calls. Add a short numbered list only when a
  request passes through several steps (see `apps/extension`).

## 4. What to leave out

Leave out anything that doesn't help someone understand the structure:

- How rules are enforced (ESLint rules, `exports` maps, import fences).
  State the rule itself if it explains the design, such as "core uses no
  browser API", but not how it is enforced.
- Exact numbers and settings: rate limits, cache times, body sizes,
  reward fractions, CORS origins, manifest fields, lock types.
- Test setup and where tests live (CLAUDE.md covers that).
- Detail that belongs in code comments or in `docs/THREAT_MODEL.md`.

## 5. Analogies

An analogy is welcome when it maps the folder onto something the reader
already knows. The reader is a TypeScript engineer, so use engineering
patterns, not everyday objects. Everyday analogies (an engine, a bank
teller, a receptionist, a phrasebook) come across as condescending.

Good examples from this repo:

- `core`: a domain layer using ports and adapters.
- `runtime`: a small server whose dispatcher acts as authorization
  middleware in front of the handlers.
- `app`: screens that receive an `AppPlatform` through React context,
  like an API client passed down by a provider.
- `ui`: a shadcn/ui-style library of presentational components.
- `messaging`: a typed contract between contexts, like a shared tRPC
  router type or an OpenAPI schema.
- `provider`: a thin RPC client stub over a transport.
- `extension`, `mobile`: composition roots that wire adapters into the
  packages.

## 6. Writing style

- **Reading level**: aim for about Flesch–Kincaid grade 7. Use plain
  words, but link related ideas with "so", "which" and "because". A
  string of very short sentences scores around grade 5 and reads as
  choppy. Measure if unsure, and don't pad or chop sentences only to hit
  the number.
- **Current state only**: no history or temporary wording such as
  "today", "still", "for now", "originally" or "(new)". Follow the
  `no-history-in-output` skill.
- **Direct statements**: say what something is or does. Avoid double
  negatives and "holds no X and no Y" constructions. Write "Wallet logic
  lives in the background, and the screens live here."
- **No filler**: no generic introductions, no "This README describes…",
  and no restating what a file name already makes obvious.

## 7. Keep it current

When a change affects a documented folder, check its README: update the
Structure list for added, removed or renamed parts, update the diagram
if the connections changed, and update the root README's entry if the
folder's purpose changed. Skip changes that don't affect what a reader
needs to understand the structure.

## 8. Done when

- Someone new can answer three questions from the README: what lives
  here and why, what the main parts are, and where it sits.
- Every claim matches the code, and every path exists.
- The README follows the layout, scores about grade 7, and has no
  history wording.
- Only README files (and a deploy ignore, where needed) were changed.
