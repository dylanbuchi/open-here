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
  let seq = 0;
  let last = null;

  function street(address, city) {
    if (!address) return '';
    const i = address.toLowerCase().lastIndexOf(' ' + city.toLowerCase());
    let s = i > 0 ? address.slice(0, i) : address.split(',')[0];
    return s.trim();
  }

  function setBusy(b) {
    $('maploading').hidden = !b;
    $('go').disabled = b;
    $('go').textContent = b ? 'Reading…' : 'Find my spot';
  }

  let ctl = null;
  let market = null;

  function showError(msg) {
    $('content').hidden = true;
    $('status').innerHTML = '<div class="errbox"><p>' + esc(msg) + '</p><button class="btn" id="retry" type="button">Try again</button></div>';
    $('retry').addEventListener('click', () => last && run(last.concept, last.city, last.brief));
    $('live').textContent = 'Error: ' + msg;
  }

  function resetResults() {
    market = null;
    $('content').hidden = true;
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

  function finishTrace(t0) {
    const ol = $('agent-steps');
    ol.querySelectorAll('li.current').forEach((li) => { li.classList.remove('current'); li.classList.add('ok'); });
    const n = ol.children.length;
    $('agent').classList.add('done');
    $('agent-title').textContent = n ? 'Agent took ' + n + ' step' + (n === 1 ? '' : 's') + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's' : 'Agent finished';
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

  async function run(concept, city, brief) {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const signal = ctl.signal;
    const my = ++seq;
    brief = (brief || '').trim().slice(0, 240);
    last = { concept, city, brief };
    const t0 = Date.now();
    setBusy(true);
    resetResults();
    $('live').textContent = 'The agent is analyzing ' + concept + ' in ' + city + '…';
    let gotPlaybook = false;
    let errored = null;
    const handle = (ev) => {
      if (my !== seq || !ev || typeof ev !== 'object') return;
      if (ev.type === 'step') addStep(ev.label || 'Working…');
      else if (ev.type === 'market' && ev.data) { market = ev.data; render(ev.data); }
      else if (ev.type === 'playbook' && ev.data) { gotPlaybook = true; renderPlaybook(ev.data); }
      else if (ev.type === 'error') errored = ev;
    };
    try {
      const params = { concept, city };
      if (brief) params.brief = brief;
      const r = await fetch('/api/agent?' + new URLSearchParams(params), { signal });
      if (!r.body) throw new Error('Streaming is not supported in this browser.');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      const line = (s) => { s = s.trim(); if (!s) return; try { handle(JSON.parse(s)); } catch { /* ignore bad line */ } };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
      buf += dec.decode();
      line(buf);
      if (my !== seq) return;
      if (!errored && !gotPlaybook && !r.ok) errored = { message: 'Something went wrong (' + r.status + '). Please try again.' };
    } catch (e) {
      if (my !== seq || e.name === 'AbortError') return;
      errored = { message: e.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : e.message };
    }
    if (my !== seq) return;
    finishTrace(t0);
    if (errored && !gotPlaybook) {
      if (errored.code === 'budget') playbookNote('The AI agent is resting for today, but the map data still works. Explore the top spots below.', true);
      else playbookNote(errored.message || 'The agent could not finish. The map data still works.', true);
      if (!market) await fallbackAnalyze(concept, city, my, signal);
    } else if (!gotPlaybook) {
      playbookNote('The agent finished without a playbook. The map data still works.', true);
      if (!market) await fallbackAnalyze(concept, city, my, signal);
    }
    if (my === seq) setBusy(false);
  }

  function qBadge(fromQloo) {
    return fromQloo ? '<span class="qmark">Qloo</span>' : '<span class="aimark">AI suggestion</span>';
  }

  function chipList(arr) {
    return (arr || []).map((x) => {
      const q = !!(x && x.fromQloo);
      const t = q ? "Verified in Qloo's taste data" : 'Suggested by the AI, not found in Qloo data';
      return '<li class="pchip ' + (q ? 'q' : 'ai') + '" tabindex="0" title="' + esc(t) + '" aria-label="' + esc((x && x.name) + '. ' + t) + '"><span>' + esc(x && x.name) + '</span>' + qBadge(q) + '</li>';
    }).join('');
  }

  function renderPlaybook(p) {
    const bz = p.bestZone;
    const list = (a) => (a || []).map((x) => '<li>' + esc(x) + '</li>').join('');
    let html = '<h2 class="pb-head">' + esc(p.headline) + '</h2>';
    if (bz) html += '<button type="button" class="best" id="best-btn" aria-label="Fly the map to the best spot, number ' + esc(bz.rank) + ' near ' + esc(bz.near) + '"><span class="num" aria-hidden="true">' + esc(bz.rank) + '</span><span><small>Best spot</small><b>#' + esc(bz.rank) + ' near ' + esc(bz.near) + '</b></span><span class="go" aria-hidden="true">Show on map &rarr;</span></button>';
    if (p.whyHere && p.whyHere.length) html += '<h4 class="pb-sub">Why here</h4><ul class="why">' + list(p.whyHere) + '</ul>';
    html += '<div class="pb-grid"><div><h4 class="pb-sub">Target customer</h4><p>' + esc(p.targetCustomer) + '</p></div><div><h4 class="pb-sub">Vibe</h4><p>' + esc(p.vibe) + '</p></div></div>';
    if (p.offerIdeas && p.offerIdeas.length) html += '<h4 class="pb-sub">Offer ideas</h4><ul class="why">' + list(p.offerIdeas) + '</ul>';
    if (p.playlist && p.playlist.length) html += '<h4 class="pb-sub">Playlist</h4><ul class="pchips">' + chipList(p.playlist) + '</ul>';
    if (p.partners && p.partners.length) html += '<h4 class="pb-sub">Partners</h4><ul class="pchips">' + chipList(p.partners) + '</ul>';
    html += '<p class="legend-note"><span class="qmark">Qloo</span> verified in Qloo\'s taste data &nbsp; <span class="aimark">AI suggestion</span> not in Qloo data</p>';
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
    $('live').textContent = 'Launch playbook ready: ' + p.headline;
  }

  function flyTo(rank, lat, lon) {
    highlight(rank);
    if (typeof lat !== 'number' || typeof lon !== 'number') return;
    if (reduced) map.setView([lat, lon], 15); else map.flyTo([lat, lon], 15, { duration: 1.1 });
    map.once('moveend', () => zoneMarkers[rank] && zoneMarkers[rank].openPopup());
    if (matchMedia('(max-width:899px)').matches) $('map').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  }

  function drawMap(d) {
    layers.remove();
    layers = L.layerGroup().addTo(map);
    zoneMarkers = [];
    const pts = [];
    if (d.heatmap && d.heatmap.length) {
      L.heatLayer(d.heatmap.map((p) => [p.lat, p.lon, p.intensity]), {
        radius: 28, blur: 24, maxZoom: 14, minOpacity: 0.25,
        gradient: { 0.2: '#f6dc8f', 0.5: '#eaa23a', 0.8: '#d9532b', 1: '#8e2a14' }
      }).addTo(layers);
    }
    (d.competitors || []).forEach((c) => {
      L.circleMarker([c.lat, c.lon], { radius: 4.5, color: '#fff', weight: 1.5, fillColor: '#2f5d4a', fillOpacity: 0.85 })
        .bindPopup('<b>' + esc(c.name) + '</b><br>' + esc(c.address || '')).addTo(layers);
      pts.push([c.lat, c.lon]);
    });
    (d.zones || []).forEach((z) => {
      const icon = L.divIcon({ className: 'zone-icon', html: '<div class="zpin">' + z.rank + '</div>', iconSize: [38, 38], iconAnchor: [19, 19] });
      const m = L.marker([z.lat, z.lon], { icon, zIndexOffset: 1000, title: 'Zone ' + z.rank + ': near ' + (z.landmark ? z.landmark.name : '') })
        .bindPopup('<b>#' + z.rank + ' Near ' + esc(z.landmark ? z.landmark.name : 'this spot') + '</b><br>' + esc(z.landmark ? z.landmark.address : '')).addTo(layers);
      m.on('click', () => highlight(z.rank));
      zoneMarkers[z.rank] = m;
      pts.push([z.lat, z.lon]);
    });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 14 });
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
      html += '<div class="dv" role="img" aria-label="Age skew, over or under average">' + keys.map((k) => {
        const v = age[k];
        const w = Math.min(50, (Math.abs(v) / max) * 50);
        return '<div class="dvrow"><span>' + AGE[k] + '</span><div class="dvtrack"><i class="' + (v >= 0 ? 'pos' : 'neg') + '" style="width:' + w + '%"></i></div></div>';
      }).join('') + '</div><div class="dvaxis"><span>Fewer than average</span><span>More</span></div>';
      const top = keys.filter((k) => age[k] > 0.05).sort((x, y) => age[y] - age[x]).slice(0, 2).map((k) => AGE[k].toLowerCase());
      const f = gen.female || 0;
      const gtxt = Math.abs(f) < 0.05 ? 'an even gender mix' : (f > 0 ? 'women more than average' : 'men more than average');
      html += '<p class="plain">' + (top.length ? 'Your crowd over-indexes at <b>' + esc(top.join(' and ')) + '</b> and skews toward <b>' + gtxt + '</b>.' : 'Your crowd has <b>' + gtxt + '</b>.') + '</p>';
    }
    if (typeof gen.female === 'number' && typeof gen.male === 'number') {
      const fp = Math.round(50 + (gen.female - gen.male) * 25);
      const f = Math.min(80, Math.max(20, fp));
      html += '<div class="gender" role="img" aria-label="Gender skew: ' + f + ' percent women-leaning, ' + (100 - f) + ' percent men-leaning"><span class="g-f" style="width:' + f + '%">Women</span><span class="g-m" style="width:' + (100 - f) + '%">Men</span></div>';
    }
    $('audience').innerHTML = html || '<p class="hint">No audience data for this search.</p>';
  }

  function renderLove(a) {
    const g = (title, arr) => arr && arr.length ? '<div class="group"><h4>' + title + '</h4><div class="tags">' + arr.slice(0, 10).map((x) => '<span>' + esc(x) + '</span>').join('') + '</div></div>' : '';
    $('love').innerHTML = g('Music', a.artists) + g('Films', a.movies) + g('Brands', a.brands) || '<p class="hint">No cross-domain taste data for this search.</p>';
  }

  function render(d) {
    $('status').innerHTML = '';
    $('maploading').hidden = true;
    $('content').hidden = false;
    $('headline').textContent = 'Top spots for ' + d.concept + ' in ' + d.city;
    drawMap(d);
    const zones = d.zones || [];
    $('empty').hidden = zones.length > 0;
    const maxLift = Math.max(0.0001, ...zones.map((z) => z.lift));
    $('zones').innerHTML = zones.map((z) => {
      const n = z.competitorsWithin1km;
      const badge = n === 0 ? '<span class="badge">Open field: 0 competitors within 1 km</span>' : '<span class="badge busy">' + n + ' competitor' + (n === 1 ? '' : 's') + ' within 1 km</span>';
      const lm = z.landmark || {};
      return '<li><button type="button" class="zone" data-rank="' + z.rank + '" aria-label="Zone ' + z.rank + ', near ' + esc(lm.name || 'this spot') + '. Fly to zone on map">' +
        '<span class="num" aria-hidden="true">' + z.rank + '</span><span><div class="zname">Near ' + esc(lm.name || 'this spot') + '</div>' +
        '<div class="zsub">' + esc(street(lm.address, d.city)) + '</div>' + badge +
        '<div class="liftrow"><span>Taste lift</span><span class="bar"><i style="width:' + Math.round((z.lift / maxLift) * 100) + '%"></i></span><span>+' + Math.round(z.lift * 100) + '</span></div></span></button></li>';
    }).join('');
    document.querySelectorAll('.zone').forEach((el) => el.addEventListener('click', () => {
      const z = zones.find((q) => q.rank === +el.dataset.rank);
      flyTo(z.rank, z.lat, z.lon);
    }));
    renderAudience(d.audience || {});
    renderLove(d.audience || {});
    const comps = d.competitors || [];
    $('comp-sum').textContent = comps.length + ' existing ' + d.concept + ' place' + (comps.length === 1 ? '' : 's') + ' mapped';
    $('comp-list').innerHTML = comps.map((c) => '<li>' + esc(c.name) + '<small>' + esc(c.address || '') + '</small></li>').join('');
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
    $('concept').value = b.dataset.concept;
    $('city').value = b.dataset.city;
    $('brief').value = b.dataset.brief || '';
    submit();
  }));

  $('brief').value = 'cozy date-night spot for young couples';
  run('Italian restaurant', 'Austin', $('brief').value);
})();
