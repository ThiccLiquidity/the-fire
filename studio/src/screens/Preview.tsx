import { useEffect, useRef, useState } from 'react'
import { BatchRenderer } from '../builder'
import { Field, Notice, ProgressBar } from '../components'
import { hasCategory } from '../categories'
import { FRAME_SETS, frameSetLabel } from '../frames'
import type { CardFace } from '../render'
import { HOLO_LABEL, HOLO_TYPES, WEAR_LABEL, holoTypeOf, wearLookOf, type HoloType } from '../rules'
import { completeness, imageSlots, useStudio } from '../store'

interface Cell { material: string; holo: HoloType; url?: string }

const key = (m: string, h: HoloType) => `${m}:${h}`

/** Every look a character can have, rendered exactly as the build makes it: each frame set x 4 holo looks, at any PDA
 *  grade (the type name printed is the frame set's; a recipe type prints its own name). Click a card to see it full
 *  size. */
export function Preview() {
  const s = useStudio()
  const [charId, setCharId] = useState('')
  const [grade, setGrade] = useState<number | null>(null)
  const [cased, setCased] = useState(false)
  const [cells, setCells] = useState<Record<string, Cell>>({})
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [big, setBig] = useState<Cell | null>(null)
  const char = s.characters.find((c) => c.id === charId) ?? s.characters[0]
  const urls = useRef<string[]>([])
  const gen = useRef(0)

  useEffect(() => () => { for (const u of urls.current) URL.revokeObjectURL(u) }, [])

  useEffect(() => {
    if (!char) return
    const my = ++gen.current
    // the Series this character is in (latest), or the next Series if it isn't in one yet
    const fire = [...s.fires].reverse().find((f) => f.characterIds.includes(char.id))?.number ?? s.global.nextFireNumber
    const list: CardFace[] = []
    for (const frameSet of FRAME_SETS) {
      for (const holo of HOLO_TYPES) {
        list.push({
          frameSet, typeName: frameSetLabel(frameSet), characterId: char.id, grade, cased: cased && grade == null, fire,
          holoFrame: holo === 'frame' || holo === 'full', holoPicture: holo === 'picture' || holo === 'full',
        })
      }
    }
    const holoOf = (c: CardFace) => holoTypeOf(c.holoFrame, c.holoPicture)
    setError(null)
    setCells(Object.fromEntries(list.map((c) => [key(c.frameSet, holoOf(c)), { material: c.frameSet, holo: holoOf(c) }])))
    void (async () => {
      const r = await BatchRenderer.create([char.id], grade != null)
      try {
        await r.renderAll(list, 'webp', {
          batchSize: 2,
          onProgress: (p) => { if (gen.current === my) setProgress(p) },
          onBatch: (cards, blobs) => {
            if (gen.current !== my) return
            const add: Record<string, Cell> = {}
            cards.forEach((c, i) => {
              const url = URL.createObjectURL(blobs[i])
              urls.current.push(url)
              add[key(c.frameSet, holoOf(c))] = { material: c.frameSet, holo: holoOf(c), url }
            })
            setCells((prev) => ({ ...prev, ...add }))
          },
        })
      } catch (e) {
        if (gen.current === my) setError(e instanceof Error ? e.message : String(e))
      } finally {
        r.dispose()
        if (gen.current === my) setProgress(null)
      }
    })()
  }, [char?.id, char?.updatedAt, grade, cased, s.layouts, s.fonts, s.fires, s.global.nextFireNumber])

  if (!char) return <section className="panel grow"><p className="muted">Add a character in the Library first.</p></section>
  const n = completeness(char)
  const total = imageSlots()

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Preview</h2>
        <Field label="Character">
          <select value={char.id} onChange={(e) => setCharId(e.target.value)} data-testid="preview-char">
            {s.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="PDA">
          <select
            value={grade ?? (cased ? 'c' : '')}
            onChange={(e) => {
              const v = e.target.value
              setCased(v === 'c')
              setGrade(v && v !== 'c' ? Number(v) : null)
            }}
            data-testid="preview-psa"
          >
            <option value="">Ungraded</option>
            <option value="c">Ungraded, in a case</option>
            {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((g) => <option key={g} value={g}>PDA {g} (slabbed)</option>)}
          </select>
        </Field>
        <span className="muted small">Exactly what the NFTs will look like. Click a card to see it full size.</span>
      </div>
      {n < total && <Notice kind="warn">{char.name} has {n}/{total} images; missing ones show without art.</Notice>}
      {!hasCategory(char) && <Notice kind="warn">{char.name} has no usable category yet (Library).</Notice>}
      {progress && <ProgressBar value={progress.done / Math.max(1, progress.total)} label={`Rendering ${progress.done} / ${progress.total}`} />}
      {error && <Notice kind="error">{error}</Notice>}
      <div className="preview-grid" data-testid="preview-grid">
        <div />
        {HOLO_TYPES.map((h) => <div key={h} className="preview-head">{h === 'none' ? 'No holo' : `${HOLO_LABEL[h]} holo`}</div>)}
        {FRAME_SETS.map((m) => (
          <PreviewRow key={m} m={m} cells={cells} onOpen={setBig} />
        ))}
      </div>
      {big?.url && (
        <div className="modal" onClick={() => setBig(null)} data-testid="preview-modal">
          <div className="modal-body" onClick={(e) => e.stopPropagation()}>
            <img src={big.url} alt="" />
            <div>
              <h3>{char.name} · {frameSetLabel(big.material)} frames</h3>
              <p className="muted">Holo: {big.holo === 'none' ? 'none' : HOLO_LABEL[big.holo]}<br />PDA: {grade == null ? (cased ? 'ungraded, in a case' : 'ungraded') : `${grade}, slabbed (${WEAR_LABEL[wearLookOf(grade)]} frame)`}</p>
              <p className="muted small">Every card of a type using these frames, of {char.name}, with this holo{grade == null ? '' : ' and grade'} shares this image. Serial, edition and Series # are in each NFT's data.</p>
              <button onClick={() => setBig(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function PreviewRow({ m, cells, onOpen }: { m: string; cells: Record<string, Cell>; onOpen: (c: Cell) => void }) {
  return (
    <>
      <div className="preview-label">{frameSetLabel(m)}</div>
      {HOLO_TYPES.map((h) => {
        const c = cells[key(m, h)]
        return (
          <button key={h} className="preview-cell" onClick={() => c && onOpen(c)} disabled={!c?.url} data-testid={`preview-${m}-${h}`}>
            {c?.url ? <img src={c.url} alt={`${m} ${h}`} /> : <span className="muted small">...</span>}
          </button>
        )
      })}
    </>
  )
}
