/** PSA wear: a separate, swappable render step applied to the finished card (frame + art + text).
 *
 *  The look is NOT decided yet (docs/card-studio.md, "Left open"). Two prototypes are planned for the owner to
 *  compare; both stubs are here and neither is wired in yet. While grades are unrevealed (grade === null), nothing is
 *  drawn: every card in a Fire is built with "PSA ?" and no wear. */

import type { DealtCard } from './deal'

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** PSA grade 1..10, or null while unrevealed. */
export type PsaGrade = number | null

/** The hook render.ts calls last. Swap the body to pick an approach. */
export function applyWear(ctx: Ctx2D, card: Pick<DealtCard, 'serial'>, grade: PsaGrade): void {
  if (grade === null) return // unrevealed: pristine card with "PSA ?"
  // Pick one once the owner has compared the prototypes:
  // wearOverlayPerGrade(ctx, grade)
  // wearSeededPerCard(ctx, card, grade)
  void ctx
  void card
}

/** Approach A: a fixed overlay per grade.
 *  TODO: ten hand-made 1500x2100 transparent PNG overlays (grade 1 = missing corner, burns, scribbles, creases ...
 *  grade 10 = a subtle polish/sparkle), stored like frames in IndexedDB and drawn over the whole card with
 *  ctx.drawImage. Every PSA 3 looks identical. Cheapest to make and easiest to art-direct. */
export function wearOverlayPerGrade(ctx: Ctx2D, grade: number): void {
  void ctx
  void grade
}

/** Approach B: per-card damage seeded from the serial.
 *  TODO: the same grade gives the same amount of damage, but placement varies per card: seed a PRNG with the serial
 *  (prng.ts Stream(`wear:${serial}`, ...)), then pick and place damage sprites (corner tears, creases, scuffs, burn
 *  marks, edge wear) from a per-grade budget, with random rotation/position/opacity. Every PSA 3 is a slightly
 *  different PSA 3, and re-rendering a card always reproduces the same damage. */
export function wearSeededPerCard(ctx: Ctx2D, card: Pick<DealtCard, 'serial'>, grade: number): void {
  void ctx
  void card
  void grade
}
