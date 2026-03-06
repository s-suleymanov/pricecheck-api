(() => {
  const AUTH_STORAGE_KEY = "pc_auth_user";
  const WELCOME_PLUS_FLAG = "pc_welcome_plus_reward";

  const form = document.getElementById("pcSignUpForm");
  const status = document.getElementById("pcSignUpStatus");

  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]');

  function setStatus(msg = "") {
    if (!status) return;
    const text = String(msg || "").trim();
    status.textContent = text;
    status.hidden = !text;
  }

  function setBusy(isBusy) {
    if (!submitBtn) return;
    submitBtn.disabled = !!isBusy;
    submitBtn.textContent = isBusy ? "Creating Account..." : "Create Account";
  }

  function saveAuthUser(user) {
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user || {}));
    } catch (_e) {}
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const displayName = String(form.display_name?.value || "").trim();
    const phone = String(form.phone?.value || "").trim();
    const email = String(form.email?.value || "").trim();
    const password = String(form.password?.value || "");
    const passwordConfirm = String(form.password_confirm?.value || "");

    if (!displayName || !phone || !email || !password || !passwordConfirm) {
      setStatus("Fill out every field.");
      return;
    }

    if (password !== passwordConfirm) {
      setStatus("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setStatus("Password must be at least 8 characters.");
      return;
    }

    setStatus("");
    setBusy(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          display_name: displayName,
          phone,
          email,
          password
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok || !data.user) {
        setStatus(data.error || "Unable to create account right now.");
        setBusy(false);
        return;
      }

      saveAuthUser(data.user);

      try {
        sessionStorage.setItem(WELCOME_PLUS_FLAG, "1");
      } catch (_e) {}

      location.href = "/";
    } catch (_err) {
      setStatus("Unable to create account right now.");
      setBusy(false);
    }
  });
})();