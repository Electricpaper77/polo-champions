# POLO CHAMPIONS Project Rules

- Keep the game playable with keyboard even if gamepad support is unavailable.
- Prefer lightweight procedural meshes and deterministic gameplay over visual complexity.
- Place gameplay logic in `src/game/`; keep UI in React components.
- Keep tuning values centralized and avoid new dependencies unless they materially support the vertical slice.
- Validate each feature with a production build and record results in `.logs/BUILD_LOG.md`.
