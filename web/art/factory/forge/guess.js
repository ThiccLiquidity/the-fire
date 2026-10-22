/* Omni Cardworks (fun layer): guess the pick. When new suggestion results come in, before the reveal shows the
   winner, anyone can guess which of the 10 drawn ideas was picked. Free, no money, no prize: right guesses build a
   streak (a badge at 3 in a row, a flame on your showcase). Kept in this browser for now. */
(() => {
  const { h, mem } = Fun;
  const KEY = 'omni.guess'; // { streak, best, waves: { 'series-wave-kind': { pick, right } } }
  const get = () => ({ streak: 0, best: 0, waves: {}, ...(mem(KEY) || {}) });
  Fun.guess = (w, done) => {
    const k = w.kinds?.[0]; if (!k?.shortlist?.length) return done();
    const id = `${w.series}-${w.wave}-${k.kind}`, st = get();
    if (st.waves[id]) return done(); // guessed this one already
    const win = k.shortlist.find((x) => x.picked);
    if (!win) return done();
    let answered = false;
    const msg = h('p', { class: 'gp-msg', 'aria-live': 'polite' });
    const go = h('button', { type: 'button', class: 'btn primary', text: 'Skip', onclick: () => Sheet.close('guess') });
    const list = h('ol', { class: 'gp-list' }, [...k.shortlist].sort((a, b) => a.title.localeCompare(b.title)).map((x) => h('li', {}, h('button', { type: 'button', class: 'gp-opt', 'data-id': x.id, text: x.title, onclick: (e) => answer(x, e.currentTarget) }))));
    function answer(x, b) {
      if (answered) return; answered = true;
      const right = x.id === win.id, s = get();
      s.streak = right ? s.streak + 1 : 0; s.best = Math.max(s.best, s.streak); s.waves[id] = { pick: x.id, right }; mem(KEY, s);
      list.querySelectorAll('.gp-opt').forEach((o) => { o.disabled = true; if (+o.dataset.id === win.id) o.classList.add('win'); });
      b.classList.add(right ? 'right' : 'wrong');
      msg.textContent = right ? (s.streak > 1 ? `Right! ${s.streak} in a row.` : 'Right!') : `Not this time. It was “${win.title}”.`;
      Fun.badge?.('streak', s.streak, true);
      go.textContent = 'See results';
      go.focus({ preventScroll: true });
    }
    Sheet.open('guess', { title: 'Guess the pick', onClose: () => setTimeout(done, 50), body: h('div', { class: 'st guess' },
      h('p', { class: 'lead', text: `Series ${w.series}: which ${k.kind === 'style' ? 'art style' : k.kind} was picked from these 10?` }),
      h('p', { class: 'muted small', text: 'Just for fun, no prize. Right guesses build a streak.' + (st.streak ? ` Your streak: ${st.streak}.` : '') }),
      list, msg, h('div', { class: 'row' }, go)) });
  };
})();
