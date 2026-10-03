import type { Material } from './rules'
import { FRAME_GEOMETRY } from './frames'
import type { Layout, PsaBox, Rect, TextBox, TextStyle } from './types'

/** Built-in font choices: web-safe stacks only (no Google Fonts, nothing fetched). Uploaded fonts are added on top. */
export const BUILTIN_FONTS: { label: string; css: string }[] = [
  { label: 'Georgia (serif)', css: 'Georgia, "Times New Roman", serif' },
  { label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { label: 'Arial / Helvetica', css: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', css: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { label: 'Impact', css: 'Impact, "Arial Black", "Franklin Gothic Bold", sans-serif' },
  { label: 'Courier New (mono)', css: '"Courier New", Courier, monospace' },
  { label: 'System UI', css: 'system-ui, "Segoe UI", Roboto, sans-serif' },
]

/** Layouts saved before the built-in frames existed were made for placeholder frames; they are replaced by the
 *  defaults below. Bump when the default layout changes in a way old saved layouts must not keep. */
export const LAYOUT_VERSION = 1

/** Text colours per frame: Paper and Wood have light panels (dark ink), Burning has dark panels (light ink). */
const INK: Record<Material, { color: string; outline: string; outlineWidth: number; window: string }> = {
  paper: { color: '#2b2622', outline: '#ffffff', outlineWidth: 0, window: '#f4f0e6' },
  wood: { color: '#3a2412', outline: '#ffffff', outlineWidth: 0, window: '#f1e4cc' },
  burning: { color: '#ffe9c4', outline: '#1a0904', outlineWidth: 5, window: '#24100a' },
  charcoal: { color: '#ececf0', outline: '#0e0e10', outlineWidth: 5, window: '#26262a' },
  diamond: { color: '#0f3442', outline: '#ffffff', outlineWidth: 0, window: '#eef8fb' },
}

function style(over: Partial<TextStyle>): TextStyle {
  return {
    font: BUILTIN_FONTS[0].css, bold: true, italic: false, size: 80, minSize: 24, color: '#ffffff',
    outlineColor: '#000000', outlineWidth: 6, align: 'left', uppercase: false, ...over,
  }
}

function tb(box: Rect, over: Partial<TextStyle>): TextBox {
  return { box, style: style(over), visible: true }
}

export function defaultLayout(material: Material): Layout {
  const ink = INK[material]
  const c = { color: ink.color, outlineColor: ink.outline, outlineWidth: ink.outlineWidth }
  const g = FRAME_GEOMETRY
  const left = g.infoPanel.x + 50, textW = 820
  const psa: PsaBox = {
    ...tb({ x: 1090, y: 1716, w: 270, h: 196 }, { size: 72, color: '#1a1a1a', outlineWidth: 0, align: 'center', font: BUILTIN_FONTS[2].css }),
    fill: '#f4efe4', border: '#1a1a1a', borderWidth: 6, radius: 18,
  }
  return {
    material,
    version: LAYOUT_VERSION,
    layering: 'art-behind',
    art: { box: { ...g.art }, fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, background: ink.window },
    text: {
      name: tb({ x: g.nameBar.x + 50, y: g.nameBar.y + 14, w: g.nameBar.w - 100, h: g.nameBar.h - 28 }, { ...c, size: 104, align: 'center' }),
      material: tb({ x: left, y: 1648, w: textW, h: 110 }, { ...c, size: 88, uppercase: true }),
      edition: tb({ x: left, y: 1772, w: textW, h: 86 }, { ...c, size: 58, bold: false }),
      serial: tb({ x: left, y: 1870, w: textW, h: 110 }, { ...c, size: 84, font: BUILTIN_FONTS[6].css }),
    },
    psa,
    updatedAt: 0,
  }
}

/** Fill in any field missing from a stored layout (forward compatibility). */
export function normalizeLayout(material: Material, stored: Partial<Layout> | undefined): Layout {
  const d = defaultLayout(material)
  if (!stored || stored.version !== LAYOUT_VERSION) return d
  return {
    ...d,
    ...stored,
    material,
    version: LAYOUT_VERSION,
    // the frames are fixed, so the art window and layering are too
    layering: 'art-behind',
    art: { ...d.art, ...stored.art, box: { ...FRAME_GEOMETRY.art } },
    text: {
      name: { ...d.text.name, ...stored.text?.name, style: { ...d.text.name.style, ...stored.text?.name?.style } },
      material: { ...d.text.material, ...stored.text?.material, style: { ...d.text.material.style, ...stored.text?.material?.style } },
      edition: { ...d.text.edition, ...stored.text?.edition, style: { ...d.text.edition.style, ...stored.text?.edition?.style } },
      serial: { ...d.text.serial, ...stored.text?.serial, style: { ...d.text.serial.style, ...stored.text?.serial?.style } },
    },
    psa: { ...d.psa, ...stored.psa, style: { ...d.psa.style, ...stored.psa?.style } },
  }
}
