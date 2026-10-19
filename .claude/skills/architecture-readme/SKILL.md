---
name: architecture-readme
description: Use when asked to document a directory or package, or when a code change alters component responsibilities, dependencies, or architectural relationships described in an existing README. Creates or updates a concise README.md that explains a directory's role, its important components, and how they work together, for a new contributor or auditor.
---

# Architecture README

README files are living documentation, not one-off deliverables. Keep them
accurate as the codebase changes.

## 1. Explore before documenting

Inspect the target directory and trace the code where necessary. Do not
infer behavior from filenames alone — follow imports, exports, call sites,
and interfaces.

Understand:

- What the directory is responsible for.
- Which files and subdirectories matter most.
- How its components relate to one another.
- What depends on it, and what it depends on.
- Where important operations begin, flow through the system, and end.
- Where state, configuration, persistence, or security boundaries live.

## 2. Document the architecture

Only document directories that contain a nested `src/` (packages and
apps). Don't create READMEs for arbitrary subdirectories inside `src/`.

Create or update a single `README.md` at the same level as `src/` (the
package or app root), not inside it.

- **Directory overview** — a brief explanation of what the directory does
  and how it fits into the wider system.
- **Component index** — the important files and directories, grouped by
  responsibility, each linked to its explanation via a Markdown anchor.
  Explain a directory as a whole when that's sufficient; list individual
  files only when their specific responsibilities matter.
- **Component explanations** — for each important component, cover what
  responsibility it has, why it exists, and when/how it's used. Prefer a
  short titled list (bolded name, then a one- or two-sentence
  explanation) over a dense paragraph that chains several components
  together with commas and dashes. Give each component its own line so
  a reader can scan instead of parse.
- **Relationships and data flow** — who calls or depends on whom, how
  data/control flows, where responsibilities begin and end, and who owns
  state or persistence. Prioritize relationships that build a reader's
  mental model; isolated component descriptions aren't enough on their
  own. Use a short sequence or Mermaid diagram only when it clarifies a
  non-obvious relationship.

## 3. Writing standards

Write for a technically capable reader unfamiliar with this part of the
codebase. Target Flesch–Kincaid grade 6–8 where practical: familiar
words, short sentences, concrete explanations. One idea per sentence —
split any sentence that chains two or more claims with commas,
semicolons, parentheticals, or "and"/"but" into separate sentences or
list items. This applies as much to a relationship explanation (layering,
dependency direction, an exception, an analogy) as it does to a list of
files — a paragraph that packs "what depends on what, with one
exception, summarized by an analogy" into three long sentences is still
too dense, even with zero files named. If a paragraph's sentences each
need re-reading to parse, break it into shorter sentences or a short
list before moving on. Keep necessary technical terms, explained briefly
where context doesn't already make them clear. Avoid restating what the
code already makes obvious, generic introductions, filler, and
boilerplate. Document the architecture, not every implementation
detail.

Default to titled lists over dense paragraphs. When explaining a set of
files, components, or steps, use a bulleted or numbered list with a
bolded title per item rather than a paragraph that packs them all
together. Reserve paragraphs for the directory overview and for
relationships/data flow that genuinely need connected prose; even there,
keep sentences short and break up any sentence doing too much work.

## 4. Keep documentation up to date

Whenever code changes affect a documented directory:

1. Check whether its README remains accurate.
2. Update the index and explanations for added, removed, renamed, or
   materially changed components.
3. Update relationship descriptions when dependencies or data/control
   flow change.
4. Remove references to deleted or obsolete components.
5. Verify internal links and file paths.

Skip the update for trivial changes that don't affect what a reader
needs to understand about the architecture. When a change spans multiple
directories, update each affected README — don't assume the nearest one
covers everything.

## 5. Constraints

- Touch only the README files relevant to the requested directory or
  affected architecture, unless told otherwise.
- Never modify application code as part of a documentation-only task.
- Never invent behavior, dependencies, or architectural intent — if a
  claim can't be verified, investigate further or omit it.
- Keep documentation proportional to the directory's complexity.

## 6. Completion criteria

Before finishing, verify the README lets a new contributor or auditor
quickly answer:

1. What lives here, and why?
2. How do the important parts work together?
3. Where should I look to understand or investigate a particular
   responsibility?

And that: explanations match the actual code, internal links and paths
resolve, the README is concise and readable, and no unrelated files were
modified.
