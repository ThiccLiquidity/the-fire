import { useMemo, useState } from 'react'
import { renderKey } from '../builder'
import { Field, Notice, ProgressBar, useAction } from '../components'
import { getBlob } from '../db'
import { ZipWriter, blobBytes, downloadBlob } from '../files'
import type { DealtCard } from '../deal'
import { lookFileName, lookOf, seriesGrid } from '../looks'
import { cardMetadata, metadataFileName } from '../metadata'
import {
  clearPinataJwt, filesFingerprint, hasPinataJwt, metadataDirName, mockTransport, pinataHas, realTransport, setPinataJwt, uploadFire, type UploadFile,
} from '../pinata'
import {
  clearFilebaseKey, filebaseBucket, filebaseCid, hasFilebaseKey, mockFilebase, pinOnFilebase, realFilebase, setFilebaseKey,
} from '../filebase'
import { carBytes, planCar } from '../car'
import { buildManifest } from '../manifest'
import { categoryProblem, nameProblem, normalizeCategory, normalizeName } from '../categories'
import { checkRecipe, recipeJson } from '../recipe'
import { saleErrors, saleJson, saleOf, salePacks } from '../sale'
import { artNeeds, buildGridKey, missingArt, missingFrames } from '../series'
import { lastAssetChange, updateFire, useStudio } from '../store'
import { BUILD_GRID_VERSION, fireStatus, type FireRecord, type UploadState } from '../types'
import { refreshDevFlags, useDevFlags } from '../devFlags'

/** A zip download is split into parts of about this size, so a very large Series never needs one giant zip in memory. */
const ZIP_PART_BYTES = 1.5 * 1024 ** 3

interface Check { label: string; ok: boolean; detail?: string }

