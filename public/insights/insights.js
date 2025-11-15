// public/insights/insights.js
(function(){
  const $  = (s, ctx=document) => ctx.querySelector(s);
  const $$ = (s, ctx=document) => Array.from(ctx.querySelectorAll(s));

  // ---------------------------
  // PriceAlert (unchanged)
  // ---------------------------
  function toCents(x){
    const n = parseFloat(String(x).trim());
    if (Number.isNaN(n) || n <= 0) return null;
    return Math.round(n * 100);
  }

  async function saveAlert(){
    const recipient = $('#alertEmail')?.value.trim();
    const query     = $('#alertQuery')?.value.trim();
    const cents     = toCents($('#alertTarget')?.value);
    const out       = $('#alertResult');

    if(!recipient || !query || cents == null){
      if(out) out.textContent = 'Fill email or phone, product or UPC, and a valid target price.';
      return;
    }

    const body = {
      channel: recipient.includes('@') ? 'email' : 'sms',
      recipient,
      query,
      target_price_cents: cents,
      page_url: location.href,
      created_client_at: new Date().toISOString()
    };

    try{
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      });
      const j = await res.json().catch(()=> ({}));
      if(!res.ok){
        if(out) out.textContent = `Save failed: ${j.error || res.status}`;
        return;
      }
      if(out) out.textContent = 'Saved.';
    }catch(err){
      console.error(err);
      if(out) out.textContent = 'Save failed: network error.';
    }
  }

  document.addEventListener('click', (e)=>{
    if(e.target && e.target.id === 'saveAlert') saveAlert();
  });

  // ---------------------------
  // Library loader
  // ---------------------------
  const state = {
    topic: 'all',
    type: 'all',
    q: '',
    posts: []
  };

  const params = new URLSearchParams(location.search);
  state.topic = params.get('topic') || 'all';
  state.type  = params.get('type')  || 'all';
  state.q     = params.get('q')     || '';

  const qInput   = $('#q');
  const rangeSel = $('#range');
  if(qInput) qInput.value = state.q;

  function updateURL(){
    const p = new URLSearchParams();
    if(state.topic !== 'all') p.set('topic', state.topic);
    if(state.type  !== 'all') p.set('type', state.type);
    if(state.q) p.set('q', state.q);
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  // Topic pills
  const topicBtns = $$('.topic');
  function setTopic(t){
    state.topic = t; updateURL();
    topicBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.topic===t ? 'true' : 'false'));
    renderLibrary();
    filterTables();
  }
  topicBtns.forEach(b => b.addEventListener('click', ()=> setTopic(b.dataset.topic)));

  // Type pills
  const typeBtns = $$('.type-pill');
  function setType(t){
    state.type = t; updateURL();
    typeBtns.forEach(b => b.setAttribute('aria-pressed', b.dataset.type===t ? 'true' : 'false'));
    renderLibrary();
  }
  typeBtns.forEach(b => b.addEventListener('click', ()=> setType(b.dataset.type)));

  // Search
  if(qInput){
    qInput.addEventListener('input', ()=>{
      state.q = qInput.value.trim();
      updateURL();
      renderLibrary();
      filterTables();
    });
  }
  if(rangeSel){
    rangeSel.addEventListener('change', ()=>{
      // Placeholder for future feed hookup
      // Keeps your existing UI stable
    });
  }

  // Populate KPI tables filter by topic/q (your existing DOM)
  function filterTables(){
    const term = (state.q || '').toLowerCase();
    ['#buywait','#doorbuster'].forEach(id => {
      $$(id+' tbody tr').forEach(tr => {
        const topicOk = state.topic==='all' || (tr.dataset.topic||'').toLowerCase().includes(state.topic);
        const text = tr.textContent.toLowerCase();
        const qOk = !term || text.includes(term);
        tr.style.display = (topicOk && qOk) ? '' : 'none';
      });
    });
  }

  // Load posts.json and render
  async function loadLibrary(){
    try{
      const res = await fetch('/api/insights/posts', { cache:'no-cache' });
      if(!res.ok) throw new Error('manifest load failed');
      state.posts = await res.json();
      renderLibrary();
    }catch(e){
      console.error(e);
      const grid = $('#libraryGrid');
      if(grid) grid.innerHTML = '<p class="ins-muted">Could not load library.</p>';
    }
  }

  function cardHTML(p){
    const metaParts = [];
    metaParts.push(p.type ? p.type.charAt(0).toUpperCase() + p.type.slice(1) : '');
    if (p.minutes) metaParts.push(`${p.minutes} min`);
    return `
      <article class="tile ci-post"
               data-type="${p.type || ''}"
               data-topic="${p.topic || ''}"
               role="button"
               tabindex="0"
               data-url="${p.url}">
        <h3>${escapeHtml(p.title || '')}</h3>
        <p class="ins-muted">${escapeHtml(p.excerpt || '')}</p>
        <div class="ins-meta"><span>${metaParts.filter(Boolean).join(' • ')}</span></div>
      </article>`;
  }

  function escapeHtml(s){
    return String(s||'')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;');
  }

  function renderLibrary(){
    const grid = $('#libraryGrid');
    if(!grid) return;

    const term = (state.q || '').toLowerCase();
    // Simple sort: newest first by date
    const sorted = (state.posts || []).slice().sort((a,b)=> (b.date||'').localeCompare(a.date||''));

    const filtered = sorted.filter(p=>{
      const typeOk  = state.type === 'all'  || (p.type||'') === state.type;
      const topicOk = state.topic === 'all' || ((p.topic||'').toLowerCase().includes(state.topic));
      const text = `${p.title||''} ${p.excerpt||''}`.toLowerCase();
      const qOk = !term || text.includes(term);
      return typeOk && topicOk && qOk;
    });

    grid.innerHTML = filtered.map(cardHTML).join('') || '<p class="ins-muted">No items.</p>';

    // click to open
    grid.querySelectorAll('.ci-post').forEach(el=>{
      const open = ()=> {
        const url = el.getAttribute('data-url');
        if(url) window.location.href = url;
      };
      el.addEventListener('click', open);
      el.addEventListener('keypress', (e)=>{ if(e.key==='Enter' || e.key===' ') open(); });
    });
  }

  // Animate bars once
  $$('.fill').forEach(f=>{
    const w = f.style.width;
    f.style.width = '0%';
    requestAnimationFrame(()=>{
      f.style.transition = 'width .9s ease';
      f.style.width = w;
    });
  });

  // Calculator
  const fmt = new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'});
  function recalc(){
    const base = parseFloat($('#base')?.value || '0');
    const coupon = parseFloat($('#coupon')?.value || '0');
    const ship = parseFloat($('#ship')?.value || '0');
    const tax = parseFloat($('#tax')?.value || '0');
    const net = Math.max(0, base - coupon);
    const total = net + ship + (net * (tax/100));
    $('#total').textContent = 'All-in: ' + fmt.format(total);
    const save = base + ship + (base*(tax/100)) - total;
    $('#savings').textContent = save>0 ? ('You save ' + fmt.format(save)) : '';
  }
  ['base','coupon','ship','tax'].forEach(id => $('#'+id)?.addEventListener('input', recalc));
  recalc();

  // Initialize
  // Respect URL params that were pre-set in your HTML
  if(state.topic !== 'all') setTopic(state.topic);
  if(state.type  !== 'all') setType(state.type);
  filterTables();
  loadLibrary();

  // Last updated footer
  const dt = new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date());
  const last = $('#lastUpdated'); if(last) last.textContent = 'Updated ' + dt;
})();
