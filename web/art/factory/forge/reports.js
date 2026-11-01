// Tester reports, for the owner (api/report). The key stays in this tab only (sessionStorage) and goes only to
// /api/report on this site. Every report is shown as plain text (textContent), never as HTML.
(() => {
  const $ = (id) => document.getElementById(id);
  let key = '';
  try { key = sessionStorage.getItem('omni.reportsKey') || ''; } catch { /* private window */ }
  let rows = [];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : 'no wallet');

  function paint() {
    const kind = $('kind').value, list = $('list'), shown = rows.filter((r) => !kind || r.kind === kind);
    list.replaceChildren();
    $('count').textContent = `${shown.length} shown`;
    for (const r of shown) {
      const li = el('li', r.status === 'done' ? 'done' : '');
      const meta = el('div', 'meta');
      meta.append(el('span', `tag ${r.kind}`, r.kind), el('span', '', `#${r.id}`), el('span', '', when(r.at)), el('span', '', r.area), el('span', '', short(r.wallet)), el('span', '', r.screen || ''));
      li.append(meta, el('p', 'text', r.text));
      const d = el('details'); d.append(el('summary', '', 'Details'), el('pre', '', [`Page: ${r.page || ''}`, `Network: ${r.net || ''}`, `Wallet: ${r.wallet || ''}`, `Browser: ${r.ua || ''}`, r.errors ? `Errors:\n${r.errors}` : 'Errors: none'].join('\n')));
      const b = el('button', 'btn small', r.status === 'done' ? 'Reopen' : 'Mark done'); b.type = 'button';
      b.onclick = async () => { b.disabled = true; if (await call('status', { id: r.id, status: r.status === 'done' ? 'open' : 'done' })) load(); else b.disabled = false; };
      li.append(d, b);
      list.append(li);
    }
  }
  async function call(action, body) {
    const r = await fetch(`/api/report/${action}${body ? '' : `?status=${$('status').value}`}`, {
      method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${key}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) { $('msg').textContent = j.error || 'Couldn’t reach the server.'; if (r?.status === 401) { $('bar').hidden = true; try { sessionStorage.removeItem('omni.reportsKey'); } catch { /* */ } } return null; }
    $('msg').textContent = '';
    return j;
  }
  async function load() {
    const j = await call('list');
    if (!j) return;
    try { sessionStorage.setItem('omni.reportsKey', key); } catch { /* private window */ }
    $('bar').hidden = false; rows = j.reports; paint();
  }
  $('keyForm').onsubmit = (e) => { e.preventDefault(); key = $('key').value.trim(); $('key').value = ''; load(); };
  $('status').onchange = load; $('kind').onchange = paint; $('reload').onclick = load;
  if (key) load();
})();
