// The doors: the landing with two big doors, the Card Press (Cardworks) and the Printing Press (The Morning Wood).
// A door swings open when you pick it, then you're through. Plain links underneath (middle-click, no JS: still work).
import "../site/fonts.css";
import "./doors.css";
import { liveNet, markDoors, reducedMotion, withMode } from "../site/mode.ts";

markDoors();
const live = liveNet();
const app = document.getElementById("app")!;
app.innerHTML = `
<main class="wall">
  <header class="top">
    <img class="mark" src="/forge/ui/omni-mark.webp" alt="" width="44" height="44">
    <h1>Pick a door</h1>
    ${live ? "" : '<p class="demo"><b>Demo</b> Nothing here is real.</p>'}
  </header>
  <nav class="doors" aria-label="The two doors">
    <a class="door cards" href="${withMode("/forge/")}">
      <span class="frame">
        <span class="room" aria-hidden="true"><span class="fire"></span></span>
        <span class="leaf" aria-hidden="true">
          <span class="plate">CARD<br>PRESS</span>
          <img class="pack" src="/forge/ui/omni-pack.webp" alt="" loading="eager" decoding="async">
          <span class="knob"></span>
        </span>
        <span class="light" aria-hidden="true"></span>
      </span>
      <span class="label"><b>The Card Press</b><small>Rip packs. Pull holos.</small></span>
    </a>
    <a class="door paper" href="${withMode("/press/")}">
      <span class="frame">
        <span class="room" aria-hidden="true"><span class="lamp"></span></span>
        <span class="leaf" aria-hidden="true">
          <span class="plate">PRINTING<br>PRESS</span>
          <span class="news">
            <span class="n-mast">The Morning Wood</span>
            <span class="n-motto">Hard News, Every Morning</span>
            <span class="n-hed">TODAY'S PAPER<br>IS OUT</span>
            <span class="n-lines"></span>
            <span class="n-stamp">SATIRE</span>
          </span>
          <span class="knob"></span>
        </span>
        <span class="light" aria-hidden="true"></span>
      </span>
      <span class="label"><b>The Printing Press</b><small>The Morning Wood. Daily.</small></span>
    </a>
  </nav>
  <p class="floor">Omni · on Robinhood Chain</p>
</main>`;

// swing the door, then go through (a plain click only: new tabs, keyboard modifiers and reduced motion go straight)
app.querySelectorAll<HTMLAnchorElement>(".door").forEach((a) => {
  a.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reducedMotion()) return;
    e.preventDefault();
    a.classList.add("open");
    document.body.classList.add("leaving");
    setTimeout(() => { location.href = a.href; }, 430);
  });
});
// back from a side (the page comes back from the back/forward cache): doors shut again
addEventListener("pageshow", () => { app.querySelectorAll(".door.open").forEach((d) => d.classList.remove("open")); document.body.classList.remove("leaving"); });
