(() => {
  // ─── Elements ─────────────────────────────────────────────────────────────────
  const listView   = document.getElementById("pcLabelsListView");
  const detailView = document.getElementById("pcLabelsDetailView");
  const labelsGrid = document.getElementById("pcLabelsGrid");
  const labelsEmpty= document.getElementById("pcLabelsEmpty");
  const createBtn  = document.getElementById("pcLabelsCreate");

  // Detail view
  const detailTitle    = document.getElementById("pcLabelDetailTitle");
  const detailCount    = document.getElementById("pcLabelDetailCount");
  const detailItems    = document.getElementById("pcLabelDetailItems");
  const detailItemsEmpty = document.getElementById("pcLabelDetailEmpty");
  const backBtn        = document.getElementById("pcLabelsBack");
  const renameTrigger  = document.getElementById("pcLabelRename");
  const deleteListBtn  = document.getElementById("pcLabelDelete");

  // Create modal
  const createModal    = document.getElementById("pcLabelCreateModal");
  const createInput    = document.getElementById("pcLabelCreateInput");
  const createSubmit   = document.getElementById("pcLabelCreateSubmit");
  const createCancel   = document.getElementById("pcLabelCreateCancel");

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function clean(v) { return String(v || "").trim(); }

  function dashboardUrl(entityKey) {
    const k = clean(entityKey);
    if (!k) return "/dashboard/";
    const [kind, ...rest] = k.split(":");
    const val = rest.join(":");
    if (!kind || !val) return "/dashboard/";
    return `/dashboard/${kind}/${encodeURIComponent(val)}/`;
  }

  function relativeDate(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86_400_000);
    if (days < 1)   return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7)   return `${days} days ago`;
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(dateStr));
  }

  // ─── State ────────────────────────────────────────────────────────────────────

  let _labels       = [];
  let _activeLabel  = null;  // { id, name }
  let _activeItems  = [];

  // ─── Labels list view ─────────────────────────────────────────────────────────

  function renderLabels(labels) {
    _labels = Array.isArray(labels) ? labels : [];

    if (!_labels.length) {
      if (labelsGrid)  labelsGrid.innerHTML = "";
      if (labelsEmpty) labelsEmpty.hidden = false;
      return;
    }

    if (labelsEmpty) labelsEmpty.hidden = true;

    labelsGrid.innerHTML = _labels.map(lb => labelCardHtml(lb)).join("");

    labelsGrid.querySelectorAll("[data-label-id]").forEach(card => {
      card.addEventListener("click", e => {
        if (e.target.closest("[data-label-action]")) return;
        e.preventDefault();
        const id = Number(card.getAttribute("data-label-id"));
        openLabel(id);
      });
    });

    labelsGrid.querySelectorAll("[data-label-action='delete']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const id = Number(btn.closest("[data-label-id]").getAttribute("data-label-id"));
        if (confirm("Delete this label and all its products?")) await deleteLabel(id);
      });
    });

    labelsGrid.querySelectorAll("[data-label-action='rename']").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const id   = Number(btn.closest("[data-label-id]").getAttribute("data-label-id"));
        const lb   = _labels.find(l => l.id === id);
        const name = prompt("Rename label:", lb?.name || "");
        if (name && clean(name)) await renameLabel(id, clean(name));
      });
    });
  }

  function labelCardHtml(lb) {
    const n    = lb.item_count || 0;
    const sub  = n === 0 ? "No products" : n === 1 ? "1 product" : `${n} products`;
    const img  = clean(lb.cover_image);
    const when = relativeDate(lb.updated_at);

    const thumb = img
      ? `<img class="pc-label-card__cover-img" src="${esc(img)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">`
      : `<div class="pc-label-card__cover-ph">
           <svg viewBox="0 -960 960 960" width="32" height="32" aria-hidden="true">
             <path fill="currentColor" opacity=".35" d="M200-200v-560 560Zm0 80q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h168q13-36 43.5-58t68.5-22q38 0 68.5 22t43.5 58H760q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm80-80h280v-80H280v80Zm0-160h400v-80H280v80Zm0-160h400v-80H280v80Zm200-190q13 0 21.5-8.5T510-820q0-13-8.5-21.5T480-850q-13 0-21.5 8.5T450-820q0 13 8.5 21.5T480-790Z"/>
           </svg>
         </div>`;

    return `
        <div class="pc-label-card" data-label-id="${lb.id}" tabindex="0" role="button" aria-label="Open ${esc(lb.name)}" style="position:relative;">
        <div class="pc-label-card__thumb">${thumb}</div>
        <div class="pc-label-card__body">
          <div class="pc-label-card__name">${esc(lb.name)}</div>
          <div class="pc-label-card__sub">${esc(sub)} · ${esc(when)}</div>
        </div>
        <div class="pc-label-card__actions">
          <button class="pc-label-card__action-btn" type="button" data-label-action="rename" aria-label="Rename label" title="Rename">
            <svg viewBox="0 -960 960 960" width="17" height="17"><path fill="currentColor" d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z"/></svg>
          </button>
          <button class="pc-label-card__action-btn pc-label-card__action-btn--del" type="button" data-label-action="delete" aria-label="Delete label" title="Delete">
            <svg viewBox="0 -960 960 960" width="17" height="17"><path fill="currentColor" d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>
          </button>
        </div>
      </div>
    `;
  }

  // ─── Label detail view ────────────────────────────────────────────────────────

  function showListView() {
    if (listView)   listView.hidden = false;
    if (detailView) detailView.hidden = true;
    _activeLabel = null;
    _activeItems = [];
  }

  function showDetailView() {
    if (listView)   listView.hidden = true;
    if (detailView) detailView.hidden = false;
  }

  async function openLabel(id) {
    const lb = _labels.find(l => Number(l.id) === id);
    if (!lb) return;

    _activeLabel = lb;
    if (detailTitle) detailTitle.textContent = lb.name;
    if (detailCount) { detailCount.textContent = ""; detailCount.hidden = true; }
    if (detailItems) detailItems.innerHTML = `<div class="pc-label-loading">Loading…</div>`;
    if (detailItemsEmpty) detailItemsEmpty.hidden = true;

    showDetailView();

    try {
      const res  = await fetch(`/api/labels/${id}/items`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { renderDetailItems([]); return; }
      renderDetailItems(data.results || []);
    } catch (_e) {
      renderDetailItems([]);
    }
  }

  function renderDetailItems(items) {
    _activeItems = Array.isArray(items) ? items : [];
    const n = _activeItems.length;

    if (detailCount) {
      detailCount.textContent = n === 0 ? "" : n === 1 ? "1 product" : `${n} products`;
      detailCount.hidden = n === 0;
    }

    if (!n) {
      if (detailItems)      detailItems.innerHTML = "";
      if (detailItemsEmpty) detailItemsEmpty.hidden = false;
      return;
    }

    if (detailItemsEmpty) detailItemsEmpty.hidden = true;

    detailItems.innerHTML = _activeItems.map(item => detailItemHtml(item)).join("");

    detailItems.querySelectorAll("[data-item-remove]").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.preventDefault();
        e.stopPropagation();
        const itemId = Number(btn.getAttribute("data-item-remove"));
        const el     = btn.closest(".pc-label-item");
        await removeDetailItem(itemId, el);
      });
    });
  }

  function detailItemHtml(item) {
    const href   = dashboardUrl(item.entity_key);
    const title  = clean(item.title) || "Product";
    const brand  = clean(item.brand);
    const imgSrc = clean(item.image_url);
    const when   = relativeDate(item.added_at);

    const imgHtml = imgSrc
      ? `<img class="pc-label-item__img" src="${esc(imgSrc)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none'">`
      : `<div class="pc-label-item__img-ph"></div>`;

    return `
      <div class="pc-label-item">
        <a class="pc-label-item__thumb" href="${esc(href)}" aria-label="${esc(title)}">${imgHtml}</a>
        <div class="pc-label-item__body">
          ${brand ? `<div class="pc-label-item__brand">${esc(brand)}</div>` : ""}
          <a class="pc-label-item__title" href="${esc(href)}">${esc(title)}</a>
          <div class="pc-label-item__when">Added ${esc(when)}</div>
        </div>
        <button class="pc-label-item__remove" type="button"
          data-item-remove="${esc(String(item.id))}"
          aria-label="Remove from label" title="Remove">
          <svg viewBox="0 -960 960 960" width="18" height="18"><path fill="currentColor" d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z"/></svg>
        </button>
      </div>
    `;
  }

  async function removeDetailItem(itemId, el) {
    if (!_activeLabel) return;
    if (el) { el.style.opacity = "0.4"; el.style.pointerEvents = "none"; }

    try {
      const res = await fetch(`/api/labels/${_activeLabel.id}/items/${itemId}`, {
        method: "DELETE", credentials: "same-origin"
      });
      if (res.ok) {
        _activeItems = _activeItems.filter(i => i.id !== itemId);
        renderDetailItems(_activeItems);
        // Update count in label list
        const lb = _labels.find(l => l.id === _activeLabel.id);
        if (lb) { lb.item_count = Math.max(0, (lb.item_count || 1) - 1); }
      } else {
        if (el) { el.style.opacity = ""; el.style.pointerEvents = ""; }
      }
    } catch (_e) {
      if (el) { el.style.opacity = ""; el.style.pointerEvents = ""; }
    }
  }

  // ─── API: create / rename / delete label ─────────────────────────────────────

  async function createLabel(name) {
    const res  = await fetch("/api/labels", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Failed to create label.");
    _labels.unshift(data.label);
    renderLabels(_labels);
    return data.label;
  }

  async function renameLabel(id, name) {
    const res  = await fetch(`/api/labels/${id}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) { alert(data?.error || "Failed to rename."); return; }
    const lb = _labels.find(l => l.id === id);
    if (lb) lb.name = name;
    renderLabels(_labels);
  }

  async function deleteLabel(id) {
    const res = await fetch(`/api/labels/${id}`, { method: "DELETE", credentials: "same-origin" });
    if (res.ok) {
      _labels = _labels.filter(l => l.id !== id);
      renderLabels(_labels);
    }
  }

  // ─── Create modal ─────────────────────────────────────────────────────────────

  function openCreateModal() {
    if (!createModal) return;
    if (createInput) createInput.value = "";
    createModal.hidden = false;
    requestAnimationFrame(() => createInput?.focus());
  }

  function closeCreateModal() {
    if (!createModal) return;
    createModal.hidden = true;
    if (createInput) createInput.value = "";
  }

  if (createBtn)    createBtn.addEventListener("click", openCreateModal);
  if (createCancel) createCancel.addEventListener("click", closeCreateModal);

  if (createModal) {
    createModal.addEventListener("click", e => { if (e.target === createModal) closeCreateModal(); });
  }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && createModal && !createModal.hidden) closeCreateModal();
  });

  if (createSubmit && createInput) {
    async function submitCreate() {
      const name = clean(createInput.value);
      if (!name) { createInput.focus(); return; }

      createSubmit.disabled = true;
      createSubmit.textContent = "Creating…";

      try {
        await createLabel(name);
        closeCreateModal();
      } catch (err) {
        alert(err.message || "Failed to create label.");
      } finally {
        createSubmit.disabled = false;
        createSubmit.textContent = "Create";
      }
    }

    createSubmit.addEventListener("click", submitCreate);
    createInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); submitCreate(); }
    });
  }

  // ─── Back button ─────────────────────────────────────────────────────────────

  if (backBtn) backBtn.addEventListener("click", () => showListView());

  // ─── Detail rename / delete buttons ──────────────────────────────────────────

  if (renameTrigger) {
    renameTrigger.addEventListener("click", async () => {
      if (!_activeLabel) return;
      const name = prompt("Rename label:", _activeLabel.name);
      if (name && clean(name)) {
        await renameLabel(_activeLabel.id, clean(name));
        if (detailTitle) detailTitle.textContent = clean(name);
        _activeLabel.name = clean(name);
      }
    });
  }

  if (deleteListBtn) {
    deleteListBtn.addEventListener("click", async () => {
      if (!_activeLabel) return;
      if (!confirm(`Delete "${_activeLabel.name}" and all its products?`)) return;
      await deleteLabel(_activeLabel.id);
      showListView();
    });
  }

  // ─── Load labels ──────────────────────────────────────────────────────────────

  async function load() {
    try {
      const res  = await fetch("/api/labels", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || data.signed_in === false) { renderLabels([]); return; }
      renderLabels(data.results || []);
    } catch (_e) { renderLabels([]); }
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────

  load();

  window.addEventListener("pc:auth_changed", e => {
    if (e?.detail?.signedIn) load();
    else { renderLabels([]); showListView(); }
  });
})();