# Working on this repository

## Start here

Read README.md for the user-facing overview and DEVELOPMENT.md for setup, code layout and checks. PLAYER_GUIDE.md describes detailed controls. Consult AUDIO.md, STABILIZATION.md or MAX_RENDERER.md when changing those areas.

## Keep documentation useful

- Keep README.md short, current and written for someone trying the player. Do not add implementation diaries or change history there.
- Put detailed behavior in PLAYER_GUIDE.md, engineering notes in DEVELOPMENT.md, milestones in HISTORY.md and test evidence in VERIFICATION.md.
- Distinguish automated/mocked checks from actual browser, codec, GPU and physical-headset validation. Do not imply device compatibility from unit tests.

## Protect local media and existing work

- Never commit camera originals, derived previews, extracted telemetry or private per-recording measurements. Use synthetic fixtures for tests.
- Preserve the local-only playback design. Do not add uploads, runtime CDN requests or telemetry without an explicit project decision.
- Inspect git status before editing. Preserve unrelated work and stage only the files intended for the task.

## Validate changes

Run npm test and git diff --check. Run node --check on changed JavaScript modules. Check documentation links and UI labels against the source. Record what passed and any checks that could not run; do not claim unperformed device testing.

The main-branch GitHub Actions workflow tests and deploys the site. Check the task's publication scope before pushing there; use a separate branch for review-only work. Never force-push or include unrelated changes to complete a documentation task.