type SavePicker = (o: unknown) => Promise<{ createWritable(): Promise<{ write(b: Uint8Array): Promise<void>; close(): Promise<void> }> }>
/** The browser's save-file picker (Chrome and Edge), which lets the CAR stream to disk. */
const savePicker = () => (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker
const NO_PICKER = 'Use Chrome or Edge to save the CAR.'

export function Export({ fire }: { fire: FireRecord }) {
  const s = useStudio()
  const flags = useDevFlags()
  const chars = useMemo(() => Object.fromEntries(s.characters.map((c) => [c.id, c])), [s.characters])
  // the same trimmed name and category recipe.json puts on-chain
  const charOf = (id: string) => ({ id, name: chars[id] ? normalizeName(chars[id].name) : id, category: normalizeCategory(chars[id]?.category ?? '') })
  const [busy, error, run] = useAction()
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [jwtInput, setJwtInput] = useState('')
  const [keySet, setKeySet] = useState(hasPinataJwt())
  const [fbInput, setFbInput] = useState({ accessKeyId: '', secretAccessKey: '', bucket: '' })
  const [fbSet, setFbSet] = useState(hasFilebaseKey())

  const deal = fire.deal
  const r = fire.recipe
  const ids = deal?.characterIds ?? fire.characterIds
  const recipeProblems = useMemo(() => checkRecipe(r), [r])
  const frames = useMemo(() => missingFrames(r), [r])
  const gridLen = useMemo(() => seriesGrid(fire.number, ids, r).length, [fire.number, ids, r])
  const gridKey = useMemo(() => buildGridKey(r, ids), [r, ids])
  const changed = lastAssetChange(ids)
  const sale = useMemo(() => saleOf(fire), [fire])
  const saleProblems = useMemo(() => saleErrors(sale), [sale])

  const charProblems: string[] = []
  const needs = artNeeds(r)
  for (const id of ids) {
    const c = chars[id]
    if (!c) { charProblems.push(`A character (${id}) no longer exists.`); continue }
    const np = nameProblem(normalizeName(c.name))
    const cp = categoryProblem(normalizeCategory(c.category ?? ''))
    const miss = missingArt(c, needs)
    if (np) charProblems.push(`"${c.name}": name ${np}`)
    else if (cp) charProblems.push(`${c.name}: category ${cp}`)
    else if (miss.length) charProblems.push(`${c.name}: missing ${miss.join(', ')} art`)
  }
  const b = fire.build
  const buildDetail = !b ? 'Build all images (Build & Review).'
    : b.grid !== BUILD_GRID_VERSION || b.format !== 'webp' ? 'This build is from an older version of the studio: rebuild.'
    : b.gridKey !== gridKey ? 'The recipe or characters changed since the build: rebuild.'
    : b.count !== gridLen ? `Only ${b.count.toLocaleString()} of ${gridLen.toLocaleString()} images are built: rebuild.`
    : changed > b.builtAt ? 'Art, layouts or fonts changed after the build: rebuild.' : undefined
  const checks: Check[] = [
    { label: 'Recipe valid (the contract\'s checks)', ok: recipeProblems.length === 0, detail: recipeProblems[0]?.message },
    { label: 'Frames for every card type', ok: frames.length === 0, detail: frames.map((m) => `${m.type}: ${m.missing.join(', ')}`).join('; ') },
    { label: `Characters valid (${ids.length.toLocaleString()}: name, category, art for this recipe)`, ok: ids.length > 0 && charProblems.length === 0, detail: ids.length ? charProblems.slice(0, 3).join('; ') + (charProblems.length > 3 ? ` (+${charProblems.length - 3} more)` : '') : 'Pick characters (Series tab).' },
    { label: 'Deal locked', ok: !!deal && deal.packs > 0, detail: !deal ? 'Lock the deal (Deal tab).' : deal.packs < 1 ? 'No packs: undo the lock, set the packs, deal again.' : undefined },
    { label: 'Samples approved', ok: !!fire.approvedAt && changed <= fire.approvedAt, detail: !fire.approvedAt ? 'Approve on Build & Review.' : 'Assets changed after approval: re-approve.' },
    { label: `Images built for the full grid (${gridLen.toLocaleString()})`, ok: !buildDetail, detail: buildDetail },
  ]
  const saleCheck: Check = { label: 'Sale settings valid (configureDrop\'s checks)', ok: saleProblems.length === 0, detail: saleProblems[0] ? `${saleProblems[0].message} (Sale tab)` : undefined }
  checks.push(saleCheck)
  const packs = deal?.packs ?? fire.packs
  const packsCheck: Check = { label: 'Sale packs match the Series', ok: salePacks(sale) === packs, detail: `The sale has ${salePacks(sale).toLocaleString()} (paid + press), the ${deal ? 'locked deal' : 'Series'} ${packs.toLocaleString()} (Sale tab).` }
  checks.push(packsCheck)
  const ready = checks.every((c) => c.ok)
  const recipeReady = checks[0].ok && checks[2].ok && saleCheck.ok && packsCheck.ok
  /** The shared image file this card points at (the name FireCards.imageName builds on-chain). */
  const indexOf = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids])
  const fileOf = (c: DealtCard) => lookFileName(lookOf(c, r), indexOf.get(c.characterId) ?? -1)

  const recipeOut = (imagesCid?: string) => recipeJson(
    fire.number, r,
    ids.map((id) => ({ name: normalizeName(chars[id]?.name ?? ''), category: normalizeCategory(chars[id]?.category ?? '') })),
    imagesCid ? `ipfs://${imagesCid}/` : undefined,
    saleJson(sale),
  )

  /** The upload is of the current build (only then does recipe.json name its folder as the images base). */
  const uploadCurrent = !!fire.upload?.imagesCid && !fire.upload.mock && !buildDetail && fire.upload.buildAt === b?.builtAt
  /** The upload (real or mock) is of this build: the second pin and the offline CAR apply to it. */
  const uploadOfBuild = !!fire.upload?.imagesCid && !buildDetail && fire.upload.buildAt === b?.builtAt

  /** What's still open before recipe.json should go on-chain: both pins read back, and the CAR stored offline. */
  const pinsOpen = uploadCurrent && (!fire.upload?.verifiedAt || !fire.upload.carStoredAt)
    ? [!fire.upload?.verifiedAt && 'check both pins', !fire.upload?.carStoredAt && 'store the CAR offline'].filter(Boolean).join(' and ')
    : ''

  const downloadRecipe = () => run(async () => {
    if (!recipeReady) throw new Error(!checks[0].ok ? checks[0].detail : !checks[2].ok ? checks[2].detail : !saleCheck.ok ? saleCheck.detail : packsCheck.detail)
    if (fire.upload?.imagesCid && !uploadCurrent) {
      throw new Error('The uploaded images are from an earlier build: upload this build first, so recipe.json points at the right images.')
    }
    if (pinsOpen && !confirm(`Not yet: ${pinsOpen}. Download recipe.json anyway?`)) return
    downloadBlob(new Blob([JSON.stringify(recipeOut(fire.upload?.imagesCid), null, 1)], { type: 'application/json' }), `recipe-fire-${fire.number}.json`)
  })

  /** The full grid, one file per image, read from IndexedDB one at a time (the blobs stay disk-backed), then
   *  manifest.json (every file's name, size and sha256, the grid key and the recipe hash; manifest.ts). */
  async function imageFiles(onEach?: (i: number, total: number) => void, onHash?: (i: number, total: number) => void): Promise<UploadFile[]> {
    const out: UploadFile[] = []
    const grid = seriesGrid(fire.number, deal!.characterIds, r)
    for (const g of grid) {
      const bl = await getBlob(renderKey(fire.number, g.key))
      if (!bl) throw new Error(`An image (${g.file}) is missing from the build; rebuild.`)
      out.push({ name: g.file, blob: bl })
      onEach?.(out.length, grid.length)
    }
    const manifest = await buildManifest(fire.number, gridKey, recipeJson(fire.number, r, ids.map((id) => ({ name: normalizeName(chars[id]?.name ?? ''), category: normalizeCategory(chars[id]?.category ?? '') }))), out, onHash)
    out.push({ name: manifest.name, blob: manifest.blob })
    return out
  }
  const readingProgress = (i: number, t: number) => { if (i % 200 === 0) setProgress({ value: i / t / 2, label: `Reading built images ${i.toLocaleString()} / ${t.toLocaleString()}` }) }
  const hashingProgress = (i: number, t: number) => { if (i % 200 === 0) setProgress({ value: 0.5 + i / t / 2, label: `manifest.json: hashing ${i.toLocaleString()} / ${t.toLocaleString()}` }) }

  const fireJson = (imagesCid?: string) => JSON.stringify({
    fire: fire.number, packs: deal!.packs, seed: deal!.seed, method: deal!.method,
    characters: deal!.characterIds.map((id, i) => ({ index: i, id, name: chars[id]?.name, category: chars[id]?.category ?? '' })),
    recipe: r, pool: Object.fromEntries(r.types.map((t, i) => [t.slug, deal!.pool[i]])), cardsPerPack: deal!.cardsPerPack,
    firstSerial: deal!.firstSerial, lastSerial: deal!.nextSerial - 1, packContents: deal!.packContents, upload: fire.upload ?? null,
    note: 'recipe.json sets the Series up on-chain; tokenURI builds each card\'s JSON itself, so metadata/ is a preview only. ' +
      (imagesCid ? 'Its image fields point at the uploaded images folder.' : 'Its image fields are relative paths inside this zip until the images are uploaded.'),
  }, null, 1)

  const downloadZip = () => run(async () => {
    const imagesCid = fire.upload?.imagesCid
    const files = await imageFiles(readingProgress, hashingProgress)
    let part = 1
    let zip = new ZipWriter()
    let size = 0
    const total = files.reduce((n, f) => n + f.blob.size, 0)
    const parts = Math.max(1, Math.ceil(total / ZIP_PART_BYTES))
    const name = (p: number) => (parts > 1 ? `card-studio-fire-${fire.number}-part${p}-of-${parts}.zip` : `card-studio-fire-${fire.number}.zip`)
    // part 1 carries the metadata, fire.json and recipe.json
    zip.addText('fire.json', fireJson(imagesCid))
    zip.addText('recipe.json', JSON.stringify(recipeOut(imagesCid), null, 1))
    let i = 0
    for (const c of deal!.cards) {
      const img = fileOf(c)
      const meta = cardMetadata(c, charOf(c.characterId), r.types[c.type]?.name ?? '?', imagesCid ? `ipfs://${imagesCid}/${img}` : `images/${img}`)
      zip.addText(`metadata/${metadataFileName(c)}`, JSON.stringify(meta, null, 2))
      if (++i % 500 === 0) {
        setProgress({ value: i / deal!.cards.length, label: `Metadata ${i.toLocaleString()} / ${deal!.cards.length.toLocaleString()}` })
        await new Promise((res) => setTimeout(res, 0))
      }
    }
    let n = 0
    for (const f of files) {
      if (size > 0 && size + f.blob.size > ZIP_PART_BYTES) {
        setProgress({ value: n / files.length, label: `Finishing ${name(part)}...` })
        downloadBlob(await zip.finish(), name(part))
        part++
        zip = new ZipWriter()
        size = 0
      }
      zip.addStored(`images/${f.name}`, await blobBytes(f.blob))
      size += f.blob.size
      if (++n % 100 === 0) setProgress({ value: n / files.length, label: `Zipping images ${n.toLocaleString()} / ${files.length.toLocaleString()}${parts > 1 ? ` (part ${part} of ${parts})` : ''}` })
    }
    setProgress({ value: 1, label: 'Finishing zip...' })
    downloadBlob(await zip.finish(), name(part))
    setProgress(null)
  })

  const upload = () => run(async () => {
    try {
      await doUpload()
    } finally {
      refreshDevFlags()
      setProgress(null)
    }
  })

  const doUpload = async () => {
    setLog([])
    const say = (t: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${t}`])
    setProgress({ value: 0, label: 'Reading built images...' })
    const files = await imageFiles(readingProgress, hashingProgress)
    // The images folder name carries a fingerprint of its contents; the metadata folder is named after the images CID.
    const imagesDirName = `fire-${fire.number}-images-${filesFingerprint(files)}`
    let current = { ...(fire.upload ?? {}) }
    if (current.imagesDir && current.imagesDir !== imagesDirName) {
      say(`The images changed since the saved upload (${current.imagesDir}); uploading the new build.`)
      current = {}
    }
    if (!!current.mock !== flags.mockPinata) current = {} // a mock upload is never reused for a real one (or the other way)
    const transport = flags.mockPinata ? mockTransport : realTransport
    const result = await uploadFire({
      fire: fire.number,
      imageFiles: files,
      imagesDirName,
      makeMetadata: (cid) => deal!.cards.map((c) => ({
        name: metadataFileName(c),
        blob: new Blob([JSON.stringify(cardMetadata(c, charOf(c.characterId), r.types[c.type]?.name ?? '?', `ipfs://${cid}/${fileOf(c)}`), null, 2)], { type: 'application/json' }),
      })),
      existing: { imagesCid: current.imagesCid, metadataCid: current.metadataCid, pending: current.pending },
      save: async (patch) => {
        const now = Date.now()
        const { pending, ...rest } = patch
        current = {
          ...current, ...rest, format: 'webp', imagesDir: imagesDirName, mock: flags.mockPinata, buildAt: b?.builtAt,
          ...(patch.imagesCid ? { imagesAt: now } : {}), ...(patch.metadataCid ? { metadataAt: now } : {}),
        }
        if (pending === null) delete current.pending
        else if (pending) current.pending = pending
        await updateFire(fire.number, { upload: current })
      },
      onStatus: say,
      onProgress: (v) => setProgress({ value: v, label: `Uploading ${(v * 100).toFixed(1)}%` }),
    }, transport)
    say(`Images CID ${result.imagesCid}, metadata CID ${result.metadataCid}`)
    current = { ...current, imagesCarSize: result.imagesCar.size }
    await updateFire(fire.number, { upload: current })
    if (!hasFilebaseKey()) {
      say('No Filebase key for this session: the second pin is still to do (enter the key, then "Pin to Filebase").')
      return
    }
    current = await secondPin(files, imagesDirName, result.imagesCar, current, say)
    current = await checkPins(current, say)
  }

  /** The same images CAR, pinned on Filebase (resuming an earlier attempt of the same CAR). */
  const secondPin = async (files: UploadFile[], dir: string, car: { root: string; size: number }, cur: UploadState, say: (t: string) => void): Promise<UploadState> => {
    let state = { ...cur }
    const save = async (patch: Partial<UploadState>) => {
      state = { ...state, ...patch }
      await updateFire(fire.number, { upload: state })
    }
    const p = state.filebasePending
    const resumeId = p && p.object === dir && p.root === car.root && p.size === car.size ? p.id : undefined
    if (resumeId) say('Resuming the earlier Filebase upload of this folder...')
    say(`Second pin: ${dir}.car (${(car.size / 1024 / 1024).toFixed(1)} MB) to Filebase bucket "${filebaseBucket()}"...`)
    const cid = await pinOnFilebase(flags.mockPinata ? mockFilebase : realFilebase, {
      name: dir, root: car.root, size: car.size, resumeId, bytes: (from) => carBytes(files, car.root, from),
      onResumeId: async (id) => save({ filebasePending: id ? { object: dir, root: car.root, size: car.size, id } : undefined }),
    }, say, (l, t) => setProgress({ value: l / Math.max(1, t), label: `Filebase ${((l / Math.max(1, t)) * 100).toFixed(1)}%` }))
    await save({ filebaseCid: cid, filebaseObject: dir, filebaseAt: Date.now(), filebasePending: undefined })
    say(`Filebase pinned ${cid}: the same root CID as Pinata.`)
    return state
  }

  /** Read both pins back: each must hold the images CID. */
  const checkPins = async (cur: UploadState, say: (t: string) => void): Promise<UploadState> => {
    if (!cur.imagesCid || !cur.filebaseObject) throw new Error('Pin on both first.')
    const onPinata = await pinataHas(flags.mockPinata ? mockTransport : realTransport, cur.imagesCid)
    const onFilebase = await filebaseCid(flags.mockPinata ? mockFilebase : realFilebase, cur.filebaseObject)
    if (!onPinata) throw new Error(`Pinata doesn't list ${cur.imagesCid}.`)
    if (onFilebase !== cur.imagesCid) throw new Error(`Filebase's ${cur.filebaseObject}.car is ${onFilebase ?? 'missing'}, not ${cur.imagesCid}.`)
    const next = { ...cur, verifiedAt: Date.now() }
    await updateFire(fire.number, { upload: next })
    say(`Both pins checked: Pinata and Filebase hold ${cur.imagesCid}.`)
    return next
  }

  const pinFilebase = () => run(async () => {
    try {
      setLog([])
      const say = (t: string) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${t}`])
      const cur = fire.upload
      if (!cur?.imagesCid || !cur.imagesDir) throw new Error('Upload to Pinata first.')
      setProgress({ value: 0, label: 'Reading built images...' })
      const files = await imageFiles(readingProgress, hashingProgress)
      if (`fire-${fire.number}-images-${filesFingerprint(files)}` !== cur.imagesDir) throw new Error('The build changed since the Pinata upload: upload it again first.')
      setProgress({ value: 0, label: 'Packing the CAR (hashing)...' })
      const car = await planCar(files)
      if (car.root !== cur.imagesCid) throw new Error(`This build packs to ${car.root}, not the uploaded ${cur.imagesCid}.`)
      let next = await secondPin(files, cur.imagesDir, car, { ...cur, imagesCarSize: car.size }, say)
      if (hasPinataJwt()) next = await checkPins(next, say)
      else say('Enter the Pinata JWT and press "Check both pins" to read both back.')
    } finally {
      setProgress(null)
    }
  })

  const checkBoth = () => run(async () => {
    setLog([])
    await checkPins(fire.upload ?? {}, (t) => setLog((l) => [...l, `${new Date().toLocaleTimeString()} ${t}`]))
  })

  /** Save the images CAR to disk (streamed to a file where the browser allows it). Keep it offline: anyone can pin it
   *  again anywhere (ipfs dag import, or any pinning service's CAR upload) and get the same CID. */
  const saveCar = () => run(async () => {
    try {
      const cur = fire.upload
      if (!cur?.imagesCid || !cur.imagesDir) throw new Error('Upload first.')
      const files = await imageFiles(readingProgress, hashingProgress)
      const car = cur.imagesCarSize ? { root: cur.imagesCid, size: cur.imagesCarSize } : await planCar(files)
      if (car.root !== cur.imagesCid) throw new Error(`This build packs to ${car.root}, not the uploaded ${cur.imagesCid}.`)
      const name = `${cur.imagesDir}.car`
      // streamed straight to the file: never the whole CAR in memory (browsers without a save picker can't do that)
      const picker = savePicker()
      if (!picker) throw new Error(NO_PICKER)
      let done = 0
      const tick = () => setProgress({ value: done / Math.max(1, car.size), label: `Writing ${name}: ${(done / 1024 / 1024).toFixed(0)} / ${(car.size / 1024 / 1024).toFixed(0)} MB` })
      const handle = await picker({ suggestedName: name, types: [{ description: 'CAR file', accept: { 'application/vnd.ipld.car': ['.car'] } }] })
      const w = await handle.createWritable()
      for await (const c of carBytes(files, car.root)) { await w.write(c); done += c.length; tick() }
      await w.close()
      await updateFire(fire.number, { upload: { ...cur, imagesCarSize: car.size, carSavedAt: Date.now() } })
    } finally {
      setProgress(null)
    }
  })

  const confirmStored = (on: boolean) => run(async () => {
    if (!fire.upload) return
    await updateFire(fire.number, { upload: { ...fire.upload, carStoredAt: on ? Date.now() : undefined } })
  })

  const resetUpload = () => run(async () => {
    if (!confirm('Forget the saved CIDs for this Series? (Nothing is deleted on Pinata.)')) return
    await updateFire(fire.number, { upload: undefined })
  })

  return (
    <section className="panel grow">
      <div className="row wrap">
        <h2>Export &amp; Upload · Series {fire.number}</h2>
        <span className={`badge status-${fireStatus(fire)}`}>{fireStatus(fire)}</span>
      </div>
      <h3>Ready?</h3>
      <ul className="checklist" data-testid="checklist">
        {checks.map((c) => (
          <li key={c.label} className={c.ok ? 'ok' : 'no'}>
            <span className="mark">{c.ok ? 'OK' : 'NO'}</span> {c.label}
            {!c.ok && c.detail && <div className="muted small">{c.detail}</div>}
          </li>
        ))}
      </ul>

      <h3>recipe.json</h3>
      <p className="muted small">Sets the Series up on-chain.</p>
      <div className="row wrap">
        <button className="primary" disabled={!recipeReady || busy} onClick={downloadRecipe} data-testid="download-recipe">Download recipe.json</button>
        {!fire.upload?.imagesCid && <span className="muted small">No images uploaded yet: no imagesBase.</span>}
        {pinsOpen && <span className="warn-text small" data-testid="recipe-pins-open">Before using it: {pinsOpen}.</span>}
      </div>

      <h3>Download everything</h3>
      <p className="muted small">{gridLen.toLocaleString()} images, metadata and the JSON, in one zip (parts of ~1.5 GB if big).</p>
      <button className="primary" disabled={!ready || busy} onClick={downloadZip} data-testid="download-zip">Download zip</button>

      <h3>Upload: Pinata + Filebase</h3>
      <p className="muted small">Both pins must hold the same CID. Keys stay in this tab only; a reload forgets them.</p>
      {flags.mockPinata && <Notice kind="warn">Mock IPFS is on (Data tab): nothing is uploaded.</Notice>}
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setPinataJwt(jwtInput); setJwtInput(''); setKeySet(hasPinataJwt()) }}>
        <Field label="Pinata JWT (Files write)">
          <input type="password" autoComplete="new-password" data-1p-ignore="" data-lpignore="true" value={jwtInput} onChange={(e) => setJwtInput(e.target.value)} placeholder={keySet ? 'key set for this session' : 'paste JWT'} data-testid="jwt" />
        </Field>
        <button type="submit" disabled={!jwtInput.trim()}>Use key</button>
        {keySet && <button type="button" onClick={() => { clearPinataJwt(); setKeySet(false) }}>Forget key</button>}
      </form>
      <form className="row wrap" onSubmit={(e) => { e.preventDefault(); setFilebaseKey(fbInput); setFbInput({ accessKeyId: '', secretAccessKey: '', bucket: '' }); setFbSet(hasFilebaseKey()) }}>
        <Field label="Filebase access key">
          <input type="password" autoComplete="new-password" data-1p-ignore="" data-lpignore="true" value={fbInput.accessKeyId} onChange={(e) => setFbInput({ ...fbInput, accessKeyId: e.target.value })} placeholder={fbSet ? 'key set for this session' : 'access key'} data-testid="fb-access" />
        </Field>
        <Field label="Filebase secret">
          <input type="password" autoComplete="new-password" data-1p-ignore="" data-lpignore="true" value={fbInput.secretAccessKey} onChange={(e) => setFbInput({ ...fbInput, secretAccessKey: e.target.value })} placeholder={fbSet ? 'set' : 'secret key'} data-testid="fb-secret" />
        </Field>
        <Field label="Bucket (IPFS)">
          <input autoComplete="off" value={fbInput.bucket} onChange={(e) => setFbInput({ ...fbInput, bucket: e.target.value })} placeholder={fbSet ? filebaseBucket() : 'bucket name'} data-testid="fb-bucket" />
        </Field>
        <button type="submit" disabled={!fbInput.accessKeyId.trim() || !fbInput.secretAccessKey.trim() || !fbInput.bucket.trim()}>Use key</button>
        {fbSet && <button type="button" onClick={() => { clearFilebaseKey(); setFbSet(false) }}>Forget key</button>}
      </form>
      <div className="row wrap">
        <button className="primary" disabled={!ready || busy || !keySet} onClick={upload} data-testid="upload">
          {fire.upload?.pending || (fire.upload?.imagesCid && !fire.upload.metadataCid) ? 'Resume upload' : fire.upload?.metadataCid ? 'Upload (already done)' : fbSet ? 'Upload to Pinata + Filebase' : 'Upload to Pinata'}
        </button>
        {uploadOfBuild && !fire.upload?.filebaseCid && <button disabled={busy || !fbSet} onClick={pinFilebase} data-testid="pin-filebase">{fire.upload?.filebasePending ? 'Resume Filebase pin' : 'Pin to Filebase'}</button>}
        {uploadOfBuild && fire.upload?.filebaseCid && <button disabled={busy || !fbSet || !keySet} onClick={checkBoth} data-testid="check-pins">Check both pins</button>}
        {fire.upload && <button disabled={busy} onClick={resetUpload}>Forget CIDs</button>}
      </div>
      {progress && <ProgressBar value={progress.value} label={progress.label} />}
      {error && <Notice kind="error">{error}</Notice>}
      {fire.upload && (
        <table className="mini" data-testid="cids">
          <tbody>
            <tr><td>Images CID</td><td><code>{fire.upload.imagesCid ?? '-'}</code></td></tr>
            <tr><td>imagesBase (on-chain, in recipe.json)</td><td><code data-testid="images-base">{fire.upload.imagesCid ? `ipfs://${fire.upload.imagesCid}/` : '-'}</code></td></tr>
            <tr><td>Pinata</td><td>{fire.upload.imagesCid ? <span className="ok-text">pinned</span> : '-'}</td></tr>
            <tr>
              <td>Filebase (second pin)</td>
              <td data-testid="filebase-cid">
                {fire.upload.filebaseCid
                  ? <>{fire.upload.filebaseCid === fire.upload.imagesCid ? <span className="ok-text">pinned, same root CID</span> : <span className="warn-text">different CID: {fire.upload.filebaseCid}</span>} <span className="muted small">{fire.upload.filebaseObject}.car</span></>
                  : fire.upload.filebasePending ? <span className="warn-text">unfinished: resumes on "Resume Filebase pin"</span>
                  : <span className="warn-text">not yet</span>}
              </td>
            </tr>
            <tr><td>Both read back</td><td>{fire.upload.verifiedAt ? <span className="ok-text">{new Date(fire.upload.verifiedAt).toLocaleString()}</span> : <span className="muted">not yet</span>}</td></tr>
            <tr><td>Offline CAR</td><td>{fire.upload.carStoredAt ? <span className="ok-text">stored offline (confirmed {new Date(fire.upload.carStoredAt).toLocaleDateString()})</span> : fire.upload.carSavedAt ? <span className="warn-text">saved {new Date(fire.upload.carSavedAt).toLocaleString()}, not confirmed stored</span> : <span className="warn-text">not saved yet</span>}</td></tr>
            <tr><td>Metadata CID (preview only)</td><td><code>{fire.upload.metadataCid ?? '-'}</code>{fire.upload.imagesCid ? <span className="muted small"> {metadataDirName(fire.number, fire.upload.imagesCid)}/</span> : null}</td></tr>
            {fire.upload.pending && <tr><td>Unfinished upload</td><td className="small">{fire.upload.pending.dir} ({(fire.upload.pending.size / 1024 / 1024).toFixed(1)} MB): resumes on the next upload</td></tr>}
            {fire.upload.mock && <tr><td colSpan={2}><span className="tag">mock upload</span></td></tr>}
          </tbody>
        </table>
      )}
      {uploadOfBuild && !fire.upload?.carStoredAt && (
        <Notice kind="warn">
          <strong>Keep the images CAR offline.</strong> Save <code>{fire.upload?.imagesDir}.car</code>
          {fire.upload?.imagesCarSize ? ` (${(fire.upload.imagesCarSize / 1024 / 1024).toFixed(1)} MB)` : ''} to a drive you keep: it re-pins
          the images with the same CID.
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button disabled={busy || !savePicker()} onClick={saveCar} data-testid="save-car">Save images CAR</button>
            {!savePicker() && <span className="warn-text small" data-testid="save-car-browser">{NO_PICKER}</span>}
            <label className="check"><input type="checkbox" disabled={busy || !fire.upload?.carSavedAt} checked={false} onChange={(e) => confirmStored(e.target.checked)} data-testid="car-stored" /> I've stored it offline</label>
          </div>
        </Notice>
      )}
      {log.length > 0 && <pre className="log" data-testid="upload-log">{log.join('\n')}</pre>}
      {flags.mockPinata && flags.mockFailNext > 0 && <p className="muted small">Mock will fail the next {flags.mockFailNext} upload(s) halfway.</p>}
    </section>
  )
}
