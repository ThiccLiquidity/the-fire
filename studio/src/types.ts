import type { DealResult } from './deal'
import type { Category, Material } from './rules'

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
  /** Set once; printed on the card and a trait in the metadata. Required before the character can go into a Series. */
  category?: Category
  images: Partial<Record<Material, Partial<Record<Variant, ImageSlot>>>>
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
  material: Material
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
}

export type OutputFormat = 'webp' | 'png'

export interface BuildState {
  format: OutputFormat
  count: number
  builtAt: number
}

export interface FireRecord {
  number: number
  characterIds: string[]
  packs: number
  /** Diamonds this Series makes (at least 1, the default; never more than one per pack). Missing on Series saved
   *  before Oct 4, which read as 1. */
  diamonds?: number
  seed: string
  /** Set once the deal is locked: the global serial counter has moved on. */
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
}

export function fireStatus(f: FireRecord): FireStatus {
  if (f.upload?.metadataCid) return 'uploaded'
  if (f.approvedAt) return 'approved'
  if (f.deal) return 'dealt'
  return 'draft'
}
