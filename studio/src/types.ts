import type { DealResult } from './deal'
import type { Recipe } from './recipe'
import type { SaleSettings } from './sale'

export type Variant = 'normal' | 'holo'
export const VARIANTS: Variant[] = ['normal', 'holo']

/** One uploaded character image. The original is always kept; when keyMagenta is on, the keyed PNG is used. */
export interface ImageSlot {
  originalKey: string
  processedKey?: string
  keyMagenta: boolean
  /** RGB distance from #FF00FF below which a pixel is fully transparent (0-200). */
  tolerance: number
  /** Width of the soft edge above the tolerance, in the same RGB distance units (1-200). */
  feather: number
  /** 0-1: how strongly magenta fringe is pulled out of edge pixels. */
  despill: number
  width: number
  height: number
  fileName: string
  updatedAt: number
}

export interface Character {
  id: string
  name: string
  shortId: string
  /** Free text (categories.ts); printed on the card, a trait in the metadata and stored
   *  on-chain with the Series. Required before the character can go into a Series. */
  category?: string
  /** Art per frame set (frames.ts: 'paper', 'wood', 'burning', 'charcoal', 'diamond' and any other set), normal and
   *  holo. A card type uses the art of the frame set it uses. */
  images: Partial<Record<string, Partial<Record<Variant, ImageSlot>>>>
  createdAt: number
  updatedAt: number
  /** Created by "Load sample assets". */
  placeholder?: boolean
}

export interface FrameAsset {
  key: string
  width: number
  height: number
  fileName: string
  updatedAt: number
  placeholder?: boolean
}
/** Legacy: frames used to be uploaded. They are built in now (src/frames.ts); old records are ignored. */
export type FrameSet = Partial<Record<Variant, FrameAsset>>

export interface Rect { x: number; y: number; w: number; h: number }

export type Align = 'left' | 'center' | 'right'
export interface TextStyle {
  /** CSS font-family list, e.g. `Georgia, serif` or `"CS-font-abc"` for an uploaded font. */
  font: string
  bold: boolean
  italic: boolean
  /** Maximum size in px; text auto-shrinks to fit the box width (and height) down to minSize. */
  size: number
  minSize: number
  color: string
  outlineColor: string
  outlineWidth: number
  align: Align
  uppercase: boolean
}

/** What's printed on the card image. Serial, edition and Series # are per card, so they live in the metadata (and the
 *  live version), not on the shared image. */
export type TextField = 'name' | 'material' | 'category' | 'forged'
export const TEXT_FIELDS: TextField[] = ['name', 'material', 'category', 'forged']
export const TEXT_FIELD_LABEL: Record<TextField, string> = { name: 'Name', material: 'Material', category: 'Category', forged: 'Forged (Series #)' }

export interface TextBox { box: Rect; style: TextStyle; visible: boolean }
export interface PsaBox extends TextBox { fill: string; border: string; borderWidth: number; radius: number }

export type Layering = 'art-behind' | 'art-above'
export interface ArtWindow {
  box: Rect
  fit: 'cover' | 'contain'
  /** Extra zoom on top of the fit (1 = exact fit). */
  scale: number
  /** Nudge in card px. */
  offsetX: number
  offsetY: number
  /** Fill behind the art inside the window ('' = none, leave transparent). Keyed art on a frame with a transparent
   *  window would otherwise leave a hole in the finished card. */
  background: string
}

export interface Layout {
  /** The frame set this layout is for (layouts are per frame set: every type using the set shares it). */
  material: string
  /** LAYOUT_VERSION it was saved under (see layoutDefaults.ts). */
  version: number
  layering: Layering
  art: ArtWindow
  text: Record<TextField, TextBox>
  psa: PsaBox
  updatedAt: number
}

export interface FontAsset { id: string; family: string; fileName: string; key: string; updatedAt: number }

export type FireStatus = 'draft' | 'dealt' | 'approved' | 'uploaded'

export interface UploadState {
  imagesCid?: string
  metadataCid?: string
  imagesAt?: number
  metadataAt?: number
  format?: OutputFormat
  mock?: boolean
  /** The images folder name the images CID belongs to (it carries a fingerprint of the files). A rebuild changes it,
   *  so the saved CIDs are not reused for different images. Missing on uploads saved by older versions. */
  imagesDir?: string
  /** The build (FireRecord.build.builtAt) the uploaded images came from: recipe.json only carries imagesBase while the
   *  upload is of the current build. */
  buildAt?: number
  /** An unfinished resumable (TUS) upload of a CAR, so a reload can continue it: which folder, its root CID and size,
   *  and the upload URL Pinata gave. */
  pending?: { dir: string; root: string; size: number; url: string }
  /** The images CAR's size in bytes (for saving it offline). */
  imagesCarSize?: number
  /** The second pin (filebase.ts): the CID Filebase reports for the same CAR, the object it's stored as, and when. */
  filebaseCid?: string
  filebaseObject?: string
  filebaseAt?: number
  /** An unfinished multipart upload to Filebase (resumes from its last part). */
  filebasePending?: { object: string; root: string; size: number; id: string }
  /** When both pins were read back and held the images CID. */
  verifiedAt?: number
  /** When the images CAR was saved from the studio, and when the owner confirmed it is stored offline. */
  carSavedAt?: number
  carStoredAt?: number
}

/** Series builds are always WEBP (the contract names every image .webp). 'png' only appears on builds saved by older
 *  versions, which must be rebuilt. */
export type OutputFormat = 'webp' | 'png'

/** Bumped when what a build contains changes; builds saved under another version must be redone. 1 = the full
 *  Standard grid (209 images per character); 2 = the grid of the Series' recipe (looks.ts seriesGrid), keyed by type
 *  slug. */
export const BUILD_GRID_VERSION = 2

export interface BuildState {
  format: OutputFormat
  count: number
  builtAt: number
  /** BUILD_GRID_VERSION it was built under; missing on older (sample-deal-only) builds. */
  grid?: number
  /** Total size of the built images, bytes. */
  bytes?: number
  /** How long the build took, ms. */
  ms?: number
  /** recipeGridKey + characters it was built for: a recipe or character change makes the build stale. */
  gridKey?: string
}

export interface FireRecord {
  number: number
  characterIds: string[]
  packs: number
  /** The Series' recipe: card types, slots, PDA odds (recipe.ts). Series saved before recipes existed get the
   *  Standard recipe with their Diamond setting when loaded (migrate.ts). */
  recipe: Recipe
  /** The drop settings (FireSale.configureDrop), exported in recipe.json's "sale" block. Missing = the Standard
   *  sale (sale.ts standardSale). */
  sale?: SaleSettings
  /** Legacy: Diamonds of a Standard Series from before recipes (now the Diamond type's count in the recipe). */
  diamonds?: number
  seed: string
  /** Set once the deal is locked (the recipe is locked with it): the global serial counter has moved on. */
  deal?: DealResult
  approvedAt?: number
  build?: BuildState
  upload?: UploadState
  createdAt: number
  updatedAt: number
}

export interface GlobalState {
  /** Next global serial to hand out (never resets). */
  nextSerial: number
  nextFireNumber: number
  /** Set once older fixed category ids (e.g. 'sports') have been turned into free-text labels ('Sports'). */
  categoriesFree?: boolean
}

export function fireStatus(f: FireRecord): FireStatus {
  if (f.upload?.metadataCid) return 'uploaded'
  if (f.approvedAt) return 'approved'
  if (f.deal) return 'dealt'
  return 'draft'
}
