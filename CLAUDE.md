# Working rules (from the owner)

- **Pushing:** when a piece of work is done, ask "Push?" and push to `wip/pending-approval` on a yes. Mirror every
  push to `claude/practical-gates-va0gq1` (`git push origin wip/pending-approval:refs/heads/claude/practical-gates-va0gq1`).
- **Main and going live:** nothing merges to main, deploys to production, or leaves demo mode without the owner's
  explicit OK.
- **Secrets:** never ask for or accept API keys or private keys in chat. Keys are typed into PowerShell
  (`Read-Host -AsSecureString`), the Foundry keystore, or the studio's per-session key field. Never commit secrets.
- **Visuals:** show anything visual before it's committed.
- **Style:** short, direct answers. Ask one question at a time. The owner works in PowerShell
  (clone at `C:\Users\DubT1\the-fire`).

# Card Studio (`studio/`)

- Decisions live in `docs/card-studio.md`.
- **The frames are locked.** The 10 approved frames (5 materials x normal/holo) are built in under
  `studio/src/assets/frames`, made from `studio/frames-src/originals` by `studio/frames-src/clean_frames.py`.
  Never edit or regenerate them by hand. New frames (e.g. PSA wear levels) go through the same script.
- The only thing the owner drops in per card is the character image.
