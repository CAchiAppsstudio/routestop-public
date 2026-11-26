(() => {
  const hosted = window.location.origin === "https://admin.cachiappsstudio.fr";
  const sharesRouteStopSession = window.location.origin === "https://routestop.fr";
  const config = window.ROUTESTOP_SUPABASE;
  const ready = (hosted || sharesRouteStopSession) && config?.url === "https://ubvvtmrnczqgoiavijfp.supabase.co" &&
    config.anonKey && typeof window.supabase?.createClient === "function";
  const client = ready ? window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }) : null;

  const appleFactorName = "Mots de passe Apple";

  function isAppleFactor(factor) {
    const name = factor.friendly_name;
    return name === appleFactorName || Boolean(name?.startsWith(appleFactorName + " "));
  }

  async function mfaLevels() {
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data;
  }

  async function confirmPassword(userId, password) {
    const { data: { user }, error } = await client.auth.getUser();
    if (error) throw error;
    if (user?.id !== userId || !user.email) throw new Error("session_changed");
    // Check with the provider in an isolated session so the active MFA session is retained.
    const verifier = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        storageKey: "cachi-studio-password-verification",
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error: signInError } = await verifier.auth.signInWithPassword({ email: user.email, password });
    if (signInError) throw signInError;
    const { error: signOutError } = await verifier.auth.signOut({ scope: "local" });
    if (signOutError) throw signOutError;
    if (data.user?.id !== userId) throw new Error("session_changed");
  }

  function makeMfaForm(login) {
    const form = document.createElement("form");
    form.className = "form signin-form";
    form.dataset.mfaForm = "";
    form.method = "post";
    form.hidden = true;

    const factorLabel = document.createElement("label");
    const factor = document.createElement("select");
    factor.name = "factor";
    factorLabel.append("Application d’authentification", factor);

    const label = document.createElement("label");
    const code = document.createElement("input");
    Object.assign(code, {
      name: "code", inputMode: "numeric", autocomplete: "one-time-code",
      maxLength: 6, pattern: "[0-9]{6}", required: true,
    });
    label.append("Code à six chiffres", code);
    const button = document.createElement("button");
    button.className = "button";
    button.type = "submit";
    button.textContent = "Vérifier le code";
    form.append(factorLabel, label, button);
    login.after(form);
    return { form, factorLabel, factor, code, button };
  }

  function mount({ home = false, allowEnrollment = false, onAccess }) {
    const gate = document.querySelector("[data-gate]");
    const status = document.querySelector("[data-access-status]");
    const connect = document.querySelector("[data-connect]");
    const retry = document.querySelector("[data-refresh-access]");
    const login = document.querySelector("[data-login]");
    const mfa = makeMfaForm(login);
    const signIn = login.querySelector('button[type="submit"]');
    const signOut = document.querySelector("[data-sign-out]");
    const warning = document.querySelector("[data-session-error]");
    const workspace = document.querySelector("[data-workspace]");
    const security = document.querySelector("[data-security]");
    const enrollLink = document.querySelector("[data-enroll-link]");
    let access = null;
    let revision = 0;
    let timer;

    function showWarning(message = "") {
      warning.textContent = message;
      warning.hidden = !message;
    }

    function render({ granted = null, message = "", canConnect = false, canRetry = false, signedIn = false, pending = false, factors = [], canEnroll = false }) {
      const previousId = access?.userId;
      access = granted;
      gate.hidden = Boolean(granted) || pending;
      workspace.hidden = !granted;
      status.textContent = message;
      connect.hidden = !canConnect || hosted;
      login.hidden = !canConnect || !hosted;
      if (login.hidden) login.reset();
      retry.hidden = !canRetry;
      signOut.hidden = !signedIn;
      if (security) security.hidden = !granted || !hosted;
      if (enrollLink) enrollLink.hidden = !canEnroll;
      mfa.form.hidden = !factors.length;
      if (factors.length) {
        const previous = mfa.factor.value;
        mfa.factor.replaceChildren(...factors.map((factor, index) =>
          new Option(isAppleFactor(factor) ? appleFactorName :
            factor.friendly_name || "Application " + (index + 1), factor.id)));
        mfa.factor.value = factors.find(factor => factor.id === previous)?.id ??
          factors.find(isAppleFactor)?.id ?? factors[0].id;
        mfa.factorLabel.hidden = factors.length < 2;
      } else {
        mfa.code.value = "";
        mfa.factor.replaceChildren();
      }
      onAccess(granted, previousId);
    }

    function showSignedOut() {
      render({
        message: hosted ? "" : "Connecte-toi avec ton compte administrateur RouteStop, puis reviens ici.",
        canConnect: true,
        canRetry: !hosted,
      });
    }

    async function refresh() {
      if (!client) {
        const message = hosted || sharesRouteStopSession ?
          "La connexion au portail est indisponible. Actualise la page." :
          "Connecte-toi sur l’adresse officielle admin.cachiappsstudio.fr.";
        render({ message });
        return;
      }

      const request = ++revision;
      let signedIn = false;
      retry.disabled = true;
      showWarning();
      try {
        const { data: { session }, error } = await client.auth.getSession();
        if (request !== revision) return;
        if (error) throw error;
        if (!session) {
          showSignedOut();
          return;
        }

        signedIn = true;
        const userId = session.user.id;
        const { currentLevel, nextLevel } = await mfaLevels();
        if (request !== revision) return;
        if (currentLevel !== "aal2" && nextLevel === "aal2") {
          const { data, error } = await client.auth.mfa.listFactors();
          if (request !== revision) return;
          if (error) throw error;
          const factors = data.totp ?? [];
          render({
            signedIn: true, factors, canRetry: !factors.length,
            message: factors.length ? "" : "Aucune application d’authentification disponible pour ce compte.",
          });
          return;
        }
        if (currentLevel !== "aal2") {
          const [pod, route] = await Promise.all([
            client.from("studio_podlegacy_admins").select("user_id").eq("user_id", userId).maybeSingle(),
            client.from("admin_users").select("id").eq("id", userId).maybeSingle(),
          ]);
          if (request !== revision) return;
          if (pod.error || route.error) throw pod.error ?? route.error;
          const eligible = Boolean(pod.data || route.data);
          if (eligible && allowEnrollment) {
            render({ granted: { userId, enrollmentOnly: true }, signedIn: true });
          } else {
            render({
              signedIn: true, canEnroll: eligible,
              message: eligible ? "Configure la double authentification pour ouvrir l’administration." :
                "Ce compte n’a pas accès à cet espace d’administration.",
            });
          }
          return;
        }

        const [pod, route] = await Promise.all([
          client.from("studio_podlegacy_admins").select("user_id").eq("user_id", userId).maybeSingle(),
          home ? client.rpc("is_admin") : Promise.resolve({ data: false }),
        ]);
        if (request !== revision) return;

        const podLegacy = Boolean(pod.data);
        const routeStop = route.data === true;
        if (podLegacy || routeStop) {
          render({ granted: { userId, podLegacy, routeStop }, signedIn: true });
          if (pod.error || route.error) {
            showWarning("Un accès n’a pas pu être vérifié. Actualise la page pour réessayer.");
          }
        } else if (pod.error || route.error) {
          render({ message: "Impossible de vérifier les droits de ce compte.", canRetry: true, signedIn: true });
        } else {
          render({ message: home ? "Ce compte n’a pas accès à ces espaces d’administration." :
            "Ce compte n’a pas accès à l’administration de PodLegacy.", signedIn: true });
        }
      } catch {
        if (request === revision) {
          render({ message: "Impossible de vérifier la connexion. Réessaie dans un instant.", canRetry: true, signedIn });
        }
      } finally {
        if (request === revision) retry.disabled = false;
      }
    }

    function scheduleRefresh() {
      clearTimeout(timer);
      timer = setTimeout(refresh, 0);
    }

    login.addEventListener("submit", async event => {
      event.preventDefault();
      if (!hosted || !client || login.hidden || signIn.disabled) return;
      const { email, password } = login.elements;
      signIn.disabled = true;
      showWarning();
      status.textContent = "Connexion en cours…";
      try {
        const { error } = await client.auth.signInWithPassword({
          email: email.value.trim(),
          password: password.value,
        });
        if (error) {
          showSignedOut();
          showWarning(error.code === "invalid_credentials" ?
            "Adresse e-mail ou mot de passe incorrect." : "Impossible de te connecter. Réessaie dans un instant.");
          return;
        }
        login.reset();
        scheduleRefresh();
      } catch {
        showSignedOut();
        showWarning("Impossible de te connecter. Réessaie dans un instant.");
      } finally {
        password.value = "";
        signIn.disabled = false;
      }
    });

    mfa.factor.addEventListener("change", () => {
      mfa.code.value = "";
      showWarning();
    });

    mfa.form.addEventListener("submit", async event => {
      event.preventDefault();
      if (mfa.form.hidden || mfa.button.disabled) return;
      const factorId = mfa.factor.value;
      const code = mfa.code.value;
      if (!factorId || !/^[0-9]{6}$/.test(code)) return;
      mfa.code.value = "";
      mfa.button.disabled = true;
      showWarning();
      status.textContent = "Vérification du code…";
      try {
        const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw error;
        scheduleRefresh();
      } catch {
        if (!mfa.form.hidden) {
          status.textContent = "";
          showWarning("Code refusé. Essaie avec le nouveau code affiché par ton application.");
          mfa.code.focus();
        }
      } finally {
        mfa.button.disabled = false;
      }
    });

    retry.addEventListener("click", refresh);
    signOut.addEventListener("click", async () => {
      signOut.disabled = true;
      try {
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) throw error;
      } catch {
        showWarning("La déconnexion a échoué. Réessaie dans un instant.");
      } finally {
        signOut.disabled = false;
      }
    });

    if (!client) {
      refresh();
      return;
    }

    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        revision++;
        clearTimeout(timer);
        retry.disabled = false;
        showWarning();
        showSignedOut();
        return;
      }
      const nextId = session?.user.id;
      if (access?.userId === nextId && nextId) {
        if (event === "MFA_CHALLENGE_VERIFIED") scheduleRefresh();
        return;
      }
      if (access) {
        revision++;
        render({ pending: true });
      }
      // Supabase locks its session during the callback. Start requests afterwards.
      scheduleRefresh();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    });
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) return;
      revision++;
      clearTimeout(timer);
      showWarning();
      render({ pending: true });
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) scheduleRefresh();
    });
  }

  window.StudioAdmin = { client, mount, mfaLevels, confirmPassword, appleFactorName, isAppleFactor };
})();
