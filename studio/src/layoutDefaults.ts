import type { Material } from './rules'
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

/** The art window used by the placeholder frames (and the default layout). */
export const DEFAULT_ART_BOX: Rect = { x: 150, y: 300, w: 1200, h: 1150 }

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
  const psa: PsaBox = {
    ...tb({ x: 1060, y: 1820, w: 290, h: 170 }, { size: 72, color: '#1a1a1a', outlineWidth: 0, align: 'center', font: BUILTIN_FONTS[2].css }),
    fill: '#f4efe4', border: '#1a1a1a', borderWidth: 6, radius: 18,
  }
  return {
    material,
    layering: 'art-behind',
    art: { box: { ...DEFAULT_ART_BOX }, fit: 'cover', scale: 1, offsetX: 0, offsetY: 0, background: '#f3efe6' },
    text: {
      name: tb({ x: 150, y: 120, w: 900, h: 140 }, { size: 120 }),
      material: tb({ x: 1060, y: 145, w: 290, h: 90 }, { size: 64, align: 'right', uppercase: true }),
      edition: tb({ x: 150, y: 1500, w: 1200, h: 100 }, { size: 68, align: 'center', bold: false }),
      serial: tb({ x: 150, y: 1850, w: 820, h: 110 }, { size: 96, font: BUILTIN_FONTS[6].css }),
    },
    psa,
    updatedAt: 0,
  }
}

/** Fill in any field missing from a stored layout (forward compatibility). */
export function normalizeLayout(material: Material, stored: Partial<Layout> | undefined): Layout {
  const d = defaultLayout(material)
  if (!stored) return d
  return {
    ...d,
    ...stored,
    material,
    art: { ...d.art, ...stored.art },
    text: {
      name: { ...d.text.name, ...stored.text?.name, style: { ...d.text.name.style, ...stored.text?.name?.style } },
      material: { ...d.text.material, ...stored.text?.material, style: { ...d.text.material.style, ...stored.text?.material?.style } },
      edition: { ...d.text.edition, ...stored.text?.edition, style: { ...d.text.edition.style, ...stored.text?.edition?.style } },
      serial: { ...d.text.serial, ...stored.text?.serial, style: { ...d.text.serial.style, ...stored.text?.serial?.style } },
    },
    psa: { ...d.psa, ...stored.psa, style: { ...d.psa.style, ...stored.psa?.style } },
  }
}
