# Implementation Plan

1. Update `docs-site/docs.json`:
   - switch Mintlify theme away from `mint`
   - update palette/config knobs for the refreshed style
   - add `start/team-hub` and `zh/start/team-hub` to navigation

2. Update `docs-site/styles.css`:
   - preserve language-switcher and diagram fixes
   - retune terminal demo colors away from old purple accents

3. Add Hub documentation:
   - create `docs-site/start/team-hub.mdx`
   - create `docs-site/zh/start/team-hub.mdx`
   - keep all examples user-facing and free of API/internal details

4. Update homepages:
   - add Hub card or replace a lower-value card in `docs-site/index.mdx`
   - mirror the change in `docs-site/zh/index.mdx`

5. Validate:
   - run `pnpm lint` from `docs-site`
   - run targeted grep for internal Hub leakage terms in the new pages
   - run git diff/status checks and avoid unrelated README changes
