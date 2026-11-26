(() => {
  const hosted = window.location.origin === "https://admin.cachiappsstudio.fr";
  const sharesRouteStopSession = window.location.origin === "https://routestop.fr";
  const config = window.ROUTESTOP_SUPABASE;
  const ready = (hosted || sharesRouteStopSession) && config?.url === "https://ubvvtmrnczqgoiavijfp.supabase.co" &&
    config.anonKey && typeof window.supabase?.createClient === "function";
  const client = ready ? window.supabase.createClient(config.url, config.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  }) : null;

  function mount({ home = false, onAccess }) {
    const gate = document.querySelector("[data-gate]");
    const status = document.querySelector("[data-access-status]");
    const connect = document.querySelector("[data-connect]");
    const retry = document.querySelector("[data-refresh-access]");
    const login = document.querySelector("[data-login]");
    const signIn = login.querySelector('button[type="submit"]');
    const signOut = document.querySelector("[data-sign-out]");
    const warning = document.querySelector("[data-session-error]");
    const workspace = document.querySelector("[data-workspace]");
    let access = null;
    let revision = 0;
    let timer;

    function showWarning(message = "") {
      warning.textContent = message;
      warning.hidden = !message;
    }

    function render({ granted = null, message = "", canConnect = false, canRetry = false, signedIn = false }) {
      const previousId = access?.userId;
      access = granted;
      gate.hidden = Boolean(granted);
      workspace.hidden = !granted;
      status.textContent = message;
      connect.hidden = !canConnect || hosted;
      login.hidden = !canConnect || !hosted;
      if (login.hidden) login.reset();
      retry.hidden = !canRetry;
      signOut.hidden = !signedIn;
      onAccess(granted, previousId);
    }

    function showSignedOut() {
      render({
        message: hosted ? "Connecte-toi avec ton compte administrateur RouteStop." :
          "Connecte-toi avec ton compte administrateur RouteStop, puis reviens ici.",
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

        const userId = session.user.id;
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
          render({ message: "Impossible de vérifier la connexion. Réessaie dans un instant.", canRetry: true });
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
      if (access?.userId === nextId && nextId) return;
      if (access) {
        revision++;
        render({ message: "Vérification de la connexion…" });
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
      render({ message: "Vérification de la connexion…" });
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) scheduleRefresh();
    });
  }

  window.StudioAdmin = { client, mount };
})();
