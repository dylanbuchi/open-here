(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AGE = { '24_and_younger': 'Under 25', '25_to_29': '25 to 29', '30_to_34': '30 to 34', '35_to_44': '35 to 44', '45_to_54': '45 to 54', '55_and_older': '55 and up' };

  const map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([39.5, -98.35], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);
  let layers = L.layerGroup().addTo(map);
  let zoneMarkers = [];
  // leaflet.heat only redraws once a zoom ends, so during flyTo the old
  // drawing stretches across the map. Hide it while zooming, redraw on landing.
  let heat = null;
  map.on('zoomstart', () => { if (heat && heat._canvas) heat._canvas.style.opacity = '0'; });
  map.on('zoomend moveend', () => {
    if (!heat || !heat._canvas) return;
    heat.redraw();
    heat._canvas.style.opacity = '1';
  });
  let seq = 0;
  let last = null;
  let isExample = false;
  let curPlaybook = null;
  let cmpCtl = null;
  let exSlug = null;
  let curMarket = null;
  let aiPin = null;
  const lp = (lift) => fmtSigned((+lift || 0) * 100, 0);
  const isPhone = () => matchMedia('(max-width:899px)').matches;
  let wantJump = false;
  function toAgent() {
    if (!isPhone()) return;
    wantJump = true;
    const el = $('agent');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  }

  function street(address, city) {
    if (!address) return '';
    const i = address.toLowerCase().lastIndexOf(' ' + city.toLowerCase());
    let s = i > 0 ? address.slice(0, i) : address.split(',')[0];
    return s.trim();
  }

  // Neighborhood first; fall back to the landmark when the neighborhood is unknown.
  function placeName(z) {
    const lm = (z && z.landmark) || {};
    return z && z.neighborhood ? z.neighborhood : 'Near ' + (lm.name || 'this spot');
  }
  function placeSub(z, city) {
    const lm = (z && z.landmark) || {};
    const st = street(lm.address, city || '');
    if (z && z.neighborhood) return [lm.name ? 'near ' + lm.name : '', st].filter(Boolean).join(' \u00b7 ');
    return st;
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, '')).join(' ');

  function setBusy(b) {
    $('maploading').hidden = !b;
    $('go').disabled = b;
    $('go').textContent = b ? 'Reading…' : 'Find my spot';
  }

  let ctl = null;

  function showError(msg) {
    $('content').hidden = true;
    $('status').innerHTML = '<div class="errbox"><p>' + esc(msg) + '</p><button class="btn" id="retry" type="button">Try again</button></div>';
    $('retry').addEventListener('click', () => last && run(last.concept, last.city, last.brief));
    $('live').textContent = 'Error: ' + msg;
  }

  function showSuggestions(msg, suggestions, city) {
    $('content').hidden = true;
    $('agent').hidden = true;
    $('playbook').hidden = true;
    const chips = suggestions.map((s) => '<button class="chip" type="button" data-concept="' + esc(s) + '">' + esc(s) + ' · ' + esc(city) + '</button>').join('');
    $('status').innerHTML = '<div class="errbox"><p>' + esc(msg) + '</p>' + (chips ? '<div class="chips">' + chips + '</div>' : '') + '</div>';
    $('status').querySelectorAll('button[data-concept]').forEach((b) => b.addEventListener('click', () => {
      $('concept').value = b.dataset.concept;
      run(b.dataset.concept, city, $('brief').value);
    }));
    $('live').textContent = msg + ' ' + suggestions.join(', ');
    // On phones the message sits below the map, so bring it into view.
    $('status').scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const first = $('status').querySelector('button[data-concept]');
    if (first) first.focus({ preventScroll: true });
  }

  function resetResults() {
    if (cmpCtl) cmpCtl.abort();
    clearAiPin();
    // Clear the previous city's heatmap and pins right away, so they never
    // linger while a new search loads or after a search fails.
    map.closePopup();
    layers.clearLayers();
    heat = null;
    zoneMarkers = [];
    compMarkers = [];
    activeComp = -1;
    curPlaybook = null;
    $('compare').innerHTML = '';
    $('results').classList.remove('wide');
    $('example-note').hidden = true;
    $('content').hidden = true;
    $('empty').hidden = true;
    $('lowsignal').hidden = true;
    $('zonestat').hidden = true;
    $('status').innerHTML = '';
    $('agent-steps').innerHTML = '';
    $('agent').hidden = false;
    $('agent').open = true;
    $('agent').classList.remove('done');
    $('agent-title').textContent = 'Agent at work';
    const pb = $('playbook');
    pb.hidden = false;
    pb.querySelector('.playbook-body').innerHTML = '<div class="pskel" aria-hidden="true"><div class="h"></div><div></div><div class="s"></div></div><p class="hint pwait">The agent is drafting your playbook from Qloo taste data…</p>';
  }

  function addStep(label) {
    const ol = $('agent-steps');
    const prev = ol.querySelector('li.current');
    if (prev) { prev.classList.remove('current'); prev.classList.add('ok'); }
    const li = document.createElement('li');
    li.className = 'current';
    li.innerHTML = '<span class="mark" aria-hidden="true"></span><span>' + esc(label) + '</span>';
    ol.appendChild(li);
  }

  function fmtSigned(n, digits) {
    const f = Math.pow(10, digits || 0);
    const r = Math.round(Math.abs(n) * f) / f;
    if (!isFinite(r) || r === 0) return '0';
    return (n > 0 ? '+' : '\u2212') + r.toFixed(digits || 0);
  }

  function completeSteps() {
    $('agent-steps').querySelectorAll('li.current').forEach((li) => { li.classList.remove('current'); li.classList.add('ok'); });
  }

  function finishTrace(t0, elapsedMs) {
    const ol = $('agent-steps');
    completeSteps();
    const n = ol.children.length;
    $('agent').classList.add('done');
    $('agent-title').textContent = n ? (isExample ? 'Recorded run · ' : 'Agent took ') + n + ' step' + (n === 1 ? '' : 's') + ' · ' + ((elapsedMs != null ? elapsedMs : Date.now() - t0) / 1000).toFixed(1) + 's' : 'Agent finished';
    $('agent').open = false;
  }

  function playbookNote(msg, soft) {
    $('playbook').hidden = false;
    $('playbook').querySelector('.playbook-body').innerHTML = '<div class="pnote' + (soft ? ' soft' : '') + '"><p>' + esc(msg) + '</p></div>';
  }

  async function fallbackAnalyze(concept, city, my, signal) {
    try {
      const r = await fetch('/api/analyze?' + new URLSearchParams({ concept, city }), { signal });
      let data = null;
      try { data = await r.json(); } catch { /* non-JSON */ }
      if (my !== seq) return;
      if (!r.ok || !data || data.error) throw new Error((data && data.error) || 'Something went wrong (' + r.status + '). Please try again.');
      render(data);
    } catch (e) {
      if (my !== seq || e.name === 'AbortError') return;
      showError(e.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : e.message);
    }
  }

  const NET_MSG = 'Could not reach the server. Check your connection and try again.';
  const STALL_MS = 30000;
  const TOTAL_MS = 70000;

  // Shared event handler for live streams and recorded replays. State is only
  // updated after rendering succeeds; render errors propagate to the caller.
  function makeHandler(my, st) {
    return (ev) => {
      if (my !== seq || !ev || typeof ev !== 'object') return;
      if (ev.type === 'step') addStep(ev.label || 'Working…');
      else if (ev.type === 'market' && ev.data) { render(ev.data); st.market = ev.data; }
      else if (ev.type === 'playbook' && ev.data) { renderPlaybook(ev.data); st.gotPlaybook = true; completeSteps(); }
      else if (ev.type === 'error') st.errored = ev;
    };
  }

  function begin(concept, city, brief) {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const my = ++seq;
    wantJump = false;
    setBusy(true);
    resetResults();
    $('live').textContent = 'The agent is analyzing ' + concept + ' in ' + city + '…';
    return my;
  }

  async function settle(st, my, concept, city, signal, t0, elapsedMs) {
    if (my !== seq) return;
    finishTrace(t0, elapsedMs);
    // Phones: the playbook sits below the map, so bring it into view once the layout has settled.
    if (st.gotPlaybook && wantJump && isPhone()) {
      wantJump = false;
      setTimeout(() => $('playbook').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }), 60);
    }
    if (st.errored && !st.market && Array.isArray(st.errored.suggestions)) {
      // No data for this concept: offer concepts that do have data here.
      showSuggestions(st.errored.message, st.errored.suggestions, city);
    } else if (st.errored && !st.gotPlaybook) {
      if (st.errored.code === 'budget') playbookNote('The AI agent is resting for today, but the map data still works. Explore the top spots below.', true);
      else playbookNote(st.errored.message || 'The agent could not finish. The map data still works.', true);
      if (!st.market) await fallbackAnalyze(concept, city, my, signal);
    } else if (!st.gotPlaybook) {
      playbookNote('The agent finished without a playbook. The map data still works.', true);
      if (!st.market) await fallbackAnalyze(concept, city, my, signal);
    }
  }

  async function run(concept, city, brief) {
    brief = (brief || '').trim().slice(0, 240);
    last = { concept, city, brief };
    isExample = false;
    exSlug = null;
    const t0 = Date.now();
    const my = begin(concept, city, brief);
    toAgent();
    const signal = ctl.signal;
    const st = { market: null, gotPlaybook: false, errored: null };
    const handle = makeHandler(my, st);
    const sc = new AbortController();
    signal.addEventListener('abort', () => sc.abort());
    let timedOut = null;
    const stop = (why) => { timedOut = why; sc.abort(); };
    let stallT = setTimeout(() => stop('stall'), STALL_MS);
    const totalT = setTimeout(() => stop('total'), TOTAL_MS);
    try {
      const params = { concept, city };
      if (brief) params.brief = brief;
      const r = await fetch('/api/agent?' + new URLSearchParams(params), { signal: sc.signal });
      if (!r.body) throw new Error('Streaming is not supported in this browser.');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const line = (s) => {
        s = s.trim();
        if (!s) return;
        let ev;
        try { ev = JSON.parse(s); } catch { return; /* ignore bad line */ }
        handle(ev);
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        clearTimeout(stallT);
        stallT = setTimeout(() => stop('stall'), STALL_MS);
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
      buf += dec.decode();
      line(buf);
      if (my !== seq) { clearTimeout(stallT); clearTimeout(totalT); return; }
      if (!st.errored && !st.gotPlaybook && !r.ok) st.errored = { message: 'Something went wrong (' + r.status + '). Please try again.' };
    } catch (e) {
      if (my !== seq) { clearTimeout(stallT); clearTimeout(totalT); return; }
      if (timedOut) st.errored = { message: timedOut === 'stall' ? 'The agent stopped responding. Please try again.' : 'The agent took too long to finish. Please try again.' };
      else if (e.name === 'AbortError') return;
      else st.errored = { message: e.message === 'Failed to fetch' ? NET_MSG : e.message };
    }
    clearTimeout(stallT);
    clearTimeout(totalT);
    try {
      await settle(st, my, concept, city, signal, t0);
    } finally {
      if (my === seq) setBusy(false);
    }
  }

  // First load: replay a recorded agent run through the same handler. No API calls.
  async function replayExample(slug, fb, scroll) {
    slug = slug || 'austin-italian';
    isExample = true;
    exSlug = slug;
    last = fb || { concept: 'Italian restaurant', city: 'Austin', brief: 'cozy date-night spot for young couples' };
    $('concept').value = last.concept;
    $('city').value = last.city;
    $('brief').value = last.brief;
    const my = begin(last.concept, last.city, last.brief);
    $('agent-title').textContent = 'Replaying a recorded run';
    if (scroll) toAgent();
    const signal = ctl.signal;
    const st = { market: null, gotPlaybook: false, errored: null };
    try {
      const r = await fetch('/examples/' + encodeURIComponent(slug) + '.json', { signal });
      if (!r.ok) throw new Error('example unavailable');
      const ex = await r.json();
      if (my !== seq) return;
      if (!ex || !Array.isArray(ex.events)) throw new Error('bad example');
      last = { concept: ex.concept, city: ex.city, brief: ex.brief || '' };
      $('concept').value = ex.concept;
      $('city').value = ex.city;
      $('brief').value = ex.brief || '';
      $('live').textContent = 'Showing a recorded example run for ' + ex.concept + ' in ' + ex.city + '.';
      const handle = makeHandler(my, st);
      const total = Math.max(1, ...ex.events.map((e) => +e.ms || 0));
      const scale = reduced ? 0 : 3000 / total;
      const t0 = Date.now();
      let failed = null;
      for (const ev of ex.events) {
        if (my !== seq) return;
        const wait = scale ? (+ev.ms || 0) * scale - (Date.now() - t0) : 0;
        if (wait > 0) await new Promise((res) => setTimeout(res, wait));
        if (my !== seq) return;
        try { handle(ev); } catch (e) { failed = e; break; }
      }
      if (failed) st.errored = { message: 'Could not display the example: ' + failed.message };
      showExampleNote(ex);
      setBusy(false);
      await settle(st, my, ex.concept, ex.city, signal, t0, total);
    } catch (e) {
      if (my !== seq || e.name === 'AbortError') return;
      if (fb) { exSlug = null; run(fb.concept, fb.city, fb.brief); return; } // recording missing: run live
      setBusy(false);
      showError('Could not load the example run. Use the search above to run the agent live.');
    }
  }

  function showExampleNote(ex) {
    const d = ex.recordedAt ? new Date(ex.recordedAt) : null;
    const when = d && !isNaN(d) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'earlier';
    const n = $('example-note');
    n.innerHTML = 'Example run · recorded ' + esc(when) + ' · <button type="button" class="linkbtn" id="run-live">Run it live</button>';
    n.hidden = false;
    $('run-live').addEventListener('click', () => run(ex.concept, ex.city, ex.brief || ''));
  }

  function qBadge(fromQloo) {
    return fromQloo ? '<span class="qmark">Qloo</span>' : '<span class="aimark">AI suggestion</span>';
  }

  function chipList(arr) {
    return (arr || []).map((x) => {
      const q = !!(x && x.fromQloo);
      const t = q ? 'Found in Qloo\'s data for this crowd' : 'Suggested by the AI, not found in Qloo\'s data';
      return '<li class="pchip ' + (q ? 'q' : 'ai') + '" tabindex="0" title="' + esc(t) + '" aria-label="' + esc((x && x.name) + '. ' + t) + '"><span>' + esc(x && x.name) + '</span>' + qBadge(q) + '</li>';
    }).join('');
  }

  function renderPlaybook(p) {
    const bz = p.bestZone;
    const list = (a) => (a || []).map((x) => '<li>' + esc(x) + '</li>').join('');
    let html = '<h2 class="pb-head">' + esc(p.headline) + '</h2>';
    if (bz) {
      const nb = bz.neighborhood, nr = bz.near || '';
      const title = nb ? nb : 'near ' + nr;
      const sub = nb && nr ? '<span class="best-sub">near ' + esc(nr) + '</span>' : '';
      html += '<button type="button" class="best" id="best-btn" aria-label="Fly the map to the best spot, number ' + esc(bz.rank) + ', ' + esc(nb ? nb + (nr ? ', near ' + nr : '') : 'near ' + nr) + '"><span class="num" aria-hidden="true">' + esc(bz.rank) + '</span><span><small>Best spot</small><b>#' + esc(bz.rank) + ' ' + esc(title) + '</b>' + sub + '</span><span class="go" aria-hidden="true">Show on map &rarr;</span></button>';
    }
    if (p.whyHere && p.whyHere.length) html += '<h4 class="pb-sub">Why here</h4><ul class="why">' + list(p.whyHere) + '</ul>';
    const sc = (p.sanityChecks || []).filter((x) => x && (x.noticed || x.decision)).slice(0, 3);
    if (sc.length) html += '<h4 class="pb-sub">What the agent double-checked</h4><ul class="checks">' + sc.map((x) => '<li>' + (x.noticed ? '<p><b>Noticed:</b> ' + esc(x.noticed) + '</p>' : '') + (x.decision ? '<p><b>Decided:</b> ' + esc(x.decision) + '</p>' : '') + '</li>').join('') + '</ul>';
    html += '<div class="pb-grid"><div><h4 class="pb-sub">Target customer</h4><p>' + esc(p.targetCustomer) + '</p></div><div><h4 class="pb-sub">Vibe</h4><p>' + esc(p.vibe) + '</p></div></div>';
    if (p.offerIdeas && p.offerIdeas.length) html += '<h4 class="pb-sub">Offer ideas</h4><ul class="why">' + list(p.offerIdeas) + '</ul>';
    if (p.playlist && p.playlist.length) html += '<h4 class="pb-sub">Playlist</h4><ul class="pchips">' + chipList(p.playlist) + '</ul>';
    if (p.partners && p.partners.length) html += '<h4 class="pb-sub">Partners</h4><ul class="pchips">' + chipList(p.partners) + '</ul>';
    html += '<p class="legend-note"><span class="qmark">Qloo</span> found in Qloo\'s data &nbsp; <span class="aimark">AI suggestion</span> the AI\'s idea, not from Qloo</p>';
    if (p.openingPitch) html += '<h4 class="pb-sub">Opening pitch</h4><blockquote class="pitch"><p id="pitch-text">' + esc(p.openingPitch) + '</p><button type="button" class="copy" id="copy-btn">Copy</button></blockquote>';
    const body = $('playbook').querySelector('.playbook-body');
    $('playbook').hidden = false;
    body.innerHTML = html;
    const bb = $('best-btn');
    if (bb) bb.addEventListener('click', () => flyTo(bz.rank, bz.lat, bz.lon));
    const cb = $('copy-btn');
    if (cb) cb.addEventListener('click', async () => {
      const text = p.openingPitch;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
        else throw new Error('no clipboard');
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch { /* ignore */ }
        ta.remove();
      }
      cb.textContent = 'Copied';
      cb.classList.add('ok');
      $('live').textContent = 'Opening pitch copied to clipboard.';
      setTimeout(() => { cb.textContent = 'Copy'; cb.classList.remove('ok'); }, 2000);
    });
    curPlaybook = p;
    renderCompareButton();
    $('live').textContent = 'Launch playbook ready: ' + p.headline;
  }

  // "Without Qloo" comparison. Example mode loads the recorded JSON; live mode calls /api/baseline.
  function renderCompareButton() {
    $('compare').innerHTML = '<button type="button" class="btn cmp-btn" id="cmp-btn">Compare with plain AI (no Qloo)</button><p class="hint cmp-hint">See what the same model picks without Qloo\'s taste data.</p>';
    $('cmp-btn').addEventListener('click', loadCompare);
  }

  function cmpError(msg) {
    $('compare').innerHTML = '<div class="errbox"><p>' + esc(msg) + '</p><button class="btn" id="cmp-retry" type="button">Try again</button></div>';
    $('cmp-retry').addEventListener('click', loadCompare);
  }

  async function loadCompare() {
    const my = seq;
    if (cmpCtl) cmpCtl.abort();
    cmpCtl = new AbortController();
    const signal = cmpCtl.signal;
    const c = last || {};
    $('compare').innerHTML = '<div class="cmp-wait"><div class="spinner" aria-hidden="true"></div><p>Asking a plain AI without Qloo…</p></div>';
    $('live').textContent = 'Asking a plain AI without Qloo…';
    try {
      let result;
      if (isExample) {
        const r = await fetch('/examples/' + encodeURIComponent(exSlug || 'austin-italian') + '-baseline.json', { signal });
        if (!r.ok) throw new Error('Could not load the recorded comparison.');
        const ex = await r.json();
        result = ex && ex.result;
      } else {
        const params = { concept: c.concept, city: c.city };
        if (c.brief) params.brief = c.brief;
        const r = await fetch('/api/baseline?' + new URLSearchParams(params), { signal });
        let data = null;
        try { data = await r.json(); } catch { /* non-JSON */ }
        if (!r.ok || !data || data.error) throw new Error((data && data.error) || 'Something went wrong (' + r.status + '). Please try again.');
        result = data;
      }
      if (my !== seq) return;
      if (!result || !result.score) throw new Error('The comparison came back incomplete. Please try again.');
      renderCompare(result, curPlaybook, isExample);
    } catch (e) {
      if (my !== seq || e.name === 'AbortError') return;
      const m = e.message === 'Failed to fetch' ? NET_MSG : e.message;
      cmpError(m);
      $('live').textContent = 'Comparison failed: ' + m;
    }
  }

  function cmpChips(arr) {
    return (arr || []).map((x) => {
      const q = !!(x && x.inQloo);
      const t = "Not among Qloo's top results for this audience";
      return '<li class="pchip ' + (q ? 'q' : 'nq') + '" tabindex="0"' + (q ? '' : ' title="' + esc(t) + '"') + ' aria-label="' + esc((x && x.name) + '. ' + (q ? 'In Qloo data' : t)) + '"><span>' + esc(x && x.name) + '</span>' + (q ? '<span class="qmark">in Qloo data</span>' : '') + '</li>';
    }).join('');
  }

  const nOk = (n) => typeof n === 'number' && isFinite(n);
  const liftTxt = (pts) => nOk(pts) ? 'Taste lift ' + fmtSigned(pts, 0) : 'Taste lift n/a';
  function ourZone() {
    const z = (curMarket && curMarket.zones) || [];
    const r = curPlaybook && curPlaybook.bestZone && curPlaybook.bestZone.rank;
    return z.find((q) => q.rank === r) || z[0] || null;
  }
  function locSummary(loc) {
    if (!loc) return '';
    return loc.found ? ' Plain AI picked ' + loc.name + ', ' + liftTxt(loc.liftPoints).toLowerCase() + ' points.' : ' The plain AI pick could not be placed on the map.';
  }
  function locationRow(loc) {
    if (!loc || !loc.name) return '';
    const city = (curMarket && curMarket.city) || (last && last.city) || 'the city';
    if (!loc.found) return '<p class="loc-miss">We couldn\'t place \'' + esc(loc.name) + '\' inside ' + esc(city) + ' on the map, so it can\'t be measured.</p>';
    const topN = curMarket && (curMarket.competitors || []).length;
    const comp = (n, of) => typeof n === 'number' ? ' \u00b7 ' + n + ' of ' + (of || 'the top') + (of ? '' : '') + ' ' + (of ? 'top competitors' : 'competitors') + ' within 1 km' : '';
    const z = ourZone();
    const ours = z ? '<b>' + esc(placeName(z)) + '</b><span class="loc-m">' + esc(liftTxt(+(z.lift * 100))) + comp(z.competitorsWithin1km, topN) + '</span>' : '<b>n/a</b>';
    const agree = nOk(loc.agreesWithZone) ? '<p class="loc-note">Plain AI\'s pick sits next to our #' + esc(loc.agreesWithZone) + ' spot.</p>' : '';
    return '<div class="loc-row"><div class="loc-side plain"><small>Plain AI\'s pick</small><b>' + esc(loc.name) + '</b><span class="loc-m">' + esc(liftTxt(loc.liftPoints)) + comp(loc.competitorsWithin1km, loc.competitorSample) + '</span></div>' +
      '<div class="loc-side qloo"><small>Open Here\'s best zone</small>' + ours + '</div></div>' + agree;
  }
  function clearAiPin() {
    if (aiPin) { aiPin.remove(); aiPin = null; }
    const lg = $('lg-ai'); if (lg) lg.hidden = true;
  }
  function showAiPin(loc) {
    clearAiPin();
    if (!loc || !loc.found || !nOk(loc.lat) || !nOk(loc.lon)) return;
    const icon = L.divIcon({ className: 'zone-icon', html: '<div class="aipin">AI</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
    aiPin = L.marker([loc.lat, loc.lon], { icon, zIndexOffset: 500, title: 'Plain AI pick: ' + loc.name })
      .bindPopup('<b>Plain AI\'s pick: ' + esc(loc.name) + '</b><br>' + esc(liftTxt(loc.liftPoints)) + (nOk(loc.liftPoints) ? ' pts' : '')).addTo(map);
    $('lg-ai').hidden = false;
    const pts = [[loc.lat, loc.lon]];
    ((curMarket && curMarket.zones) || []).forEach((z) => pts.push([z.lat, z.lon]));
    if (pts.length > 1 && !map.getBounds().contains([loc.lat, loc.lon])) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [60, 60], paddingBottomRight: [40, 40], maxZoom: 14 });
  }

  function renderCompare(b, p, example) {
    p = p || {};
    const pl = p.playlist || [], pp = p.partners || [];
    const bz = p.bestZone;
    const locRow = locationRow(b.location);
    const sect = (t, body) => body ? '<h5 class="pb-sub">' + t + '</h5>' + body : '';
    const chips = (html) => html ? '<ul class="pchips">' + html + '</ul>' : '';
    const html = '<section class="cmp" aria-labelledby="cmp-h">' +
      '<h3 id="cmp-h" class="sec">What Qloo knows that a plain AI doesn\'t</h3>' + locRow +
      '<div class="cmp-cols">' +
      '<div class="cmp-col plain"><h4 class="cmp-title">Plain AI · no Qloo data</h4>' +
        sect('Neighborhood', b.neighborhood ? '<p>' + esc(b.neighborhood) + '</p>' : '') +
        sect('Playlist', chips(cmpChips(b.playlist))) +
        sect('Partners', chips(cmpChips(b.partners))) +
        sect('Why here', b.whyHere ? '<p>' + esc(b.whyHere) + '</p>' : '') +
        sect('Target customer', b.targetCustomer ? '<p>' + esc(b.targetCustomer) + '</p>' : '') +
      '</div>' +
      '<div class="cmp-col qloo"><h4 class="cmp-title">Open Here · with Qloo</h4>' +
        sect('Neighborhood', bz ? (bz.neighborhood ? '<p>' + esc(bz.neighborhood) + (bz.near ? '<br><small class="cmp-near">near ' + esc(bz.near) + '</small>' : '') + '</p>' : '<p>#' + esc(bz.rank) + ' near ' + esc(bz.near) + '</p>') : '') +
        sect('Playlist', chips(chipList(pl))) +
        sect('Partners', chips(chipList(pp))) +
        sect('Why here', (p.whyHere && p.whyHere.length) ? '<ul class="why">' + p.whyHere.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
        sect('Target customer', p.targetCustomer ? '<p>' + esc(p.targetCustomer) + '</p>' : '') +
      '</div></div>' +
      '<p class="cmp-cap">Same model, same brief. Both picks are scored on the same Qloo map, but only Open Here got to see that map before choosing.' + (example ? ' This is a recorded example.' : '') + '</p>' +
      '</section>';
    $('compare').innerHTML = html;
    $('results').classList.add('wide');
    setTimeout(() => map.invalidateSize(), 50);
    $('live').textContent = 'Comparison ready.' + locSummary(b.location);
    showAiPin(b.location);
    const sec = $('compare').querySelector('.cmp');
    if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }

  function flyTo(rank, lat, lon) {
    highlight(rank);
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (reduced) map.setView([lat, lon], 15); else map.flyTo([lat, lon], 15, { duration: 1.1 });
    map.once('moveend', () => zoneMarkers[rank] && zoneMarkers[rank].openPopup());
    if (matchMedia('(max-width:899px)').matches) $('map').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }

  const COMP_STYLE = { radius: 4.5, color: '#fff', weight: 1.5, fillColor: '#2f5d4a', fillOpacity: 0.85 };
  const COMP_ACTIVE = { radius: 9, color: '#fff', weight: 3, fillColor: '#c8502d', fillOpacity: 1 };
  let compMarkers = [];
  let activeComp = -1;

  // Links a competitor's list row and map pin. From the list it flies the
  // map there; from the map it reveals the row in the list.
  function selectComp(i, fromMap) {
    const m = compMarkers[i];
    if (!m) return;
    if (compMarkers[activeComp]) compMarkers[activeComp].setStyle(COMP_STYLE);
    activeComp = i;
    m.setStyle(COMP_ACTIVE).bringToFront();
    document.querySelectorAll('.comp-item').forEach((el) => el.setAttribute('aria-pressed', String(+el.dataset.i === i)));
    const row = document.querySelector('.comp-item[data-i="' + i + '"]');
    if (fromMap) {
      $('comp').open = true;
      if (row) row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
      return;
    }
    const ll = m.getLatLng();
    if (reduced) map.setView(ll, 16); else map.flyTo(ll, 16, { duration: 1 });
    map.once('moveend', () => m.openPopup());
    if (matchMedia('(max-width:899px)').matches) $('map').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }

  function drawMap(d) {
    layers.remove();
    layers = L.layerGroup().addTo(map);
    zoneMarkers = [];
    const pts = [];
    heat = null;
    if (d.heatmap && d.heatmap.length) {
      heat = L.heatLayer(d.heatmap.map((p) => [p.lat, p.lon, p.intensity]), {
        radius: 28, blur: 24, maxZoom: 14, minOpacity: 0.25,
        gradient: { 0.2: '#f6dc8f', 0.5: '#eaa23a', 0.8: '#d9532b', 1: '#8e2a14' }
      }).addTo(layers);
      if (heat._canvas) heat._canvas.style.transition = reduced ? 'none' : 'opacity .2s';
    }
    compMarkers = [];
    activeComp = -1;
    (d.competitors || []).forEach((c, i) => {
      const m = L.circleMarker([c.lat, c.lon], COMP_STYLE)
        .bindPopup('<b>' + esc(c.name) + '</b><br>' + esc(c.address || '')).addTo(layers);
      m.on('click', () => selectComp(i, true));
      compMarkers.push(m);
      pts.push([c.lat, c.lon]);
    });
    (d.zones || []).forEach((z) => {
      const icon = L.divIcon({ className: 'zone-icon', html: '<div class="zpin">' + z.rank + '</div>', iconSize: [38, 38], iconAnchor: [19, 19] });
      const m = L.marker([z.lat, z.lon], { icon, zIndexOffset: 1000, title: 'Zone ' + z.rank + ': ' + placeName(z) })
        .bindPopup('<b>#' + z.rank + ' ' + esc(placeName(z)) + '</b><br>' + (z.neighborhood && z.landmark && z.landmark.name ? esc('near ' + z.landmark.name) + '<br>' : '') + esc(z.landmark ? z.landmark.address : '') + '<br><span title="How much more people here like your kind of place than the area\'s overall popularity would suggest">Taste lift ' + lp(z.lift) + ' pts</span>').addTo(layers);
      m.on('click', () => highlight(z.rank));
      zoneMarkers[z.rank] = m;
      pts.push([z.lat, z.lon]);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [60, 60], paddingBottomRight: [40, 40], maxZoom: 14 });
    setTimeout(() => map.invalidateSize(), 50);
  }

  function highlight(rank) {
    document.querySelectorAll('.zone').forEach((el) => el.classList.toggle('active', +el.dataset.rank === rank));
    zoneMarkers.forEach((m, i) => { const el = m && m.getElement && m.getElement(); if (el) el.classList.toggle('hl', i === rank); });
    const card = document.querySelector('.zone[data-rank="' + rank + '"]');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }

  function renderAudience(a) {
    const age = (a && a.demographics && a.demographics.age) || {};
    const gen = (a && a.demographics && a.demographics.gender) || {};
    const keys = Object.keys(AGE).filter((k) => typeof age[k] === 'number');
    let html = '';
    if (keys.length) {
      const max = Math.max(0.1, ...keys.map((k) => Math.abs(age[k])));
      html += '<p class="dvcap">How much each age group likes this kind of place, compared with average. Not the share of your customers.</p><div class="dv" role="img" aria-label="How much each age group likes this kind of place compared with average, according to Qloo. Not the share of customers.">' + keys.map((k) => {
        const v = age[k];
        const w = Math.min(50, (Math.abs(v) / max) * 50);
        return '<div class="dvrow"><span>' + AGE[k] + '</span><div class="dvtrack"><i class="' + (v >= 0 ? 'pos' : 'neg') + '" style="width:' + w + '%"></i></div></div>';
      }).join('') + '</div><div class="dvaxis"><span>Less than average</span><span>More</span></div>';
      const top = keys.filter((k) => age[k] > 0.05).sort((x, y) => age[y] - age[x]).slice(0, 2).map((k) => AGE[k].toLowerCase());
      const f = gen.female || 0;
      const gtxt = Math.abs(f) < 0.05 ? 'men and women about equally' : (f > 0 ? 'women a bit more than men' : 'men a bit more than women');
      html += '<p class="plain">' + (top.length ? 'People aged <b>' + esc(top.join(' and ')) + '</b> like this kind of place the most, ' + gtxt + '.' : 'It appeals to <b>' + gtxt + '</b>.') + '</p>';
    }
    if (typeof gen.female === 'number') {
      const f = gen.female;
      let gl;
      if (Math.abs(f) < 0.05) gl = 'Balanced';
      else if (f > 0) gl = 'Leans female (' + fmtSigned(f, 2) + ' affinity)';
      else gl = 'Leans male (' + fmtSigned(typeof gen.male === 'number' ? gen.male : -f, 2) + ' affinity)';
      html += '<p class="gender-line"><b>Gender:</b> ' + esc(gl) + '</p>';
    }
    $('audience').innerHTML = html || '<p class="hint">No audience data for this search.</p>';
  }

  function renderLove(a) {
    const g = (title, arr) => arr && arr.length ? '<div class="group"><h4>' + title + '</h4><div class="tags">' + arr.slice(0, 10).map((x) => '<span>' + esc(x) + '</span>').join('') + '</div></div>' : '';
    $('love').innerHTML = g('Music', a.artists) + g('Films', a.movies) + g('Brands', a.brands) || '<p class="hint">No cross-domain taste data for this search.</p>';
  }

  function render(d) {
    curMarket = d;
    clearAiPin();
    $('status').innerHTML = '';
    $('maploading').hidden = true;
    $('content').hidden = false;
    $('headline').textContent = 'Top spots for ' + d.concept + ' in ' + d.city;
    const pl = $('place');
    const tagName = d.tag && d.tag.name;
    const showTag = !!tagName && norm(tagName) !== norm(d.concept);
    let ph = '';
    if (d.place) ph += 'Qloo matched: <b>' + esc(d.place) + '</b> <span class="place-hint">Wrong place? Add the state or country, e.g. \'Springfield, Illinois\'.</span>';
    if (showTag) ph += '<span class="place-hint">Matched as: <b>' + esc(tagName) + '</b>. Qloo has no exact category for \'' + esc(d.concept) + '\', so we used the closest one.</span>';
    pl.innerHTML = ph;
    pl.hidden = !ph;
    drawMap(d);
    const zones = d.zones || [];
    $('empty').hidden = zones.length > 0;
    $('lowsignal').hidden = !(d.lowSignal && zones.length);
    $('empty').hidden = zones.length > 0;
    const maxLift = Math.max(0.0001, ...zones.map((z) => z.lift));
    const topN = (d.competitors || []).length;
    const compTip = ' title="Based on Qloo\'s ' + topN + ' most popular matching places. Smaller spots may not be counted."';
    const counts = zones.map((z) => z.competitorsWithin1km);
    const uniform = zones.length > 0 && counts.every((n) => typeof n === 'number' && n === counts[0]);
    const zs = $('zonestat');
    if (uniform && topN) {
      const n0 = counts[0];
      zs.textContent = n0 === 0 ? 'None of the top ' + topN + ' popular matching places sit within 1 km of these spots.' : 'Each of these spots has ' + n0 + ' of the top ' + topN + ' popular matching places within 1 km.';
    }
    zs.hidden = !(uniform && topN);
    $('zones').innerHTML = zones.map((z) => {
      const n = z.competitorsWithin1km;
      const badge = uniform && topN ? '' : typeof n !== 'number' ? '' : n === 0 ? '<span class="badge"' + compTip + '>None of the top ' + topN + ' within 1 km</span>' : '<span class="badge busy"' + compTip + '>' + n + ' of the top ' + topN + ' within 1 km</span>';
      const sub = placeSub(z, d.city);
      return '<li><button type="button" class="zone" data-rank="' + z.rank + '" aria-label="Zone ' + z.rank + ', ' + esc(placeName(z)) + (sub ? ', ' + esc(sub) : '') + '. Fly to zone on map">' +
        '<span class="num" aria-hidden="true">' + z.rank + '</span><span><div class="zname">' + esc(placeName(z)) + '</div>' +
        '<div class="zsub">' + esc(sub) + '</div>' + badge +
        '<div class="liftrow" title="How much more people here like your kind of place than the area\'s overall popularity would suggest"><span>Taste lift</span><span class="bar"><i style="width:' + Math.round((z.lift / maxLift) * 100) + '%"></i></span><span>' + lp(z.lift) + ' pts</span></div></span></button></li>';
    }).join('');
    document.querySelectorAll('.zone').forEach((el) => el.addEventListener('click', () => {
      const z = zones.find((q) => q.rank === +el.dataset.rank);
      flyTo(z.rank, z.lat, z.lon);
    }));
    renderAudience(d.audience || {});
    renderLove(d.audience || {});
    const comps = d.competitors || [];
    $('comp-sum').textContent = 'Top ' + comps.length + ' most popular in ' + d.city + ' · tap one to see it on the map';
    $('comp-list').innerHTML = comps.map((c, i) => '<li><button type="button" class="comp-item" data-i="' + i + '" aria-pressed="false" aria-label="' + esc(c.name) + ', show on map">' + esc(c.name) + '<small>' + esc(c.address || '') + '</small></button></li>').join('');
    $('comp-list').querySelectorAll('.comp-item').forEach((el) => el.addEventListener('click', () => selectComp(+el.dataset.i, false)));
    $('live').textContent = zones.length ? 'Found ' + zones.length + ' top spots for ' + d.concept + ' in ' + d.city + '.' : 'No standout zones found.';
    $('results').scrollTop = 0;
  }

  function submit() {
    const concept = $('concept').value.trim();
    const city = $('city').value.trim();
    $('concept-err').textContent = concept ? '' : 'Tell us what you want to open.';
    $('city-err').textContent = city ? '' : 'Which city?';
    $('concept').setAttribute('aria-invalid', String(!concept));
    $('city').setAttribute('aria-invalid', String(!city));
    if (!concept) return $('concept').focus();
    if (!city) return $('city').focus();
    run(concept, city, $('brief').value);
  }

  $('search').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.slug) {
      replayExample(b.dataset.slug, { concept: b.dataset.concept, city: b.dataset.city, brief: b.dataset.brief || '' }, true);
      return;
    }
    $('concept').value = b.dataset.concept;
    $('city').value = b.dataset.city;
    $('brief').value = b.dataset.brief || '';
    submit();
  }));

  replayExample('austin-italian');
})();
