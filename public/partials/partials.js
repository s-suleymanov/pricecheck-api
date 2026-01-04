// public/partials/partials.js
(async () => {
function wireHeaderSearch() {
  const form = document.querySelector('header.nav form.nav-search');
  const input = document.querySelector('header.nav input.nav-search__input');
  if (!form || !input) return;

  if (!window.pcSearch) {
    console.warn("pcSearch missing. Include /search.js before /partials/partials.js");
    return;
  }

  window.pcSearch.bindForm(form, input);
}

  async function loadPartial(mountId, url) {
    const mount = document.getElementById(mountId);
    if (!mount) return false;

    try {
      const res = await fetch(url, { cache: "default" });
      if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
      mount.innerHTML = await res.text();
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  }

  function normalizePath(p) {
    if (!p) return "/";
    return p.endsWith("/") ? p : p + "/";
  }

  const [headerOk, footerOk] = await Promise.all([
    loadPartial("site-header", "/partials/header.html"),
    loadPartial("site-footer", "/partials/footer.html"),
  ]);

  if (headerOk) wireHeaderSearch();
})();