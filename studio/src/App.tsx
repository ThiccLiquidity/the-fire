import { useEffect, useState } from 'react'
import { Notice } from './components'
import { Data } from './screens/Data'
import { Deal } from './screens/Deal'
import { Export } from './screens/Export'
import { FireList, FireSetup } from './screens/Fire'
import { Frames } from './screens/Frames'
import { Library } from './screens/Library'
import { Review } from './screens/Review'
import { loadStudio, useStudio } from './store'

const TABS = [
  { id: 'library', label: '1 Library' },
  { id: 'frames', label: '2 Frames & Layout' },
  { id: 'fire', label: '3 Fire' },
  { id: 'deal', label: '4 Deal' },
  { id: 'review', label: '5 Build & Review' },
  { id: 'export', label: '6 Export & Upload' },
  { id: 'data', label: 'Data' },
] as const
type Tab = (typeof TABS)[number]['id']

function readTab(): Tab {
  const h = location.hash.slice(1)
  return (TABS.find((t) => t.id === h)?.id ?? 'library') as Tab
}

export default function App() {
  const s = useStudio()
  const [tab, setTab] = useState<Tab>(readTab)
  const [fireNo, setFireNo] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    loadStudio().catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
    const onHash = () => setTab(readTab())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const go = (t: Tab) => {
    location.hash = t
    setTab(t)
  }

  const fire = s.fires.find((f) => f.number === fireNo) ?? s.fires[s.fires.length - 1]
  const perFire = tab === 'fire' || tab === 'deal' || tab === 'review' || tab === 'export'

  return (
    <div className="app">
      <header className="top">
        <div className="brand">Card Studio</div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => go(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>
          ))}
        </nav>
      </header>
      <main>
        {loadError && <Notice kind="error">Couldn't open the local database: {loadError}</Notice>}
        {!s.loaded && !loadError && <p className="muted">Loading library...</p>}
        {s.loaded && tab === 'library' && <Library />}
        {s.loaded && tab === 'frames' && <Frames />}
        {s.loaded && tab === 'data' && <Data />}
        {s.loaded && perFire && (
          <div className="split">
            <FireList selected={fire?.number ?? null} onSelect={setFireNo} />
            {!fire && <section className="panel grow"><p className="muted">Create a Fire to start.</p></section>}
            {fire && tab === 'fire' && <FireSetup key={fire.number} fire={fire} onDeleted={() => setFireNo(null)} />}
            {fire && tab === 'deal' && <Deal key={fire.number} fire={fire} />}
            {fire && tab === 'review' && <Review key={fire.number} fire={fire} />}
            {fire && tab === 'export' && <Export key={fire.number} fire={fire} />}
          </div>
        )}
      </main>
    </div>
  )
}
