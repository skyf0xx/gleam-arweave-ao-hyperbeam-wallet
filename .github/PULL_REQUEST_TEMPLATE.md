## Why

## What

## Attestation id

<!-- Only for a PR from a community scan (SCANS.md): `Attestation id: <64 hex>`. Otherwise leave blank. -->

## Checklist

- [ ] `pnpm vitest run` passes
- [ ] `pnpm tsc` passes for all six projects (core, messaging, ui, extension,
      points-api, scripts/scan)
- [ ] `pnpm eslint --max-warnings=0 .` passes
- [ ] `pnpm wxt:build` succeeds
- [ ] If this touches signing, network, or extension wiring: checked manually
      in Chrome against `.output/chrome-mv3`
- [ ] Corresponding item removed from `todo.md`, if applicable
