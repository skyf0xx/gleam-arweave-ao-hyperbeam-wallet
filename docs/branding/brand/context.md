# Brand Context

## Brand
- **Name**: Gleam
- **Category**: Crypto / web3 wallet (browser extension) — AO and Arweave only
- **Description**: The wallet that makes acting through AO/HyperBEAM understandable and safe.
- **Stage**: Pre-launch
- **Website**: N/A
- **Open source**: Confirmed decision — code is public and auditable, positioned as a trust mechanism ("trust built from inspection," not asserted claims).

## Audience
- **Primary Audience**: AO/Arweave users choosing a wallet — including current Wander users, for whom migration is a first-class onboarding path rather than a generic "import a wallet" flow.
- **Key Problem**: Wallets today converge on features (multichain, swaps, simulation) but not on the interaction model. The default model is: give an application your keys, then figure out what a signature meant after the fact. Users also hit concrete Wander failure modes — keyfile-vs-seed confusion, address mismatches across devices — and have no way to verify a recovery backup actually works before they need it.
- **Their Language**: "connect vs. approve," "blind signing," "seed phrase," "keyfile," "revoke access," "gas/fees," "watch-only," "hardware wallet." Avoid trust-badge language ("bank-grade," "military-grade," "audited by X") — trust here is meant to be felt through mechanics, not asserted.

## Positioning
- **Differentiation**: Capability-based permissions ("Grants," not "Connect") — scoped, budgeted, time-boxed access instead of persistent coarse approval. Every signing request shows consequence (what leaves, what's received, counterparty, plain-language permission description) before it happens, not raw payload by default. Disconnect means revoked, absolutely — no lingering token/spend approvals after a user thinks they've disconnected. Passkey-first onboarding with no seed/keyfile screen in the critical path, but self-custody export always available, explicit, reversible. Recovery is testable — a "verify my recovery" flow proves a backup works without moving funds.
- **Competitors**: Wander is the dominant AO/Arweave wallet extension today, having accumulated features (agents, a DEX, storage mining, a token with fee tiers) that make everyday use — checking a balance, sending, approving — feel more cluttered than it needs to be. PermawebOS is a newer entrant carrying forward the same "wallet as ecosystem platform" instinct (browser-node/routing-policy ambitions, in-wallet app-creation layer), still in beta and, firsthand, harder to install and use day-to-day than it should be. Gleam's opportunity isn't tied to either competitor's specific missteps — it's that nobody in the category is staying simple on purpose as it matures.
- **Market Position**: Niche (AO/Arweave-only, deliberately not multichain) — competing on trust-through-mechanics and interaction-model quality rather than chain breadth or feature count.

## Brand Personality
- **Personality Words**: Simple, clean, technical, functional, efficient, light (not heavy), easy, transparent, small footprint / easy to audit, almost playful
- **Tone**: Casual-leaning but precise — not corporate, not solemn. Trust is implicit in the design and mechanics, never asserted via badge, certification-speak, or reassurance copy. "Gleam" evokes a beam of clean, clear light — the name itself should do quiet, almost-playful work rather than sounding like a security product.
- **Voice Admires**: None named — the anti-pattern is explicit: don't sound like a "trust us" security brand (no badges, no "bank-grade/military-grade" language, no uniform "are you sure?" modals that train people to click through).

## Values & Mission
- **Core Values**: Safe by default (not safe if configured); least privilege, always revocable; friction proportional to risk; progressive disclosure (calm by default, depth one click away); no dark patterns, no engagement mechanics
- **Mission**: Replace "give an app your keys and find out what happened after" with "an app holds specific, visible, revocable capabilities, and every action is previewed before it happens" — for AO and Arweave, and nothing else.

## Goals
- **Primary Goal**: Ship v1 scope (passkey-first onboarding, capability-based grants, transaction/message simulation, guaranteed crash-safe approval surface, hardware wallet support) and become the wallet AO/Arweave users choose because it's simply the easiest one to use.
- **Key Metrics**: Active installs; migrated wallets from Wander (one acquisition channel among others, not the core positioning).
