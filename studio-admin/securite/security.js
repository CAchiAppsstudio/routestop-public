(() => {
  const { client, mount, confirmPassword } = window.StudioAdmin;
  const select = selector => document.querySelector(selector);
  const factorName = "CachiAppsStudio";
  const setup = select("[data-factor-setup]");
  const factorStatus = select("[data-factor-status]");
  const factorMessage = select("[data-factor-message]");
  const start = select("[data-start-factor]");
  const qr = select("[data-factor-qr]");
  const manualKey = select("[data-factor-key]");
  const enrollmentForm = select("[data-enroll-factor]");
  const activate = enrollmentForm.querySelector('button[type="submit"]');
  const cancel = select("[data-cancel-factor]");
  const passwordForm = select("[data-change-password]");
  const passwordSection = select("[data-password-section]");
  const change = passwordForm.querySelector('button[type="submit"]');
  const passwordMessage = select("[data-password-message]");
  const nonceLabel = select("[data-password-nonce]");
  const nonce = passwordForm.elements.namedItem("nonce");
  let account = null;
  let operation = null;
  let factorId = null;

  function feedback(target, text = "", level = "") {
    target.textContent = text;
    target.className = level ? "message " + level : "message";
    target.hidden = !text;
  }

  function setBusy(busy) {
    for (const button of [start, activate, cancel, change]) button.disabled = busy;
  }

  function begin() {
    if (!account || operation) return null;
    operation = { account };
    setBusy(true);
    return operation;
  }

  function finish(request) {
    if (operation !== request) return;
    operation = null;
    setBusy(false);
  }

  function clearEnrollment() {
    factorId = null;
    setup.hidden = true;
    qr.hidden = true;
    qr.removeAttribute("src");
    manualKey.textContent = "";
    manualKey.closest("details").open = false;
    enrollmentForm.reset();
  }

  function showNonce(visible) {
    nonce.value = "";
    nonceLabel.hidden = !visible;
    nonce.disabled = !visible;
    nonce.required = visible;
  }

  async function listFactors() {
    const { data, error } = await client.auth.mfa.listFactors();
    if (error) throw error;
    return data;
  }

  function showFactorState(factors) {
    const configured = factors.totp.length > 0;
    factorStatus.textContent = configured ? "Activée" : "À configurer";
    start.hidden = configured || Boolean(factorId);
  }

  async function refreshFactors(expected) {
    factorStatus.textContent = "Vérification…";
    try {
      const factors = await listFactors();
      if (account === expected) showFactorState(factors);
    } catch {
      if (account === expected) {
        factorStatus.textContent = "Impossible de vérifier la double authentification. Actualise la page.";
      }
    }
  }

  start.addEventListener("click", async () => {
    const request = begin();
    if (!request) return;
    feedback(factorMessage);
    try {
      const factors = await listFactors();
      if (operation !== request) return;
      if (factors.totp.length) {
        showFactorState(factors);
        return;
      }
      const friendlyName = factors.all.some(factor => factor.friendly_name === factorName)
        ? factorName + " " + crypto.randomUUID().slice(0, 8) : factorName;
      const { data, error } = await client.auth.mfa.enroll({
        factorType: "totp", friendlyName, issuer: factorName,
      });
      if (operation !== request) return;
      if (error) throw error;
      const { qr_code: image, secret } = data.totp;
      if (!/^data:image\/svg\+xml;(utf-8|base64),/i.test(image) || !secret) {
        throw new Error("invalid_enrollment");
      }
      factorId = data.id;
      qr.src = image;
      qr.hidden = false;
      manualKey.textContent = secret;
      start.hidden = true;
      setup.hidden = false;
      enrollmentForm.elements.namedItem("code").focus();
    } catch {
      if (operation === request) feedback(factorMessage, "Impossible de préparer le code. Réessaie.", "warning");
    } finally {
      finish(request);
    }
  });

  enrollmentForm.addEventListener("submit", async event => {
    event.preventDefault();
    const code = enrollmentForm.elements.namedItem("code");
    if (!factorId || !/^[0-9]{6}$/.test(code.value)) return;
    const request = begin();
    if (!request) return;
    const enteredCode = code.value;
    code.value = "";
    feedback(factorMessage);
    try {
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: enteredCode });
      if (operation !== request) return;
      if (error) throw error;
      clearEnrollment();
      factorStatus.textContent = "Activée";
      feedback(factorMessage, "Double authentification activée.", "success");
    } catch {
      if (operation === request) {
        feedback(factorMessage, "Code refusé. Essaie avec le nouveau code de ton application.", "warning");
        code.focus();
      }
    } finally {
      finish(request);
    }
  });

  cancel.addEventListener("click", async () => {
    if (!factorId) return;
    const request = begin();
    if (!request) return;
    const pendingId = factorId;
    clearEnrollment();
    feedback(factorMessage);
    start.hidden = false;
    try {
      const { error } = await client.auth.mfa.unenroll({ factorId: pendingId });
      if (operation !== request) return;
      if (error && error.code !== "mfa_factor_not_found") throw error;
      start.focus();
    } catch {
      if (operation === request) feedback(factorMessage, "Configuration interrompue. Tu peux recommencer.", "warning");
    } finally {
      finish(request);
    }
  });

  function passwordError(error) {
    if (error.code === "invalid_credentials" || error.code === "current_password_mismatch") {
      return "Le mot de passe actuel est incorrect.";
    }
    if (error.code === "weak_password") return "Le nouveau mot de passe est trop faible.";
    if (error.code === "same_password") return "Choisis un mot de passe différent de l’actuel.";
    if (error.code === "insufficient_aal") return "Vérifie ton code d’authentification avant de continuer.";
    return "Impossible de changer le mot de passe. Réessaie dans un instant.";
  }

  passwordForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!account || account.enrollmentOnly || operation) return;
    const current = passwordForm.elements.namedItem("current");
    const next = passwordForm.elements.namedItem("next");
    const confirm = passwordForm.elements.namedItem("confirm");
    if (next.value !== confirm.value) {
      feedback(passwordMessage, "Les deux nouveaux mots de passe doivent être identiques.", "warning");
      confirm.focus();
      return;
    }
    if (current.value === next.value) {
      feedback(passwordMessage, "Choisis un mot de passe différent de l’actuel.", "warning");
      next.focus();
      return;
    }

    const request = begin();
    if (!request) return;
    feedback(passwordMessage, "Vérification en cours…");
    const attributes = { current_password: current.value, password: next.value };
    if (!nonce.disabled) attributes.nonce = nonce.value;

    try {
      await confirmPassword(request.account.userId, attributes.current_password);
      if (operation !== request) return;
      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (operation !== request) return;
      if (sessionError || session?.user.id !== request.account.userId) throw new Error("session_changed");

      const { error } = await client.auth.updateUser(attributes);
      if (operation !== request) return;
      if (error?.code === "reauthentication_needed" || error?.code === "reauthentication_not_valid") {
        const { error: codeError } = await client.auth.reauthenticate();
        if (operation !== request) return;
        if (codeError) throw codeError;
        showNonce(true);
        feedback(passwordMessage, "Saisis le code de confirmation reçu par e-mail.");
        nonce.focus();
        return;
      }
      if (error) throw error;

      passwordForm.reset();
      showNonce(false);
      feedback(passwordMessage, "Mot de passe modifié.", "success");
    } catch (error) {
      if (operation !== request) return;
      current.value = "";
      feedback(passwordMessage, passwordError(error), "warning");
      current.focus();
    } finally {
      finish(request);
    }
  });

  function resetForms() {
    operation = null;
    setBusy(false);
    clearEnrollment();
    start.hidden = true;
    factorStatus.textContent = "";
    passwordForm.reset();
    showNonce(false);
    feedback(passwordMessage);
    feedback(factorMessage);
  }

  window.addEventListener("pagehide", () => {
    account = null;
    resetForms();
  });

  mount({
    home: true,
    allowEnrollment: true,
    onAccess(access) {
      const enrollmentOnly = Boolean(access?.enrollmentOnly);
      passwordSection.hidden = !access || enrollmentOnly;
      if (account?.userId === access?.userId && account?.enrollmentOnly === enrollmentOnly) return;
      account = access ? { userId: access.userId, enrollmentOnly } : null;
      resetForms();
      if (account) refreshFactors(account);
    },
  });
})();
