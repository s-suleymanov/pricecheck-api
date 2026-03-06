(() => {
  const form = document.getElementById("pcFullSignInForm");
  const status = document.getElementById("pcFullSignInStatus");

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
    submitBtn.textContent = isBusy ? "Signing In..." : "Sign in";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = String(form.email?.value || "").trim();
    const password = String(form.password?.value || "");
    const rememberMe = !!form.remember_me?.checked;

    if (!email || !password) {
      setStatus("Enter your email and password.");
      return;
    }

    setStatus("");
    setBusy(true);

    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          password,
          remember_me: rememberMe
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setStatus(data.error || "Unable to sign in right now.");
        setBusy(false);
        return;
      }

      window.location.href = "/";
    } catch (_err) {
      setStatus("Unable to sign in right now.");
      setBusy(false);
    }
  });
})();