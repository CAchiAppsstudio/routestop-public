(() => {
  const { client, mount } = window.StudioAdmin;
  const select = (selector, root = document) => root.querySelector(selector);
  const incidentList = select("[data-incidents]");
  const releaseList = select("[data-releases]");
  const downloadGrid = select("[data-downloads]");
  const incidentStatus = select("[data-incidents-status]");
  const releaseStatus = select("[data-releases-status]");
  const downloadStatus = select("[data-downloads-status]");
  const pager = select("[data-incident-pagination]");
  const previous = select("[data-previous]");
  const next = select("[data-next]");
  const newIncident = select("[data-new-incident]");
  const releaseForm = select("[data-release]");
  const downloadForm = select("[data-download]");
  const incidentTemplate = select("#incident-template");
  const requests = new WeakMap();
  const pageSize = 10;
  const platformNames = { ios: "iPhone", mac: "Mac", both: "iPhone et Mac" };
  const themes = {
    playback: "Lecture et volume", resume: "Reprise de lecture", access: "Accès Apple Music",
    interface: "Interface et molette", other: "Autre",
  };
  const states = {
    open: "À analyser", investigating: "En cours", resolved: "Corrigé",
    testing: "En test", preparing: "En préparation", submitted: "Soumise", published: "Publiée", archived: "Archivée",
  };
  const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeZone: "Europe/Paris" });
  const dateInputFormat = new Intl.DateTimeFormat("fr-FR", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris",
  });
  const numberFormat = new Intl.NumberFormat("fr-FR");
  let account = null;
  let unsavedIncidentId = null;
  let incidentPage = 0;

  function element(tag, content = "", className = "") {
    const el = document.createElement(tag);
    el.textContent = content;
    el.className = className;
    return el;
  }

  function formatDate(value) {
    return dateFormat.format(new Date(value));
  }

  function formFeedback(form, message = "", state = "") {
    const status = select("[role=status]", form);
    status.textContent = message;
    status.className = state ? "message " + state : "message";
    status.hidden = !message;
  }

  function setDateLimits(form, reset = false) {
    const input = form.elements.namedItem("observed_on");
    if (!input) return;
    const parts = dateInputFormat.formatToParts(new Date());
    const today = ["year", "month", "day"].map(unit => parts.find(part => part.type === unit).value).join("-");
    input.max = today;
    if (reset || !input.value) input.value = today;
  }

  function bindForm(form, save, afterSave, reset = true) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!account) return;

      setDateLimits(form);
      if (!form.reportValidity()) return;
      const expected = account;
      const button = select('button[type="submit"]', form);
      if (button.disabled) return;
      const values = Object.fromEntries(new FormData(form));
      for (const name in values) values[name] = values[name].trim();
      if ([...form.querySelectorAll("[required]")].some(input => !values[input.name])) {
        formFeedback(form, "Renseigne tous les champs obligatoires.", "warning");
        return;
      }

      button.disabled = true;
      formFeedback(form, "Enregistrement…");
      try {
        const { data, error } = await save(values, expected.id);
        if (account !== expected) return;
        if (error) throw error;
        if (reset) {
          form.reset();
          setDateLimits(form, true);
        }
        formFeedback(form, "Enregistré.", "success");
        afterSave(data);
      } catch {
        if (account === expected) {
          formFeedback(form, "Impossible d’enregistrer. Vérifie les champs et réessaie.", "warning");
        }
      } finally {
        if (account === expected) button.disabled = false;
      }
    });
  }

  async function readPanel({ status, loading, query, render, failure }) {
    if (!account) return;
    const expected = account;
    const request = Symbol();
    requests.set(status, request);
    status.textContent = loading;
    try {
      const result = await query(expected.id);
      if (account !== expected || requests.get(status) !== request) return;
      if (result.error) throw result.error;
      render(result.data, result.count);
    } catch {
      if (account === expected && requests.get(status) === request) status.textContent = failure;
    }
  }

  function incidentRow(incident) {
    const row = incidentTemplate.content.firstElementChild.cloneNode(true);
    const form = select("form", row);
    const badge = select("[data-state]", row);
    select("[data-title]", row).textContent = incident.title;
    select("[data-metadata]", row).textContent = [
      platformNames[incident.platform], themes[incident.theme], incident.build, formatDate(incident.updated_at),
    ].filter(Boolean).join(" · ");
    select("[data-details]", row).textContent = incident.details;

    function showState(item) {
      badge.textContent = states[item.state];
      badge.className = "tag " + item.state;
      form.elements.state.value = item.state;
      form.elements.resolution.value = item.resolution;
    }

    showState(incident);
    bindForm(form, (values, ownerId) => client.from("studio_podlegacy_incidents")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("owner_id", ownerId).eq("id", incident.id).select("state,resolution").single(), showState, false);
    return row;
  }

  function loadIncidents(page = 0) {
    return readPanel({
      status: incidentStatus,
      loading: "Chargement des signalements…",
      query: ownerId => client.from("studio_podlegacy_incidents")
        .select("id,title,platform,theme,build,details,state,resolution,updated_at", { count: "exact" })
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false }).order("id", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1),
      render(incidents, count) {
        incidentPage = page;
        incidentList.replaceChildren(...incidents.map(incidentRow));
        incidentStatus.textContent = count === 0 ? "Aucun signalement pour le moment." :
          numberFormat.format(count) + (count === 1 ? " signalement" : " signalements");
        const pageCount = Math.ceil(count / pageSize);
        pager.hidden = pageCount < 2;
        previous.disabled = page === 0;
        next.disabled = page + 1 >= pageCount;
        select("[data-incident-page]").textContent = "Page " + (page + 1) + " sur " + pageCount;
      },
      failure: "Impossible de charger les signalements. Actualise la page pour réessayer.",
    });
  }

  async function perPlatform(query) {
    const [ios, mac] = await Promise.all([query("ios"), query("mac")]);
    return { data: { ios: ios.data, mac: mac.data }, error: ios.error ?? mac.error };
  }

  function loadReleases() {
    return readPanel({
      status: releaseStatus,
      loading: "Chargement des versions…",
      query: ownerId => perPlatform(platform => client.from("studio_podlegacy_releases")
        .select("platform,version,build,state,observed_on,note").eq("owner_id", ownerId).eq("platform", platform)
        .order("observed_on", { ascending: false }).order("updated_at", { ascending: false }).limit(4)),
      render(result) {
        const releases = [...result.ios, ...result.mac]
          .sort((first, second) => second.observed_on.localeCompare(first.observed_on));
        releaseStatus.textContent = releases.length ? "" : "Aucune version consignée.";
        releaseList.replaceChildren(...releases.map(release => {
          const row = element("li");
          const header = element("div", "", "record-header");
          header.append(
            element("strong", platformNames[release.platform] + " " + release.version + " (" + release.build + ")"),
            element("span", states[release.state], "tag " + release.state),
          );
          row.append(header, element("span", "Relevé du " + formatDate(release.observed_on), "detail-line"));
          if (release.note) row.append(element("p", release.note, "preserve"));
          return row;
        }));
      },
      failure: "Impossible de charger les versions. Actualise la page pour réessayer.",
    });
  }

  function loadDownloads() {
    return readPanel({
      status: downloadStatus,
      loading: "Chargement des relevés…",
      query: ownerId => perPlatform(platform => client.from("studio_podlegacy_downloads")
        .select("observed_on,first_downloads").eq("owner_id", ownerId).eq("platform", platform)
        .order("observed_on", { ascending: false }).limit(6)),
      render(result) {
        downloadStatus.textContent = "Premiers téléchargements cumulés.";
        downloadGrid.replaceChildren(...Object.entries(result).map(([platform, records]) => {
          const box = element("div", "", "download-box");
          box.append(element("strong", platformNames[platform]));
          const [latest, ...history] = records;
          if (!latest) {
            box.append(element("span", "Aucun relevé", "detail-line"));
            return box;
          }

          box.append(
            element("strong", numberFormat.format(latest.first_downloads), "download-number"),
            element("span", "Au " + formatDate(latest.observed_on), "detail-line"),
          );
          if (history.length) {
            const list = element("ul");
            const details = element("details", "", "download-history");
            for (const record of history) {
              list.append(element("li", formatDate(record.observed_on) + " · " + numberFormat.format(record.first_downloads)));
            }
            details.append(element("summary", "Précédents relevés"), list);
            box.append(details);
          }
          return box;
        }));
      },
      failure: "Impossible de charger les relevés. Actualise la page pour réessayer.",
    });
  }

  bindForm(newIncident, (values, ownerId) => {
    // A retry after a lost response updates the same incident.
    unsavedIncidentId ??= crypto.randomUUID();
    return client.from("studio_podlegacy_incidents").upsert({
      ...values, owner_id: ownerId, id: unsavedIncidentId,
    }, { onConflict: "id" });
  }, () => {
    unsavedIncidentId = null;
    loadIncidents();
  });

  bindForm(releaseForm, (values, ownerId) => client.from("studio_podlegacy_releases")
    .upsert({ ...values, owner_id: ownerId, updated_at: new Date().toISOString() },
      { onConflict: "owner_id,platform,version,build" }), loadReleases);

  bindForm(downloadForm, (values, ownerId) => client.from("studio_podlegacy_downloads")
    .upsert({ ...values, owner_id: ownerId, first_downloads: Number(values.first_downloads) },
      { onConflict: "owner_id,platform,observed_on" }), loadDownloads);

  previous.addEventListener("click", () => loadIncidents(incidentPage - 1));
  next.addEventListener("click", () => loadIncidents(incidentPage + 1));

  mount({
    onAccess(access) {
      if (account?.id === access?.userId) return;
      account = access ? { id: access.userId } : null;
      unsavedIncidentId = null;
      for (const container of [incidentList, releaseList, downloadGrid]) container.replaceChildren();
      for (const status of [incidentStatus, releaseStatus, downloadStatus]) status.textContent = "";
      pager.hidden = true;
      for (const form of [newIncident, releaseForm, downloadForm]) {
        form.reset();
        formFeedback(form);
        setDateLimits(form, true);
        select('button[type="submit"]', form).disabled = false;
      }
      if (!account) return;
      loadIncidents();
      loadReleases();
      loadDownloads();
    },
  });
})();
