# Scan CLI

This is the `pnpm scan` command that AI agents run during a community
security scan. It is the client side of a challenge-response protocol:
`start` fetches the challenge, and `finish` validates the answers
against the server before the user signs and submits them.
The full scan process is described in `SCANS.md`, and the agent's own
instructions are in `security/scan/SKILL.md`.

## Structure

- **`cli.ts`**: reads the command the agent typed and prints the result.
- **`start.ts`**: fetches a challenge from the points server and prepares
  the scan.
- **`finish.ts`**: checks the agent's report and answers with the points
  server, then prints the link where the user signs the attestation in
  their wallet.
- **`api.ts`**: the calls to the points server.
- **`harness.ts`**, **`shared.ts`**: shared setup and types.

## Location

```text
        agent
          │ pnpm scan start
          ▼
      points-api      sends a challenge
          │
          ▼
        agent         scans and answers
          │ pnpm scan finish
          ▼
     attest.html      on gleamwallet.app
          │
          ▼
        wallet        user signs
          │
          ▼
      points-api      checks and rewards
```
