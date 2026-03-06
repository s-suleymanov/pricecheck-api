(() => {
  const AUTH_STORAGE_KEY = "pc_auth_user";

  const signedOutBox = document.getElementById("pcSettingsSignedOut");
  const signInBtn = document.getElementById("pcSettingsSignInBtn");

  const avatarForm = document.getElementById("pcAvatarForm");
  const avatarInput = document.getElementById("pcAvatarInput");
  const avatarSubmit = document.getElementById("pcAvatarSubmit");
  const avatarStatus = document.getElementById("pcAvatarStatus");
  const avatarImg = document.getElementById("pcAvatarImg");
  const avatarFallback = document.getElementById("pcAvatarFallback");

  const profileForm = document.getElementById("pcProfileForm");
  const nicknameInput = document.getElementById("pcNickname");
  const profileSubmit = document.getElementById("pcProfileSubmit");
  const profileStatus = document.getElementById("pcProfileStatus");

  let currentUser = null;
  let previewUrl = "";

  function clean(v) {
    return String(v || "").trim();
  }

  function setStoredAuthUser(user) {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user || {}));
    } catch (_e) {}
  }

  function setStatus(el, msg, isError = false) {
    if (!el) return;

    const text = clean(msg);
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle("is-error", !!text && isError);
    el.classList.toggle("is-success", !!text && !isError);
  }

  function getAvatarLetter(user) {
    const base =
      clean(user?.nickname) ||
      clean(user?.display_name) ||
      clean(user?.email) ||
      "P";

    return base.charAt(0).toUpperCase();
  }

  function renderAvatar(user, srcOverride = "") {
    const src = clean(srcOverride) || clean(user?.profile_image_url);

    avatarFallback.textContent = getAvatarLetter(user);

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

  function setFormsEnabled(enabled) {
    const ok = !!enabled;

    if (avatarInput) avatarInput.disabled = !ok;
    if (avatarSubmit) avatarSubmit.disabled = !ok;
    if (nicknameInput) nicknameInput.disabled = !ok;
    if (profileSubmit) profileSubmit.disabled = !ok;
  }

  async function loadAccount() {
    try {
      const res = await fetch("/api/account/me", {
        method: "GET",
        credentials: "same-origin",
        headers: {
          "Accept": "application/json"
        }
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok !== true || !data.signed_in || !data.user) {
        currentUser = null;
        signedOutBox.hidden = false;
        setFormsEnabled(false);
        renderAvatar(null);
        return;
      }

      currentUser = data.user;
      setStoredAuthUser(currentUser);

      signedOutBox.hidden = true;
      setFormsEnabled(true);
      nicknameInput.value = clean(currentUser.nickname) || clean(currentUser.display_name);
      renderAvatar(currentUser);
    } catch (_e) {
      currentUser = null;
      signedOutBox.hidden = false;
      setFormsEnabled(false);
      renderAvatar(null);
    }
  }

  signInBtn?.addEventListener("click", () => {
    if (typeof window.pcOpenSignIn === "function") {
      window.pcOpenSignIn();
    }
  });

  avatarInput?.addEventListener("change", () => {
    const file = avatarInput.files?.[0];

    if (!file) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = "";
      }

      renderAvatar(currentUser);
      setStatus(avatarStatus, "");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }

    previewUrl = URL.createObjectURL(file);
    renderAvatar(currentUser, previewUrl);
    setStatus(avatarStatus, "Ready to upload.");
  });

  avatarForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const file = avatarInput.files?.[0];
    if (!file) {
      setStatus(avatarStatus, "Choose an image first.", true);
      return;
    }

    setStatus(avatarStatus, "Uploading...");
    if (avatarSubmit) avatarSubmit.disabled = true;

    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const res = await fetch("/api/account/avatar", {
        method: "POST",
        credentials: "same-origin",
        body: formData
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok !== true || !data.user) {
        setStatus(avatarStatus, data?.error || "Unable to upload image.", true);
        if (avatarSubmit) avatarSubmit.disabled = false;
        return;
      }

      currentUser = data.user;
      setStoredAuthUser(currentUser);
      avatarInput.value = "";

      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = "";
      }

      renderAvatar(currentUser);
      setStatus(avatarStatus, "Profile image updated.");
    } catch (_e) {
      setStatus(avatarStatus, "Unable to upload image.", true);
    } finally {
      if (avatarSubmit) avatarSubmit.disabled = false;
    }
  });

  profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const nickname = clean(nicknameInput.value).replace(/\s+/g, " ").slice(0, 40);

    if (!nickname) {
      setStatus(profileStatus, "Nickname is required.", true);
      return;
    }

    setStatus(profileStatus, "Saving...");
    if (profileSubmit) profileSubmit.disabled = true;

    try {
      const res = await fetch("/api/account/profile", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ nickname })
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data || data.ok !== true || !data.user) {
        setStatus(profileStatus, data?.error || "Unable to save nickname.", true);
        if (profileSubmit) profileSubmit.disabled = false;
        return;
      }

      currentUser = data.user;
      setStoredAuthUser(currentUser);
      nicknameInput.value = clean(currentUser.nickname) || clean(currentUser.display_name);
      renderAvatar(currentUser);
      setStatus(profileStatus, "Nickname updated.");
    } catch (_e) {
      setStatus(profileStatus, "Unable to save nickname.", true);
    } finally {
      if (profileSubmit) profileSubmit.disabled = false;
    }
  });

  loadAccount();
})();