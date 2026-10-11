/** PDA wear is one set of wear layers drawn over every finished card (frames.ts wearUrl, made by
 *  frames-src/wear_overlays.py), so every card type wears the same. A per-card variation seeded from the serial is
 *  planned for the live version only. */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
