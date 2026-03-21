(() => {
  const AUTH_STORAGE_KEY = "pc_auth_user";

  const signedOutBox = document.getElementById("pcAccountSignedOut");
  const signInBtn = document.getElementById("pcAccountSignInBtn");

  const privacyNote = document.getElementById("pcAccountPrivacyNote");

  const panel = document.getElementById("pcAccountPanel");
  const stats = document.getElementById("pcAccountStats");

  const avatarImg = document.getElementById("pcAccountAvatarImg");
  const avatarFallback = document.getElementById("pcAccountAvatarFallback");

  const nameEl = document.getElementById("pcAccountName");
  const emailEl = document.getElementById("pcAccountEmail");
  const followingEl = document.getElementById("pcFollowingCount");
  const memberSinceEl = document.getElementById("pcMemberSince");

  function clean(v) {
    return String(v || "").trim();
  }

  function setStoredAuthUser(user) {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user || {}));
    } catch (_e) {}
  }

  function getAvatarLetter(user) {
    const base =
      clean(user?.nickname) ||
      clean(user?.display_name) ||
      clean(user?.email) ||
      "P";

    return base.charAt(0).toUpperCase();
  }

  function renderAvatar(user) {
    if (!avatarFallback || !avatarImg) return;

    avatarFallback.textContent = getAvatarLetter(user);

    const src = clean(user?.profile_image_url);
    if (src) {
      avatarImg.src = src;
      avatarImg.hidden = false;
      avatarFallback.hidden = true;
      return;
    }

    avatarImg.removeAttribute("src");
    avatarImg.hidden = true;
    avatarFallback.hidden = false;
  }

  function formatDate(value) {
    if (!value) return "-";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "-";

    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function showSignedOut() {
  if (signedOutBox) signedOutBox.hidden = false;
  if (panel) panel.hidden = true;
  if (stats) stats.hidden = true;
  if (privacyNote) privacyNote.hidden = true;
  renderAvatar(null);
}

function showSignedIn(user) {
  if (signedOutBox) signedOutBox.hidden = true;
  if (panel) panel.hidden = false;
  if (stats) stats.hidden = false;
  if (privacyNote) privacyNote.hidden = false;

  const displayName =
    clean(user?.nickname) ||
    clean(user?.display_name) ||
    "Your Account";

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = clean(user?.email);
  if (followingEl) followingEl.textContent = String(Number(user?.follow_count || 0));
  if (memberSinceEl) memberSinceEl.textContent = formatDate(user?.created_at);

  renderAvatar(user);
  setStoredAuthUser(user);
}

  signInBtn?.addEventListener("click", () => {
    if (typeof window.pcOpenSignIn === "function") {
      window.pcOpenSignIn();
    }
  });

  async function loadAccount() {
    try {
      const res = await fetch("/api/account/me", {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "application/json" }
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok !== true || !data.signed_in || !data.user) {
        showSignedOut();
        return;
      }

      showSignedIn(data.user);
    } catch (_e) {
      showSignedOut();
    }
  }

  loadAccount();
})();