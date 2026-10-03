/** PSA wear is designed into the frames (one worn frame per wear level, see WEAR_LEVELS in rules.ts and
 *  BUILTIN_WEAR_FRAMES in frames.ts), so there is no wear render step on the still image. A per-card variation
 *  seeded from the serial is planned for the live version only. */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
