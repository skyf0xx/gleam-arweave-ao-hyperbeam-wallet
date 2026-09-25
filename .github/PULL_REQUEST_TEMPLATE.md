## Why

## What

## Checklist

- [ ] `pnpm vitest run` passes
- [ ] `pnpm tsc` passes for all four projects (core, messaging, ui, extension)
- [ ] `pnpm eslint --max-warnings=0 .` passes
- [ ] `pnpm wxt:build` succeeds
- [ ] If this touches signing, network, or extension wiring: checked manually
      in Chrome against `.output/chrome-mv3`
- [ ] Corresponding item removed from `todo.md`, if applicable
