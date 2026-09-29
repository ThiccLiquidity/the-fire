// Last line of defence: a render error shows a way out instead of a blank page. In the demo a bad saved game can
// crash every load, so it also offers to wipe the demo's save.
import { Component, type ReactNode } from "react";

const DEMO = !import.meta.env.VITE_FIRE_ADDRESS;
const DEMO_STORE = "the-fire-demo-v4"; // mock.ts STORE

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error("The page hit an error", e); }
  render() {
    if (!this.state.failed) return this.props.children;
    const resetDemo = () => { try { localStorage.removeItem(DEMO_STORE); } catch { /* nothing saved */ } location.reload(); };
    return (
      <div className="crash" role="alert">
        <h2>The fire flickered.</h2>
        <p>Something on this page broke. {DEMO ? "Reload to try again, or start the demo over." : "Reload to try again. Nothing in your wallet was touched."}</p>
        <div className="crash-row">
          <button className="cta" onClick={() => location.reload()}>Reload</button>
          {DEMO && <button className="cta ghost" onClick={resetDemo}>Reset the demo</button>}
        </div>
      </div>
    );
  }
}
