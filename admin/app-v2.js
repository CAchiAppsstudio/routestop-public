(() => {
  const CONFIG_KEY = 'routestop_admin_supabase_v1';
  const ACTIVE_SYNC_STATUSES = new Set(['requested', 'running']);
  const ACTIVE_RELEASE_STATUSES = new Set([
    'requested', 'checking', 'publishing', 'running', 'waiting_review', 'in_review',
  ]);
  const OSM_REGIONS = [
    'north_1', 'north_2a', 'north_2b', 'north_3a1', 'north_3a2', 'north_3b', 'north_4', 'north_5',
    'center_1', 'center_2', 'center_3a', 'center_3b', 'center_4',
    'south_1', 'south_2', 'south_3', 'south_4',
  ];
  const REGION_LABELS = {
    north_1: 'Bretagne ouest',
    north_2: 'Bretagne est et Normandie',
    north_2a: 'Bretagne est et Normandie — Ouest',
    north_2b: 'Bretagne est et Normandie — Est',
    north_3a: 'Région parisienne ouest',
    north_3a1: 'Région parisienne ouest — Ouest',
    north_3a2: 'Région parisienne ouest — Est',
    north_3b: 'Région parisienne est et Champagne',
    north_4: 'Nord-Est',
    north_5: 'Alsace',
    center_1: 'Centre-Ouest',
    center_2: 'Centre',
    center_3: 'Centre-Est',
    center_3a: 'Centre-Est — Ouest',
    center_3b: 'Centre-Est — Est',
    center_4: 'Alpes du Nord',
    south_1: 'Sud-Ouest',
    south_2: 'Languedoc',
    south_3: 'Sud-Est',
    south_4: 'Corse et frontière italienne',
  };
  const APPLICABLE_OSM_REGIONS = OSM_REGIONS.filter(region => region !== 'north_1');
  const REPORT_TYPES = {
    brand_closed: 'Enseigne fermée',
    brand_missing: 'Enseigne manquante',
    wrong_brand: 'Mauvaise enseigne',
    service_closed: 'Service fermé',
    service_missing: 'Service manquant',
    wrong_price: 'Prix incorrect',
    other: 'Autre',
  };
  const REPORT_STATUSES = {
    pending: 'À traiter',
    reviewed: 'Traité',
    rejected: 'Rejeté',
  };
  const PAGE_SIZE = 20;
  const VIEW_TITLES = {
    home: ['L’essentiel', 'Accueil'],
    actions: ['Qualité', 'Signalements reçus'],
    links: ['Qualité', 'Prix à associer'],
    areas: ['Qualité', 'Accès à vérifier'],
    data: ['Fraîcheur des informations', 'Mises à jour des données'],
    releases: ['Suivi technique', 'Livraisons'],
    stats: ['Diffusion', 'Téléchargements'],
    maintenance: ['Suivi technique', 'Outils'],
  };
  const SUPABASE_PLAN_LIMITS = {
    free: {
      monthlyActiveUsers: 50000,
      databaseBytes: 500 * 1024 * 1024,
    },
  };
  const RESEND_PLAN_LIMITS = {
    free: {
      emailDailyUnits: 100,
      emailMonthlyUnits: 3000,
    },
  };
  const RESEND_USAGE_URL = 'https://resend.com/settings/usage';
  const EXPO_BUILDS_URL = 'https://expo.dev/accounts/cachiappsstudio/projects/routestop/builds';
  const QUOTA_WARNING_PERCENT = 70;
  const QUOTA_DANGER_PERCENT = 90;
  const SYNC_POLL_INTERVAL_MS = 10000;
  const SYNC_WAIT_TIMEOUT_MS = 180000;

  const state = {
    home: null,
    reports: [],
    data: null,
    fuelLinkCandidates: null,
    overrides: [],
    releases: [],
    analytics: null,
    analyticsDays: 30,
    operations: null,
    emailQuota: null,
    syncStatus: null,
    storeDownloads: null,
    bulkSync: {
      active: false,
      completed: 0,
      total: 0,
      region: null,
    },
    loaded: new Set(),
    loading: new Set(),
  };

  let client = null;
  let session = null;
  let activeView = window.location?.hash === '#aires' ? 'areas' : 'home';
  let statusFilter = 'pending';
  let search = '';
  let fuelLinkFilter = 'all';
  let fuelLinkSearch = '';
  let fuelLinkPage = 1;
  let reportsPage = 1;
  let dataScope = 'attention';
  let drawerOrigin = 'data';
  let realtimeChannel = null;
  let realtimeTimer = null;
  let activePoll = null;

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function safeExternalUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      return parsed.protocol === 'https:' ? parsed.toString() : '';
    } catch {
      return '';
    }
  }

  function readConfig() {
    const fromWindow = window.ROUTESTOP_SUPABASE ?? {};
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}');
      const plan = fromWindow.plan || saved.plan || 'free';
      const emailPlan = fromWindow.emailPlan || saved.emailPlan || 'free';
      return {
        url: fromWindow.url || saved.url || '',
        anonKey: fromWindow.anonKey || saved.anonKey || '',
        managed: fromWindow.managed === true,
        plan,
        limits: {
          ...(SUPABASE_PLAN_LIMITS[plan] ?? {}),
          ...(RESEND_PLAN_LIMITS[emailPlan] ?? {}),
          ...(saved.limits ?? {}),
          ...(fromWindow.limits ?? {}),
        },
        usageUrl: fromWindow.usageUrl || saved.usageUrl || '',
        emailPlan,
        emailUsageUrl: fromWindow.emailUsageUrl || saved.emailUsageUrl || RESEND_USAGE_URL,
      };
    } catch {
      const plan = fromWindow.plan || 'free';
      const emailPlan = fromWindow.emailPlan || 'free';
      return {
        url: fromWindow.url || '',
        anonKey: fromWindow.anonKey || '',
        managed: fromWindow.managed === true,
        plan,
        limits: {
          ...(SUPABASE_PLAN_LIMITS[plan] ?? {}),
          ...(RESEND_PLAN_LIMITS[emailPlan] ?? {}),
          ...(fromWindow.limits ?? {}),
        },
        usageUrl: fromWindow.usageUrl || '',
        emailPlan,
        emailUsageUrl: fromWindow.emailUsageUrl || RESEND_USAGE_URL,
      };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = value;
  }

  function setHidden(id, hidden) {
    const element = $(id);
    if (element) element.classList.toggle('hidden', hidden);
  }

  function showFeedback(message) {
    setText($('detail-drawer')?.open ? 'detail-feedback' : 'admin-feedback', message);
  }

  function initClient() {
    const config = readConfig();
    $('supabase-url').value = config.url;
    $('supabase-key').value = config.anonKey;
    if (!config.url || !config.anonKey) {
      setText('config-state', 'Renseigne les identifiants publics Supabase pour continuer.');
      return false;
    }
    if (!window.supabase?.createClient) {
      setText('config-state', 'Le client Supabase local n’a pas pu être chargé.');
      return false;
    }
    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    setText('config-state', 'Configuration prête.');
    return true;
  }

  async function boot() {
    bindEvents();
    if (!initClient()) return;
    const { data } = await client.auth.getSession();
    session = data.session;
    await renderSession();
    client.auth.onAuthStateChange(async (_event, nextSession) => {
      session = nextSession;
      await renderSession();
    });
  }

  function bindEvents() {
    $('config-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      saveConfig({
        url: $('supabase-url').value.trim(),
        anonKey: $('supabase-key').value.trim(),
      });
      initClient();
      await renderSession();
    });

    $('auth-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!client && !initClient()) return;
      setText('auth-state', 'Connexion en cours…');
      const { error } = await client.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value,
      });
      setText('auth-state', error ? error.message : '');
    });

    $('logout-btn').addEventListener('click', async () => {
      unsubscribeRealtime();
      if (client) await client.auth.signOut();
      session = null;
      clearState();
      await renderSession();
    });

    $('refresh-btn').addEventListener('click', () => loadView(activeView, true));
    $('tools-btn').addEventListener('click', handleNavigationAction);
    $('expand-drawer').addEventListener('click', () => setDrawerExpanded(!$('detail-drawer').classList.contains('is-expanded')));
    $('close-drawer').addEventListener('click', () => $('detail-drawer').close());
    $('detail-drawer').addEventListener('close', async () => {
      activeView = 'home';
      document.body.classList.remove('drawer-open');
      await loadView('home', false);
      document.querySelector('[data-go-view="' + drawerOrigin + '"]')?.focus();
    });

    $('status-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-status]');
      if (!button) return;
      statusFilter = button.dataset.status;
      reportsPage = 1;
      $('status-tabs').querySelectorAll('button').forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      renderReports();
    });

    $('search').addEventListener('input', (event) => {
      search = event.target.value.trim().toLowerCase();
      reportsPage = 1;
      renderReports();
    });

    $('home-view').addEventListener('click', handleNavigationAction);
    $('stats-view').addEventListener('submit', saveStoreDownloads);
    $('section-nav').addEventListener('click', handleNavigationAction);
    $('links-view').addEventListener('click', handleDataAction);
    $('links-view').addEventListener('input', handleDataInput);
    $('data-view').addEventListener('click', handleNavigationAction);
    $('actions-view').addEventListener('click', handleReportAction);
    $('data-view').addEventListener('click', handleDataAction);
    $('data-view').addEventListener('input', handleDataInput);
    $('releases-view').addEventListener('click', handleReleaseAction);
    $('stats-view').addEventListener('click', handleStatsAction);
    $('maintenance-view').addEventListener('click', handleMaintenanceAction);
  }

  function clearState() {
    state.home = null;
    state.reports = [];
    state.data = null;
    state.fuelLinkCandidates = null;
    state.overrides = [];
    state.releases = [];
    state.analytics = null;
    state.operations = null;
    state.emailQuota = null;
    state.syncStatus = null;
    state.storeDownloads = null;
    state.bulkSync = { active: false, completed: 0, total: 0, region: null };
    fuelLinkFilter = 'all';
    fuelLinkSearch = '';
    fuelLinkPage = 1;
    reportsPage = 1;
    dataScope = 'attention';
    $('detail-drawer')?.close();
    state.loaded.clear();
    state.loading.clear();
  }

  async function renderSession() {
    const email = session?.user?.email;
    setHidden('logout-btn', !session);
    setText('admin-state', email || 'Non connecté');
    $('admin-state').className = session ? 'pill success' : 'pill muted';
    setHidden('app-shell', true);
    setHidden('denied-panel', true);
    setHidden('auth-panel', !!session);
    setHidden('setup-panel', !!session || readConfig().managed);
    if (!client || !session) return;

    const { data, error } = await client.rpc('is_admin');
    if (error || data !== true) {
      setHidden('setup-panel', true);
      setHidden('denied-panel', false);
      $('admin-sql').textContent = error
        ? 'Vérifie les migrations Supabase puis recharge la page.'
        : `insert into public.admin_users (id)\nvalues ('${session.user.id}')\non conflict (id) do nothing;`;
      return;
    }

    setHidden('app-shell', false);
    subscribeRealtime();
    startActivePoll();
    await setView(activeView);
  }

  function setDrawerExpanded(expanded) {
    $('detail-drawer').classList.toggle('is-expanded', expanded);
    $('expand-drawer').setAttribute('aria-pressed', String(expanded));
    setText('expand-drawer', expanded ? 'Réduire ⛶' : 'Agrandir ⛶');
  }

  async function setView(view) {
    if (!VIEW_TITLES[view]) view = 'home';
    activeView = view;
    const drawer = $('detail-drawer');
    if (view === 'home') {
      if (drawer?.open) drawer.close();
      await loadView('home', false);
      return;
    }
    const group = ['links', 'areas'].includes(view) ? 'review' : ['maintenance', 'releases'].includes(view) ? 'tools' : '';
    document.querySelectorAll('#section-nav [data-group]').forEach(element => {
      element.classList.toggle('hidden', element.dataset.group !== group);
    });
    document.querySelectorAll('#section-nav [data-go-view]').forEach(button => {
      button.classList.toggle('active', button.dataset.goView === view);
      button.setAttribute('aria-current', button.dataset.goView === view ? 'page' : 'false');
    });
    setText('view-title', VIEW_TITLES[view][1]);
    setText('detail-feedback', '');
    document.querySelectorAll('#detail-drawer .view').forEach(panel => panel.classList.add('hidden'));
    $(`${view}-view`).classList.remove('hidden');
    if (!drawer.open) {
      drawerOrigin = view;
      if (view === 'data') dataScope = 'attention';
      setDrawerExpanded(['areas', 'links'].includes(view));
      drawer.showModal();
      document.body.classList.add('drawer-open');
    }
    await loadView(view, false);
    drawer.scrollTop = 0;
  }

  function loadingMarkup(label) {
    return `<div class="loading">Chargement de ${escapeHtml(label)}…</div>`;
  }

  function errorMarkup(message) {
    return `<div class="error-block">Impossible de charger cette partie. ${escapeHtml(message)}</div>`;
  }

  function viewRenderTarget(view) {
    return view === 'actions' ? $('reports-list') : $(`${view}-view`);
  }

  async function query(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }

  async function queryOptional(promise, fallback) {
    const { data, error } = await promise;
    if (error) return fallback;
    return data ?? fallback;
  }

  async function loadFuelLinkCandidates() {
    const current = await queryOptional(client.rpc('admin_fuel_link_candidates_v2'), null);
    if (current) return current;
    return queryOptional(
      client.rpc('admin_fuel_link_candidates_v1'),
      { unavailable: true, summary: {}, candidates: [] },
    );
  }

  async function loadView(view, force = false) {
    if (!client || !session || state.loading.has(view)) return;
    if (view === 'areas') {
      if (!window.RouteStopAreaReview) {
        $('areas-view').innerHTML = errorMarkup('Le dossier des aires est indisponible. Recharge la page.');
        showFeedback('Dossier non chargé.');
        return;
      }
      window.RouteStopAreaReview.mount($('areas-view'));
      showFeedback('Dossier du 18/10/2026 · lecture seule');
      return;
    }
    if (state.loaded.has(view) && !force) {
      renderView(view);
      return;
    }

    state.loading.add(view);
    const viewElement = viewRenderTarget(view);
    if (viewElement) viewElement.innerHTML = loadingMarkup(VIEW_TITLES[view][1].toLowerCase());
    showFeedback('Vérification…');

    try {
      if (view === 'home' || view === 'data') {
        state.syncStatus = await queryOptional(client.rpc('admin_sync_status_v1'), null);
      }
      if (view === 'home') {
        const [home, operations, emailQuota, downloads] = await Promise.all([
          query(client.rpc('admin_home_v2')),
          query(client.rpc('admin_operations_v1')),
          query(client.rpc('admin_email_quota_v1')),
          queryOptional(client.rpc('admin_store_downloads_v1'), null),
        ]);
        state.home = home;
        state.operations = operations;
        state.emailQuota = emailQuota;
        state.storeDownloads = downloads;
      } else if (view === 'actions') {
        state.reports = await query(client
          .from('station_reports')
          .select('id, station_id, station_name, station_brand, station_lat, station_lon, station_source, operator_source, report_type, target_label, details, snapshot, status, created_at, reviewed_at, review_note')
          .order('created_at', { ascending: false })
          .limit(250)) ?? [];
      } else if (view === 'data') {
        state.data = await query(client.rpc('admin_data_v2'));
      } else if (view === 'links') {
        const [overrides, fuelLinkCandidates] = await Promise.all([
          query(client
            .from('station_overrides')
            .select('id, station_id, station_name, station_brand, brand_override, fuels, services_add, services_remove, tenants_add, tenants_remove, hidden, note, is_active, updated_at')
            .order('updated_at', { ascending: false })
            .limit(200)),
          loadFuelLinkCandidates(),
        ]);
        state.overrides = overrides ?? [];
        state.fuelLinkCandidates = fuelLinkCandidates;
      } else if (view === 'releases') {
        state.releases = await query(client
          .from('app_release_runs')
          .select('id, kind, environment, channel, platform, version, build_number, runtime_version, status, progress, message, commit_sha, initiated_by, external_id, external_url, requested_at, started_at, finished_at, updated_at, error_summary')
          .order('updated_at', { ascending: false })
          .limit(100)) ?? [];
      } else if (view === 'stats') {
        state.storeDownloads = await queryOptional(client.rpc('admin_store_downloads_v1'), null);
      } else if (view === 'maintenance') {
        const [operations, emailQuota] = await Promise.all([
          query(client.rpc('admin_operations_v1')),
          query(client.rpc('admin_email_quota_v1')),
        ]);
        state.operations = operations;
        state.emailQuota = emailQuota;
      }
      state.loaded.add(view);
      renderView(view);
      showFeedback(`Consulté à ${formatTime(new Date().toISOString())}`);
    } catch (error) {
      const message = String(error?.message || 'Erreur inconnue');
      if (viewElement) viewElement.innerHTML = errorMarkup(message);
      showFeedback('Une partie n’a pas pu être chargée.');
    } finally {
      state.loading.delete(view);
    }
  }

  function renderView(view) {
    if (view === 'home') renderHome();
    else if (view === 'actions') renderReports();
    else if (view === 'data') renderData();
    else if (view === 'links') renderFuelLinks();
    else if (view === 'releases') renderReleases();
    else if (view === 'stats') renderStats();
    else if (view === 'maintenance') renderMaintenance();
  }

  function handleNavigationAction(event) {
    const button = event.target.closest('[data-go-view]');
    if (button) setView(button.dataset.goView);
  }

  function renderHome() {
    const payload = state.home;
    if (!payload) {
      $('home-view').innerHTML = loadingMarkup('l’accueil');
      return;
    }
    const rows = currentSyncRows(payload.data?.latestSyncs);
    const syncKnown = Array.isArray(state.syncStatus?.runs) || Array.isArray(payload.data?.latestSyncs);
    const pendingSyncs = rows.filter(run => !isNotApplicable(run) && !isSyncDataFresh(run)).length;
    const recentFailures = rows.filter(run => isSyncDataFresh(run) && ['error', 'partial'].includes(run.status) && !run.metadata?.deferred).length;
    const recentWaiting = rows.filter(run => isSyncDataFresh(run) && run.metadata?.deferred).length;
    const pendingReports = payload.reports?.pending;
    const dossierCount = window.RouteStopAreaReviewData?.pending?.length;
    const downloads = storeDownloadSummary(state.storeDownloads);
    const count = value => value == null ? '—' : formatNumber(value);
    const cards = [
      {
        view: 'data', icon: '↻', label: 'Données à actualiser', value: syncKnown ? count(pendingSyncs) : '—',
        detail: !syncKnown ? 'État à vérifier' : `${pendingSyncs ? 'sources anciennes ou non vérifiées' : 'Toutes les sources sont récentes'}${recentFailures ? ` · ${recentFailures} essai${recentFailures > 1 ? 's' : ''} échoué${recentFailures > 1 ? 's' : ''} sur des données récentes` : ''}${recentWaiting ? ` · ${recentWaiting} reprise${recentWaiting > 1 ? 's' : ''} en attente sur des données récentes` : ''}`,
        action: 'Voir les zones et relancer', tone: syncKnown && pendingSyncs ? 'attention' : '',
      },
      {
        view: 'actions', icon: '✉', label: 'Signalements reçus', value: count(pendingReports),
        detail: pendingReports == null ? 'Nombre non disponible' : pendingReports ? 'en attente de ta réponse' : 'Aucun signalement en attente',
        action: 'Lire et traiter', tone: '',
      },
      {
        view: 'areas', icon: '◇', label: 'Aires à vérifier', value: count(dossierCount),
        detail: dossierCount == null ? 'Dossier non disponible' : 'dossiers d’accès en attente',
        action: 'Vérifier les accès et les prix', tone: '',
      },
      {
        view: 'stats', icon: '↓', label: 'Téléchargements', value: count(downloads.total),
        detail: downloads.total === null ? 'Relevés à compléter' : `Relevés au ${formatDateOnly(downloads.ios.asOf)} · manuels`,
        action: 'Voir iPhone et Android', tone: 'downloads',
      },
    ];
    const technicalAlerts = buildHomeTasks(payload).filter(task => ['maintenance', 'releases'].includes(task.view));
    setText('tools-alert', technicalAlerts.length ? `· ${technicalAlerts.length} alerte(s)` : '');
    $('home-view').innerHTML = `
      ${renderQuotaOverview()}
      <div class="dashboard-grid">
        ${cards.map(card => `<button type="button" class="dashboard-tile ${card.tone}" data-go-view="${card.view}" aria-haspopup="dialog">
          <span class="tile-top"><span class="tile-icon" aria-hidden="true">${card.icon}</span><span class="tile-label">${escapeHtml(card.label)}</span></span>
          <span class="tile-value">${escapeHtml(card.value)}</span>
          <span class="tile-detail">${escapeHtml(card.detail)}</span>
          <span class="tile-action">${escapeHtml(card.action)} <span aria-hidden="true">→</span></span>
        </button>`).join('')}
      </div>
    `;
  }

  function kpiCard(label, value, detail) {
    return `<article class="kpi-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumberOrText(value))}</strong><small>${escapeHtml(detail)}</small></article>`;
  }

  function storeDownloadSummary(payload) {
    const rows = Array.isArray(payload?.platforms) ? payload.platforms : [];
    const valid = platform => rows.find(row => row.platform === platform && row.firstDownloads !== null
      && Number.isSafeInteger(Number(row.firstDownloads)) && Number(row.firstDownloads) >= 0
      && /^\d{4}-\d{2}-\d{2}$/.test(row.periodStart) && /^\d{4}-\d{2}-\d{2}$/.test(row.asOf));
    const ios = valid('ios');
    const android = valid('android');
    const samePeriod = ios && android && ios.periodStart === android.periodStart && ios.asOf === android.asOf;
    const total = samePeriod ? Number(ios.firstDownloads) + Number(android.firstDownloads) : null;
    return { ios, android, total: Number.isSafeInteger(total) ? total : null };
  }

  function renderStoreDownloads() {
    const summary = storeDownloadSummary(state.storeDownloads);
    const details = row => row ? `${formatDateOnly(row.periodStart)} → ${formatDateOnly(row.asOf)} · relevé manuel`
      : 'Rapport du store à renseigner';
    return `<section class="card downloads-panel">
      <p class="hint">Premiers téléchargements · relevés manuels</p>
      <div class="download-strip platform-breakdown">
        <div><strong>iPhone · ${summary.ios ? formatNumber(summary.ios.firstDownloads) : '—'}</strong><p class="hint">${escapeHtml(details(summary.ios))}</p></div>
        <div><strong>Android · ${summary.android ? formatNumber(summary.android.firstDownloads) : '—'}</strong><p class="hint">${escapeHtml(details(summary.android))}</p></div>
      </div>
      ${summary.total === null ? '<p class="hint">Total indisponible : deux relevés sur la même période sont nécessaires.</p>' : ''}
      <details class="small-help"><summary>Que comptent ces chiffres ?</summary><p class="hint">Mises à jour et réinstallations exclues. Une personne présente sur les deux plateformes peut compter deux fois. Ce total n’est pas un nombre d’utilisateurs uniques et ne s’actualise pas automatiquement.</p></details>
      <details class="download-entry"><summary>Mettre à jour un relevé</summary>
        <p class="hint">Apple : « Premiers téléchargements » ou « Unités » dans Tendances, filtrées sur RouteStop. Google : « Acquisition d’utilisateurs » → « Nouveaux utilisateurs ». Choisir tous les pays et la même période. Pour un total depuis le lancement, prendre une date de début antérieure au lancement des deux versions. Ne pas utiliser « Audience ayant installé l’application ». Chaque store conserve son fuseau de reporting.</p>
        <div class="store-links"><a class="ghost" href="https://appstoreconnect.apple.com/trends" target="_blank" rel="noopener noreferrer">Ouvrir App Store Connect</a>
        <a class="ghost" href="https://play.google.com/console/u/0/developers/5130624800963001569/app/4974573420398337108/statistics" target="_blank" rel="noopener noreferrer">Ouvrir Google Play</a></div>
        <form data-store-downloads class="store-download-form">
          <label>Plateforme<select name="platform" required><option value="ios">iPhone</option><option value="android">Android</option></select></label>
          <label>Du<input name="periodStart" type="date" required></label>
          <label>Au (journée complète)<input name="asOf" type="date" required></label>
          <label>Premiers téléchargements<input name="count" type="number" min="0" max="9007199254740991" step="1" required></label>
          <label class="checkline"><input name="verified" type="checkbox" required>Chiffre vérifié dans le store, tous pays, hors mises à jour et réinstallations.</label>
          <button type="submit" ${state.storeDownloads ? '' : 'disabled'}>Enregistrer le relevé</button>
        </form>
      </details>
    </section>`;
  }

  function formatDateOnly(value) {
    return new Date(`${value}T12:00:00Z`).toLocaleDateString('fr-FR');
  }

  async function saveStoreDownloads(event) {
    const form = event.target.closest('[data-store-downloads]');
    if (!form) return;
    event.preventDefault();
    const fields = new FormData(form);
    const count = Number(fields.get('count'));
    if (!Number.isSafeInteger(count) || count < 0 || !fields.get('verified')) return;
    if (!window.confirm(`Enregistrer ${count} premiers téléchargements pour ${fields.get('platform')} du ${fields.get('periodStart')} au ${fields.get('asOf')} ?`)) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await query(client.rpc('admin_record_store_downloads_v1', {
        p_platform: fields.get('platform'), p_period_start: fields.get('periodStart'),
        p_as_of: fields.get('asOf'), p_first_downloads: count,
      }));
      invalidate('home', 'stats');
      await loadView('stats', true);
      showFeedback('Relevé enregistré. La date de couverture reste affichée.');
    } catch {
      showFeedback('Relevé non enregistré. Vérifie les dates (pas de journée en cours) et ta connexion.');
      button.disabled = false;
    }
  }

  function buildHomeTasks(payload) {
    const tasks = [];
    const reports = payload.reports ?? {};
    const data = payload.data ?? {};
    const releases = payload.releases ?? {};
    const operations = payload.operations ?? {};
    const latestSyncs = currentSyncRows(data.latestSyncs);
    const errors = latestSyncs.filter(isActionableDataRun);
    const transientErrors = latestSyncs.filter(isAutomaticRetryPending);
    const partials = latestSyncs.filter((item) => item.status === 'partial');

    if (Number(reports.pending) > 0) {
      tasks.push({
        icon: String(Math.min(99, Number(reports.pending))),
        tone: 'warning',
        title: `${formatNumber(reports.pending)} signalement${Number(reports.pending) > 1 ? 's' : ''} à décider`,
        text: 'Traiter, corriger ou rejeter depuis une seule file.',
        view: 'actions',
        action: 'Ouvrir',
      });
    }
    if (errors.length) {
      tasks.push({
        icon: '!',
        tone: 'danger',
        title: `${errors.length} source${errors.length > 1 ? 's' : ''} à vérifier`,
        text: 'Données anciennes, collecte incomplète ou échec : vérifie le détail avant de relancer.',
        view: 'data',
        action: 'Vérifier',
      });
    }
    if (transientErrors.length) {
      tasks.push({
        icon: '↻',
        tone: 'warning',
        title: `${transientErrors.length} reprise${transientErrors.length > 1 ? 's' : ''} automatique${transientErrors.length > 1 ? 's' : ''} prévue${transientErrors.length > 1 ? 's' : ''}`,
        text: 'La source publique a été trop lente. Une relance automatique est prévue sans supprimer les anciennes données.',
        view: 'data',
        action: 'Suivre',
      });
    } else if (!errors.length && partials.length) {
      tasks.push({
        icon: '•',
        tone: 'warning',
        title: `${partials.length} source${partials.length > 1 ? 's' : ''} partielle${partials.length > 1 ? 's' : ''}`,
        text: 'Certaines sources publiques n’ont pas répondu, sans perte des données précédentes.',
        view: 'data',
        action: 'Comprendre',
      });
    }
    if ((data.activeRuns ?? []).length) {
      tasks.push({
        icon: '↻',
        tone: '',
        title: 'Mise à jour des données en cours',
        text: 'Le résultat se mettra à jour automatiquement.',
        view: 'data',
        action: 'Suivre',
      });
    }
    if (releases.latest && ['failed', 'rejected'].includes(releases.latest.status)) {
      tasks.push({
        icon: '!',
        tone: 'danger',
        title: 'Dernière version en échec',
        text: releases.latest.errorSummary || releases.latest.message || 'Consulte le détail de la livraison.',
        view: 'releases',
        action: 'Ouvrir',
      });
    } else if (releases.latest && ACTIVE_RELEASE_STATUSES.has(releases.latest.status)) {
      tasks.push({
        icon: '↑',
        tone: '',
        title: isStaleRelease(releases.latest) ? 'Ancien suivi de livraison à vérifier' : 'Livraison en cours de traitement',
        text: releaseStatusText(releases.latest),
        view: 'releases',
        action: 'Suivre',
      });
    }
    if (Number(operations.emailFailures7d) > 0) {
      tasks.push({
        icon: '@',
        tone: 'danger',
        title: `${formatNumber(operations.emailFailures7d)} e-mail${Number(operations.emailFailures7d) > 1 ? 's' : ''} non livré${Number(operations.emailFailures7d) > 1 ? 's' : ''}`,
        text: 'Échec, rebond ou blocage détecté sur les sept derniers jours.',
        view: 'maintenance',
        action: 'Vérifier',
      });
    }
    const capacity = getSupabaseCapacity(state.operations);
    const quotaWarnings = capacity.metrics.filter((metric) => metric.percent >= QUOTA_WARNING_PERCENT);
    if (quotaWarnings.length) {
      const critical = quotaWarnings.some((metric) => metric.percent >= QUOTA_DANGER_PERCENT);
      tasks.push({
        icon: '%',
        tone: critical ? 'danger' : 'warning',
        title: critical ? 'Quota Supabase presque atteint' : 'Capacité Supabase à surveiller',
        text: quotaWarnings.map((metric) => `${metric.shortLabel} ${formatPercent(metric.percent)}`).join(' · '),
        view: 'maintenance',
        action: 'Vérifier',
      });
    }
    const emailCapacity = getEmailCapacity(state.emailQuota);
    const emailQuotaWarnings = emailCapacity.metrics.filter((metric) => metric.percent >= QUOTA_WARNING_PERCENT);
    if (emailQuotaWarnings.length) {
      const critical = emailQuotaWarnings.some((metric) => metric.percent >= QUOTA_DANGER_PERCENT);
      tasks.push({
        icon: '@',
        tone: critical ? 'danger' : 'warning',
        title: critical ? 'Quota e-mail presque atteint' : 'Quota e-mail à surveiller',
        text: emailQuotaWarnings.map((metric) => `${metric.shortLabel} ${formatPercent(metric.percent)}`).join(' · '),
        view: 'maintenance',
        action: 'Vérifier',
      });
    }
    return tasks;
  }

  function renderTask(task) {
    return `
      <div class="task-row">
        <span class="row-icon ${escapeHtml(task.tone)}">${escapeHtml(task.icon)}</span>
        <div><strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(task.text)}</p></div>
        <button class="ghost small" data-go-view="${escapeHtml(task.view)}" type="button">${escapeHtml(task.action)}</button>
      </div>
    `;
  }

  function renderLatestRelease(release) {
    if (!release) {
      return `<div class="empty">Le suivi est prêt. La prochaine commande de mise à jour apparaîtra ici en direct.</div>`;
    }
    const tone = releaseTone(release.status);
    const label = releaseLabel(release);
    return `
      <div class="compact-row">
        <span class="row-icon ${tone}">↑</span>
        <div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(release.message || releaseStatusText(release))} · ${escapeHtml(relativeDate(release.updatedAt))}</p></div>
        <span class="pill ${tone}">${escapeHtml(releaseStatusText(release))}</span>
      </div>
    `;
  }

  function renderHomeSources(rows) {
    const fuel = rows.find((row) => row.source === 'fuel_prices_gov');
    const official = rows.find((row) => row.source === 'service_areas_operator');
    const osm = rows.filter((row) => row.source === 'service_areas_osm');
    return [
      homeSourceRow('Prix carburant', fuel, 'Source gouvernementale'),
      homeSourceRow('Aires officielles', official, 'VINCI, APRR et SANEF'),
      homeOsmRow(osm),
    ].join('');
  }

  function homeSourceRow(title, run, detail) {
    const tone = syncRunTone(run);
    const lastSuccess = run?.lastSuccessfulAt || (run?.status === 'success' ? run.finishedAt : null);
    return `
      <div class="source-row">
        <span class="row-icon ${tone}">${tone === 'success' ? '✓' : run ? '!' : '?'}</span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)} · Collecte complète : ${lastSuccess ? escapeHtml(formatDate(lastSuccess)) : 'non connue'}</p></div>
        <span class="pill ${tone}">${escapeHtml(syncRunStatusLabel(run))}</span>
      </div>
    `;
  }

  function homeOsmRow(runs) {
    const successes = runs.filter(isSyncDataFresh).length;
    const errors = runs.filter((run) => run.status === 'error' && !isAutomaticRetryPending(run)).length;
    const transientErrors = runs.filter(isAutomaticRetryPending).length;
    const partials = runs.filter((run) => run.status === 'partial').length;
    const tone = errors ? 'danger' : transientErrors || partials || successes < APPLICABLE_OSM_REGIONS.length ? 'warning' : 'success';
    const toFollow = APPLICABLE_OSM_REGIONS.length - successes;
    return `
      <div class="source-row">
        <span class="row-icon ${tone}">${tone === 'success' ? '✓' : '!'}</span>
        <div><strong>Restaurants et services</strong><p>${successes}/${APPLICABLE_OSM_REGIONS.length} secteurs actualisés sous 48 h · 1 non applicable</p></div>
        <span class="pill ${tone}">${toFollow ? `${toFollow} zones à suivre` : errors ? 'Échec de tentative' : transientErrors ? 'Reprise prévue' : tone === 'success' ? 'À jour' : 'À suivre'}</span>
      </div>
    `;
  }

  function visibleReports() {
    return state.reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (!search) return true;
      return [
        report.station_name,
        report.station_brand,
        report.target_label,
        report.details,
        report.report_type,
        report.station_id,
      ].join(' ').toLowerCase().includes(search);
    });
  }

  function sortedOsmRegions(runs) {
    return [...APPLICABLE_OSM_REGIONS].sort((first, second) => {
      const timestamp = region => {
        const run = runs.find(item => item.region === region);
        return dateValue(run?.lastSuccessfulAt || (run?.status === 'success' ? run.finishedAt : null));
      };
      return timestamp(first) - timestamp(second) || REGION_LABELS[first].localeCompare(REGION_LABELS[second], 'fr');
    });
  }

  function renderFuelLinks() {
    $('links-view').innerHTML = `
      ${renderFuelLinkCandidatePanel()}
      <details class="card data-details">
        <summary><div><strong>Corrections administrateur existantes (${state.overrides.length})</strong><p>Réservé aux corrections confirmées : ces réglages peuvent affecter l’application.</p></div></summary>
        <div class="stack data-details-body">${state.overrides.length ? state.overrides.map(renderOverride).join('') : emptyInline('Aucune correction chargée.')}</div>
        ${state.overrides.length === 200 ? '<p class="hint">Les 200 dernières corrections sont chargées, pas un inventaire exhaustif.</p>' : ''}
      </details>
    `;
    applyFuelCandidateFilters();
  }

  function pageBounds(total, requestedPage) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.max(1, Math.min(pages, requestedPage));
    return { page, pages, start: (page - 1) * PAGE_SIZE, end: Math.min(page * PAGE_SIZE, total) };
  }

  function paginationMarkup(group) {
    return `<nav class="pagination" aria-label="Pages des ${group === 'fuel' ? 'correspondances' : 'signalements'}">
      <button class="ghost small" data-list-page="${group}" data-step="-1" type="button">← Précédent</button>
      <span id="${group}-page-label" role="status"></span>
      <button class="ghost small" data-list-page="${group}" data-step="1" type="button">Suivant →</button>
    </nav>`;
  }

  function updatePagination(group, bounds, total) {
    setText(`${group}-page-label`, `${total ? bounds.start + 1 : 0}–${bounds.end} sur ${total} · page ${bounds.page}/${bounds.pages}`);
    document.querySelectorAll(`[data-list-page="${group}"]`).forEach(button => {
      button.disabled = Number(button.dataset.step) < 0 ? bounds.page === 1 : bounds.page === bounds.pages;
    });
  }

  function applyReportPage() {
    const rows = Array.from(document.querySelectorAll('#reports-list .report'));
    const bounds = pageBounds(rows.length, reportsPage);
    reportsPage = bounds.page;
    rows.forEach((row, index) => row.classList.toggle('hidden', index < bounds.start || index >= bounds.end));
    updatePagination('reports', bounds, rows.length);
  }

  function renderReports() {
    const list = visibleReports();
    $('reports-list').innerHTML = `${paginationMarkup('reports')}
      ${state.reports.length === 250 ? '<p class="hint">Recherche limitée aux 250 derniers signalements chargés.</p>' : ''}
      ${list.length ? list.map(renderReport).join('') : '<div class="empty">Aucun signalement dans cette vue.</div>'}`;
    applyReportPage();
  }

  function renderReport(report) {
    const status = report.status || 'pending';
    const snapshot = report.snapshot && typeof report.snapshot === 'object' ? report.snapshot : {};
    const tenants = Array.isArray(snapshot.tenants) ? snapshot.tenants.slice(0, 6) : [];
    const services = Array.isArray(snapshot.services) ? snapshot.services.slice(0, 6) : [];
    const fuels = snapshot.fuels && typeof snapshot.fuels === 'object' ? snapshot.fuels : {};
    const hasCoordinates = Number.isFinite(report.station_lat) && Number.isFinite(report.station_lon);
    const coords = hasCoordinates ? `${report.station_lat.toFixed(5)}, ${report.station_lon.toFixed(5)}` : '';
    const mapsUrl = coords
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`
      : '';
    const fuelName = fuelFromTarget(report.target_label);
    const statusTone = reportStatusTone(status);

    return `
      <article class="report">
        <div class="report-top">
          <div>
            <div class="report-title">${escapeHtml(report.station_name)}</div>
            <div class="meta">
              <span>${escapeHtml(REPORT_TYPES[report.report_type] || report.report_type)}</span>
              <span>${escapeHtml(formatDate(report.created_at))}</span>
              ${report.station_brand ? `<span>${escapeHtml(report.station_brand)}</span>` : ''}
              ${report.operator_source ? `<span>${escapeHtml(String(report.operator_source).toUpperCase())}</span>` : ''}
            </div>
          </div>
          <span class="pill ${statusTone}">${escapeHtml(REPORT_STATUSES[status] || status)}</span>
        </div>

        <div class="report-copy">
          <strong>${escapeHtml(report.target_label || REPORT_TYPES[report.report_type] || 'Signalement')}</strong>
          ${escapeHtml(report.details || 'Aucun détail fourni.')}
        </div>

        <div class="chips">
          <span class="chip">ID ${escapeHtml(report.station_id)}</span>
          ${mapsUrl ? `<a class="chip" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Voir sur la carte</a>` : ''}
          ${Object.entries(fuels).slice(0, 4).map(([name, price]) => `<span class="chip">${escapeHtml(name)} ${escapeHtml(price)}</span>`).join('')}
          ${tenants.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}
          ${services.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}
        </div>

        <details class="advanced-editor" data-editor-id="${escapeHtml(report.id)}">
          <summary>Préparer une correction</summary>
          <div class="editor-body">
            <div class="correction-grid">
              <label>Marque correcte
                <input data-report-field="brandOverride" data-id="${escapeHtml(report.id)}" placeholder="Ex : TotalEnergies" />
              </label>
              <label>Carburant
                <input data-report-field="fuelName" data-id="${escapeHtml(report.id)}" value="${escapeHtml(fuelName)}" placeholder="SP95/E10" />
              </label>
              <label>Prix correct
                <input data-report-field="fuelPrice" data-id="${escapeHtml(report.id)}" type="number" step="0.001" min="0" max="5" placeholder="1.899" />
              </label>
              <label>Restaurants à ajouter
                <input data-report-field="tenantsAdd" data-id="${escapeHtml(report.id)}" placeholder="Paul, Starbucks" />
              </label>
              <label>Restaurants à retirer
                <input data-report-field="tenantsRemove" data-id="${escapeHtml(report.id)}" placeholder="Brioche Dorée" />
              </label>
              <label>Services à ajouter
                <input data-report-field="servicesAdd" data-id="${escapeHtml(report.id)}" placeholder="Douche, Wi-Fi" />
              </label>
              <label>Services à retirer
                <input data-report-field="servicesRemove" data-id="${escapeHtml(report.id)}" placeholder="WC" />
              </label>
              <label class="checkline">
                <input data-report-field="hidden" data-id="${escapeHtml(report.id)}" type="checkbox" />
                Masquer cette aire dans l’app
              </label>
            </div>
            <div class="review-box">
              <label>Note interne
                <textarea data-report-field="reviewNote" data-id="${escapeHtml(report.id)}" placeholder="Justification de la décision">${escapeHtml(report.review_note || '')}</textarea>
              </label>
            </div>
            <div class="report-actions">
              <button data-report-action="apply-correction" data-id="${escapeHtml(report.id)}" type="button">Appliquer la correction</button>
            </div>
          </div>
        </details>

        <div class="report-actions">
          ${status !== 'reviewed' ? `<button class="ghost" data-report-action="reviewed" data-id="${escapeHtml(report.id)}" type="button">Traiter sans modification</button>` : ''}
          ${status !== 'pending' ? `<button class="ghost" data-report-action="pending" data-id="${escapeHtml(report.id)}" type="button">Remettre à traiter</button>` : ''}
          ${status !== 'rejected' ? `<button class="ghost danger-text" data-report-action="rejected" data-id="${escapeHtml(report.id)}" type="button">Rejeter</button>` : ''}
        </div>
      </article>
    `;
  }

  async function handleReportAction(event) {
    const pageButton = event.target.closest('[data-list-page="reports"]');
    if (pageButton) {
      reportsPage += Number(pageButton.dataset.step);
      applyReportPage();
      return;
    }
    const button = event.target.closest('button[data-report-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.reportAction;
    if (!id || !action) return;
    button.disabled = true;
    try {
      if (action === 'apply-correction') {
        await applyReport(id, 'reviewed', buildOverridePayload(id));
      } else if (['pending', 'reviewed', 'rejected'].includes(action)) {
        await applyReport(id, action, {});
      }
    } catch {
      showFeedback('La décision n’a pas pu être enregistrée.');
    } finally {
      button.disabled = false;
    }
  }

  function fieldValue(id, field) {
    const element = document.querySelector(`[data-report-field="${field}"][data-id="${id}"]`);
    if (!element) return '';
    return element.type === 'checkbox' ? element.checked : element.value.trim();
  }

  function buildOverridePayload(id) {
    const payload = {};
    const brandOverride = fieldValue(id, 'brandOverride');
    const fuelName = fieldValue(id, 'fuelName');
    const fuelPrice = Number(fieldValue(id, 'fuelPrice'));
    const note = fieldValue(id, 'reviewNote');
    if (brandOverride) payload.brandOverride = brandOverride;
    if (fuelName && Number.isFinite(fuelPrice) && fuelPrice > 0 && fuelPrice < 5) {
      payload.fuels = { [fuelName]: fuelPrice };
      payload.fuelUpdatedAt = { [fuelName]: new Date().toISOString() };
    }
    for (const field of ['servicesAdd', 'servicesRemove', 'tenantsAdd', 'tenantsRemove']) {
      const list = splitList(fieldValue(id, field));
      if (list.length) payload[field] = list;
    }
    if (fieldValue(id, 'hidden') === true) payload.hidden = true;
    if (note) payload.note = note;
    return payload;
  }

  async function applyReport(id, status, payload) {
    showFeedback('Enregistrement de la décision…');
    const { error } = await client.rpc('admin_apply_report', {
      p_report_id: id,
      p_status: status,
      p_review_note: fieldValue(id, 'reviewNote'),
      p_override: payload,
    });
    if (error) throw error;
    invalidate('home', 'actions', 'data', 'links');
    await loadView('actions', true);
    showFeedback('Décision enregistrée.');
  }

  function needsSyncAttention(run) {
    return !isNotApplicable(run) && (!run || !isSyncDataFresh(run) || ACTIVE_SYNC_STATUSES.has(run.status)
      || ['error', 'partial', 'never'].includes(run.status) || isAutomaticRetryPending(run));
  }

  function renderData() {
    const payload = state.data;
    if (!payload) {
      $('data-view').innerHTML = loadingMarkup('des données');
      return;
    }
    const latest = currentSyncRows(payload.latestSyncs);
    const recent = Array.isArray(payload.recentRuns) ? payload.recentRuns : [];
    const counts = payload.counts ?? {};
    const fuel = latest.find((run) => run.source === 'fuel_prices_gov');
    const official = latest.find((run) => run.source === 'service_areas_operator');
    const osmRuns = latest.filter((run) => run.source === 'service_areas_osm');
    const activeRuns = latest.filter((run) => ACTIVE_SYNC_STATUSES.has(run.status));
    const actionableRuns = latest.filter((run) => isActionableDataRun(run) && !isMatchingSyncActive(run, activeRuns));
    const automaticRetries = latest.filter((run) => isAutomaticRetryPending(run) && !isMatchingSyncActive(run, activeRuns));
    const fuelActive = activeRuns.some((run) => run.source === 'fuel_prices_gov');
    const officialActive = activeRuns.some((run) => run.source === 'service_areas_operator');

    const shownRegions = sortedOsmRegions(osmRuns).filter(region => dataScope === 'all' || needsSyncAttention(osmRuns.find(run => run.region === region)));
    const showFuel = dataScope === 'all' || needsSyncAttention(fuel);
    const showOfficial = dataScope === 'all' || needsSyncAttention(official);

    $('data-view').innerHTML = `
      <div class="segmented data-scope" role="group" aria-label="Filtrer les mises à jour">
        <button data-data-scope="attention" class="${dataScope === 'attention' ? 'active' : ''}" type="button">À suivre</button>
        <button data-data-scope="all" class="${dataScope === 'all' ? 'active' : ''}" type="button">Toutes les sources</button>
      </div>
      ${renderDataActionPanel(actionableRuns, automaticRetries)}

      ${showFuel || showOfficial ? '<section class="source-grid sync-sources">' : ''}
        ${showFuel ? renderSyncCard({
          title: 'Prix carburant',
          description: 'Prix officiels du gouvernement.',
          run: fuel,
          target: 'fuel_prices',
          active: fuelActive,
        }) : ''}
        ${showOfficial ? renderSyncCard({
          title: 'Aires officielles',
          description: 'VINCI, APRR et SANEF.',
          run: official,
          target: 'service_areas',
          active: officialActive,
        }) : ''}

      ${showFuel || showOfficial ? '</section>' : ''}

      <section class="section-grid">
        <section class="card wide-card regions-panel" id="osm-zone-status">
          <div class="card-head">
            <div><h3>Zones de services</h3></div>
          </div>
          <div class="zone-list">
            ${shownRegions.length ? shownRegions.map(region => renderOsmZoneRow(region, osmRuns, activeRuns)).join('') : emptyInline('Aucune zone à relancer.')}
          </div>
          <details class="small-help"><summary>En savoir plus</summary><p>16 zones suivies. Bretagne ouest : hors filtre autoroutier actuel. Une tentative en échec ne remplace pas la date de la dernière collecte complète.</p></details>
        </section>

        <details class="card wide-card data-details">
          <summary>
            <div><strong>Historique technique</strong><p>Demandes manuelles, tâches planifiées et relances.</p></div>
            <span class="pill muted">${Math.min(recent.length, 24)} résultats</span>
          </summary>
          <div class="history-list data-details-body">
            ${recent.length ? recent.slice(0, 24).map(renderSyncHistory).join('') : emptyInline('Aucune synchronisation enregistrée.')}
          </div>
        </details>

        <details class="card wide-card data-details">
          <summary>
            <div><strong>Comprendre les chiffres</strong><p>Définitions des volumes techniques affichés dans l’administration.</p></div>
            <span class="pill muted">Définitions</span>
          </summary>
          <div class="data-definition-grid data-details-body">
            <article>
              <span>Fiches techniques d’aires</span>
              <strong>${formatNumber(counts.serviceAreas ?? 0)}</strong>
              <p>${formatNumber(counts.serviceAreasFuelSignal ?? 0)} avec carburant · ${formatNumber(counts.serviceAreasWithoutFuelSignal ?? 0)} sans carburant. Les fiches sont parfois séparées par sens et ne représentent pas des aires physiques uniques.</p>
            </article>
            <article>
              <span>Stations avec prix disponible</span>
              <strong>${formatNumber(counts.fuelPrices ?? 0)}</strong>
              <p>${formatNumber(counts.fuelPriceRows ?? counts.fuelPrices ?? 0)} lignes reçues, dont ${formatNumber(counts.fuelPrices ?? 0)} contiennent au moins un prix officiel exploitable.</p>
            </article>
            <article>
              <span>Aires reliées exactement aux prix</span>
              <strong>${formatNumber(counts.serviceAreasMatchedFuelPrice ?? 0)}</strong>
              <p>${formatNumber(counts.serviceAreasLinkedFuel ?? 0)} fiches possèdent un identifiant de station ; ${formatNumber(counts.serviceAreasMatchedFuelPrice ?? 0)} retrouvent actuellement une station avec un prix exploitable.</p>
            </article>
          </div>
        </details>

      </section>
    `;
  }

  function fuelCandidateCategory(candidate) {
    if (candidate.distanceM == null || candidate.distanceM === '') return 'far';
    const distance = Number(candidate.distanceM);
    if (!Number.isFinite(distance) || distance > 1000) return 'far';
    if (distance <= 150) return 'close';
    return 'review';
  }

  function fuelCandidateTone(category) {
    if (category === 'close') return 'success';
    if (category === 'review') return 'warning';
    return 'muted';
  }

  function fuelCandidateLabel(category) {
    if (category === 'close') return 'Très proche';
    if (category === 'review') return 'À vérifier';
    return 'Aire à identifier';
  }

  function formatCandidateDistance(value) {
    if (value == null || value === '') return 'Distance inconnue';
    const distance = Number(value);
    if (!Number.isFinite(distance)) return 'Distance inconnue';
    if (distance >= 1000) return `${(distance / 1000).toFixed(distance >= 10000 ? 0 : 1)} km`;
    return `${Math.round(distance)} m`;
  }

  function renderFuelPrices(fuels) {
    const entries = Object.entries(fuels ?? {})
      .filter(([, price]) => Number.isFinite(Number(price)))
      .sort(([left], [right]) => left.localeCompare(right, 'fr'));
    if (!entries.length) return '<span class="pill muted">Prix indisponible</span>';
    return entries.map(([fuel, price]) => `
      <span class="fuel-price-chip"><strong>${escapeHtml(fuel)}</strong>${Number(price).toFixed(3)} €</span>
    `).join('');
  }

  function renderFuelLinkAlternative(area, index) {
    const distance = formatCandidateDistance(area.distanceM);
    const route = [area.highway, area.direction].filter(Boolean).join(' · ');
    return `
      <div class="fuel-alternative ${index === 0 ? 'primary' : ''}">
        <span>${index === 0 ? 'Aire la plus proche' : `Alternative ${index + 1}`}</span>
        <strong>${escapeHtml(area.areaName || 'Nom d’aire indisponible')}</strong>
        <p>${escapeHtml(route || area.operatorSource || 'Autoroute et sens à vérifier')} · ${escapeHtml(distance)}</p>
      </div>
    `;
  }

  function fuelReviewChoice(candidate, alternatives) {
    const review = candidate.review && typeof candidate.review === 'object' ? candidate.review : null;
    if (!review?.areaId) return null;
    const matchingArea = alternatives.find((area) => area.areaId === review.areaId) ?? {};
    return {
      ...matchingArea,
      ...review,
      areaName: matchingArea.areaName || review.areaName || review.areaId,
    };
  }

  function renderFuelAreaOptions(alternatives, review) {
    const choices = [...alternatives];
    if (review && !choices.some((area) => area.areaId === review.areaId)) choices.unshift(review);
    return choices
      .filter((area) => area?.areaId)
      .map((area) => {
        const route = [area.highway, area.direction].filter(Boolean).join(' · ');
        const label = [
          area.areaName || area.areaId,
          route,
          formatCandidateDistance(area.distanceM),
        ].filter(Boolean).join(' — ');
        return `<option value="${escapeHtml(area.areaId)}" ${review?.areaId === area.areaId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      })
      .join('');
  }

  function renderFuelLinkCandidate(candidate) {
    const category = fuelCandidateCategory(candidate);
    const alternatives = Array.isArray(candidate.alternatives) ? candidate.alternatives : [];
    const review = fuelReviewChoice(candidate, alternatives);
    const best = alternatives[0] ?? {
      areaId: candidate.areaId,
      areaName: candidate.areaName,
      highway: candidate.highway,
      direction: candidate.direction,
      operatorSource: candidate.operatorSource,
      distanceM: candidate.distanceM,
    };
    const selectedArea = review ?? best;
    const stationTitle = candidate.city || candidate.address || `Station ${candidate.stationId}`;
    const route = [selectedArea.highway, selectedArea.direction].filter(Boolean).join(' · ');
    const searchable = [
      candidate.stationId, candidate.address, candidate.city, candidate.department, candidate.region,
      selectedArea.areaId, selectedArea.areaName, selectedArea.highway, selectedArea.direction, selectedArea.operatorSource,
      ...alternatives.flatMap((area) => [area.areaId, area.areaName, area.highway, area.direction]),
    ].filter(Boolean).join(' ').toLowerCase();
    const options = renderFuelAreaOptions(alternatives, review);

    return `
      <article class="fuel-candidate-row ${review ? 'saved' : ''}" data-fuel-candidate data-category="${category}" data-saved="${review ? 'true' : 'false'}" data-search="${escapeHtml(searchable)}">
        <div class="fuel-candidate-station">
          ${review
            ? `<span class="pill info">Choix enregistré · ${escapeHtml(formatCandidateDistance(review.distanceM))}</span>`
            : `<span class="pill ${fuelCandidateTone(category)}">${escapeHtml(fuelCandidateLabel(category))} · ${escapeHtml(formatCandidateDistance(candidate.distanceM))}</span>`}
          <strong>${escapeHtml(stationTitle)}</strong>
          <p>Station officielle ${escapeHtml(candidate.stationId)}${candidate.department ? ` · ${escapeHtml(candidate.department)}` : ''}</p>
        </div>
        <span class="fuel-candidate-arrow" aria-hidden="true">→</span>
        <div class="fuel-candidate-area">
          <span>${review ? 'Choix enregistré, non appliqué' : 'Aire proposée, non validée'}</span>
          <strong>${escapeHtml(selectedArea.areaName || 'Aire à identifier')}</strong>
          <p>${escapeHtml(route || selectedArea.operatorSource || 'Autoroute et sens à vérifier')}</p>
        </div>
        <details class="fuel-candidate-details" ${review ? 'open' : ''}>
          <summary>${review ? 'Modifier le choix enregistré' : 'Comparer et enregistrer un choix'}</summary>
          <div class="fuel-candidate-detail-grid">
            <div>
              <span class="detail-label">Prix officiels disponibles</span>
              <div class="fuel-price-list">${renderFuelPrices(candidate.fuels)}</div>
              <p class="fuel-address">${escapeHtml(candidate.address || 'Adresse officielle indisponible')}${candidate.region ? ` · ${escapeHtml(candidate.region)}` : ''}</p>
            </div>
            <div class="fuel-alternatives">
              ${alternatives.length ? alternatives.map(renderFuelLinkAlternative).join('') : '<p>Aucune fiche d’aire suffisamment proche n’a été trouvée.</p>'}
            </div>
          </div>
          <div class="fuel-review-editor">
            <div class="fuel-review-fields">
              <label>Aire à retenir
                <select data-fuel-area-choice ${options ? '' : 'disabled'}>${options || '<option>Aucune proposition disponible</option>'}</select>
              </label>
              <label>Note facultative
                <textarea data-fuel-review-note maxlength="500" placeholder="Pourquoi ce choix ?">${escapeHtml(review?.note || '')}</textarea>
              </label>
            </div>
            <div class="fuel-review-actions">
              <button data-save-fuel-review="${escapeHtml(candidate.stationId)}" type="button" ${options ? '' : 'disabled'}>${review ? 'Mettre à jour le choix' : 'Enregistrer ce choix'}</button>
              ${review ? `<button class="ghost" data-clear-fuel-review="${escapeHtml(candidate.stationId)}" type="button">Annuler le choix</button>` : ''}
              <p>Cette décision reste en attente et ne change rien dans l’application.</p>
            </div>
          </div>
          <p class="fuel-candidate-warning">Vérifie le nom, l’autoroute et le sens : la proximité seule ne prouve pas qu’il s’agit de la bonne aire.</p>
        </details>
      </article>
    `;
  }

  function renderFuelLinkCandidatePanel() {
    const payload = state.fuelLinkCandidates;
    if (!payload || payload.unavailable) {
      return `
        <section class="fuel-link-panel">
          <div class="fuel-link-head">
            <div><p class="eyebrow">Couverture carburant</p><h3>Correspondances à vérifier</h3><p>Cette analyse en lecture seule n’est pas encore disponible. Le reste de l’administration continue de fonctionner normalement.</p></div>
            <span class="pill muted">Indisponible</span>
          </div>
        </section>
      `;
    }

    const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    const summary = payload.summary ?? {};
    const savedCount = Number(summary.savedForReview)
      || candidates.filter((item) => item.review?.areaId).length;

    return `
      <section class="fuel-link-panel" id="fuel-link-candidates">
        <div class="fuel-link-head">
          <div>
            <p class="eyebrow">Couverture carburant</p>
            <h3>Correspondances à vérifier</h3>
            <p>${formatNumber(candidates.length)} propositions à examiner. Enregistrer un choix ne change pas l’application.</p>
          </div>
          <span class="pill info">Préparation sans activation</span>
        </div>
        <p class="hint">${formatNumber(savedCount)} choix préparé${savedCount === 1 ? '' : 's'} · Les propositions ne sont pas des erreurs confirmées.</p>
        <div class="fuel-link-toolbar">
          <div class="filter-tabs" role="group" aria-label="Filtrer les correspondances">
            <button class="${fuelLinkFilter === 'all' ? 'active' : ''}" data-fuel-link-filter="all" type="button">Toutes</button>
            <button class="${fuelLinkFilter === 'saved' ? 'active' : ''}" data-fuel-link-filter="saved" type="button">Enregistrées</button>
            <button class="${fuelLinkFilter === 'close' ? 'active' : ''}" data-fuel-link-filter="close" type="button">Très proches</button>
            <button class="${fuelLinkFilter === 'review' ? 'active' : ''}" data-fuel-link-filter="review" type="button">À vérifier</button>
            <button class="${fuelLinkFilter === 'far' ? 'active' : ''}" data-fuel-link-filter="far" type="button">Éloignées</button>
          </div>
          <label class="fuel-link-search">Rechercher<input data-fuel-link-search value="${escapeHtml(fuelLinkSearch)}" placeholder="Ville, aire, A6, identifiant…" /></label>
        </div>
        <div class="fuel-link-result-line"><strong id="fuel-candidate-visible">${formatNumber(candidates.length)} correspondances affichées</strong><span>Aucun choix n’est envoyé aux applications</span></div>
        ${paginationMarkup('fuel')}
        <div class="empty hidden" id="fuel-candidate-empty">Aucune correspondance pour ces filtres.</div>
        <div class="fuel-candidate-list">
          ${candidates.length ? candidates.map(renderFuelLinkCandidate).join('') : emptyInline('Toutes les stations officielles sont déjà reliées.')}
        </div>
      </section>
    `;
  }

  function applyFuelCandidateFilters() {
    const rows = Array.from(document.querySelectorAll('[data-fuel-candidate]'));
    const matches = rows.filter(row => (fuelLinkFilter === 'all'
      || (fuelLinkFilter === 'saved' ? row.dataset.saved === 'true' : row.dataset.category === fuelLinkFilter))
      && (!fuelLinkSearch || (row.dataset.search || '').includes(fuelLinkSearch)));
    const bounds = pageBounds(matches.length, fuelLinkPage);
    fuelLinkPage = bounds.page;
    const visible = new Set(matches.slice(bounds.start, bounds.end));
    rows.forEach(row => row.classList.toggle('hidden', !visible.has(row)));
    setText('fuel-candidate-visible', `${formatNumber(matches.length)} proposition${matches.length > 1 ? 's' : ''} · 20 maximum par page`);
    setHidden('fuel-candidate-empty', matches.length !== 0 || rows.length === 0);
    updatePagination('fuel', bounds, matches.length);
  }

  function handleDataInput(event) {
    const searchInput = event.target.closest('[data-fuel-link-search]');
    if (!searchInput) return;
    fuelLinkSearch = searchInput.value.trim().toLowerCase();
    fuelLinkPage = 1;
    applyFuelCandidateFilters();
  }

  function renderDataActionPanel(actionableRuns, automaticRetries) {
    const regions = actionableRuns.filter(run => run.source === 'service_areas_osm' && run.region);
    const bulk = state.bulkSync;
    return `<div class="sync-action-bar">
      <span>${bulk.active ? `Relance ${bulk.completed}/${bulk.total} · ${escapeHtml(REGION_LABELS[bulk.region] || 'Zone')}` : 'Les anciennes données restent disponibles.'}</span>
      ${regions.length > 1 || bulk.active ? `<button data-sync-all-regions type="button" ${bulk.active ? 'disabled' : ''}>${bulk.active ? 'Relance en cours…' : 'Relancer les zones en attente'}</button>` : ''}
      ${automaticRetries.length ? `<p class="hint">${automaticRetries.length} reprise(s) automatique(s) prévue(s).</p>` : ''}
    </div>`;
  }

  function renderDataActionRow(run, automatic) {
    const target = syncTargetForRun(run);
    const label = run.source === 'service_areas_osm' && run.region
      ? REGION_LABELS[run.region] || run.region
      : syncSourceLabel(run.source);
    const tone = automatic ? 'warning' : 'danger';
    const status = automatic ? 'Relance prévue' : dataActionLabel(run);
    const message = run.message
      ? friendlySyncError(run.message)
      : run.status === 'partial' ? 'La mise à jour est incomplète. Les données précédentes restent disponibles.'
        : 'La mise à jour doit être relancée.';
    return `
      <div class="data-action-row">
        <span class="row-icon ${tone}">${automatic ? '↻' : '!'}</span>
        <div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(message)}</p><p>${escapeHtml(syncDatesLabel(run))}${run.checkpoint ? ' · Progression conservée pour la reprise.' : ''}</p></div>
        <span class="pill ${tone}">${escapeHtml(status)}</span>
        ${automatic ? '<span class="data-action-wait">Automatique</span>' : `
          <button class="ghost small" data-sync-target="${escapeHtml(target)}" ${run.region ? `data-sync-region="${escapeHtml(run.region)}"` : ''} type="button" ${state.bulkSync.active ? 'disabled' : ''}>${run.checkpoint ? 'Reprendre' : 'Relancer'}</button>
        `}
      </div>
    `;
  }

  function renderSyncCard({ title, description, run, target, active }) {
    const tone = syncRunTone(run);
    return `
      <article class="source-card">
        <div>
          <span class="pill ${tone}">${escapeHtml(active ? 'En cours' : syncRunStatusLabel(run))}</span>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(description)}</p>
          <p style="margin-top:8px">${escapeHtml(syncDatesLabel(run))}</p>
          ${run?.message ? `<p style="margin-top:6px;color:var(--red)">${escapeHtml(friendlySyncError(run.message))}</p>` : ''}
        </div>
        <div class="source-actions">
          <button data-sync-target="${escapeHtml(target)}" type="button" ${active || state.bulkSync.active ? 'disabled' : ''}>${active ? 'Mise à jour en cours…' : 'Actualiser maintenant'}</button>
        </div>
      </article>
    `;
  }

  function renderOsmSyncCard(runs, active, actionableRuns) {
    const successes = runs.filter(isSyncDataFresh).length;
    const actions = actionableRuns.filter((run) => run.source === 'service_areas_osm').length;
    const automaticRetries = runs.filter(isAutomaticRetryPending).length;
    const tone = actions ? 'danger' : automaticRetries || successes < APPLICABLE_OSM_REGIONS.length ? 'warning' : 'success';
    return `
      <article class="source-card">
        <div>
          <span class="pill ${tone}">${successes}/${APPLICABLE_OSM_REGIONS.length} secteurs actualisés sous 48 h</span>
          <h3>Restaurants et services</h3>
          <p>17 secteurs techniques, dont Bretagne ouest non applicable au filtre autoroutier. Une synchronisation ne certifie pas chaque commerce sur place.</p>
          ${actions ? `<p style="margin-top:8px;color:var(--red)">${actions} zone${actions > 1 ? 's nécessitent' : ' nécessite'} une relance.</p>` : ''}
          ${automaticRetries ? `<p style="margin-top:8px">${automaticRetries} zone${automaticRetries > 1 ? 's seront relancées' : ' sera relancée'} automatiquement.</p>` : ''}
        </div>
        <div class="source-actions">
          <button class="ghost" data-show-zones type="button">Voir les ${OSM_REGIONS.length} lots</button>
          ${active ? '<span class="pill info">Mise à jour en cours</span>' : ''}
        </div>
      </article>
    `;
  }

  function renderOsmZoneRow(region, runs, activeRuns) {
    const run = runs.find((item) => item.region === region);
    const active = activeRuns.some((item) => item.source === 'service_areas_osm' && item.region === region);
    const fresh = isSyncDataFresh(run);
    const failed = ['error', 'partial'].includes(run?.status);
    const tone = active ? 'info' : fresh && failed ? 'warning' : syncRunTone(run);
    const status = active ? 'En cours' : isNotApplicable(run) ? 'Non applicable'
      : !fresh ? (isAutomaticRetryPending(run) ? 'Anciennes · reprise prévue' : 'Données anciennes')
      : failed ? (isAutomaticRetryPending(run) ? 'Récentes · reprise prévue' : 'Récentes · essai échoué') : 'Données récentes';
    const progress = run?.checkpoint;
    const knownRefresh = region === 'center_2' ? run?.metadata?.knownRefresh : null;
    const lastSuccess = run?.lastSuccessfulAt || (run?.status === 'success' ? run.finishedAt : null);
    return `
      <div class="zone-row compact-zone">
        <div class="zone-description">
          <strong>${escapeHtml(REGION_LABELS[region])}</strong>
          <p>Collecte complète : ${lastSuccess ? escapeHtml(formatDate(lastSuccess)) : 'non connue'}</p>
          ${knownRefresh ? `<p>Services revérifiés : ${formatNumber(knownRefresh.verifiedAreas)}/${formatNumber(knownRefresh.linkedAreas)} aires déjà reliées.${knownRefresh.lastCheckedAt ? ` Dernier contrôle : ${escapeHtml(formatDate(knownRefresh.lastCheckedAt))}.` : ''}</p>` : ''}
          <details><summary>Détail de la collecte</summary>
            ${knownRefresh ? `<p>Les aires connues passent en priorité, sans attendre la recherche de nouvelles aires. ${formatNumber(knownRefresh.reviewAreas)} aire(s) demandent une vérification ; les informations précédentes sont conservées.</p>` : ''}
            <p>${isNotApplicable(run) ? 'Hors filtre autoroutier actuel. Aucune donnée existante supprimée.' : escapeHtml(syncDatesLabel(run))}</p>
            ${run?.message ? `<p>${escapeHtml(friendlySyncError(run.message))}</p>` : ''}
            ${progress ? `<p>Progression conservée : ${progress.discoveryComplete ? 'repérage terminé' : `${formatNumber(progress.discoveryParts)}/${formatNumber(progress.discoveryTotal || 4)} portions repérées`}, ${formatNumber(progress.completedBatches)} lots de détails reçus.</p>` : ''}
            ${run?.metadata?.deferred ? '<p>Aucune requête envoyée : cette attente ne consomme pas de relance.</p>' : ''}
          </details>
        </div>
        <span class="pill ${tone}">${escapeHtml(status)}</span>
        <button class="ghost small" data-sync-target="osm_region" data-sync-region="${escapeHtml(region)}" type="button" ${active || state.bulkSync.active || isNotApplicable(run) || isAutomaticRetryPending(run) ? 'disabled' : ''}>${active ? 'En cours' : isAutomaticRetryPending(run) ? 'Reprise prévue' : progress ? 'Reprendre' : 'Actualiser'}</button>
      </div>
    `;
  }

  function renderSyncHistory(run) {
    const tone = syncRunTone(run);
    const label = run.source === 'service_areas_osm' && run.region
      ? REGION_LABELS[run.region] || run.region
      : syncSourceLabel(run.source);
    const trigger = run.triggerSource === 'admin' ? 'Manuel' : run.triggerSource === 'retry' ? 'Relance' : 'Planifié';
    const detail = run.message
      ? friendlySyncError(run.message)
      : `${formatNumber(run.rowsUpserted || 0)} ligne${Number(run.rowsUpserted) > 1 ? 's' : ''} mise${Number(run.rowsUpserted) > 1 ? 's' : ''} à jour`;
    return `
      <div class="history-row">
        <span class="row-icon ${tone}">${run.status === 'success' ? '✓' : ACTIVE_SYNC_STATUSES.has(run.status) ? '↻' : '!'}</span>
        <div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(trigger)} · ${escapeHtml(detail)} · ${escapeHtml(relativeDate(run.finishedAt || run.startedAt || run.requestedAt))}</p></div>
        <span class="pill ${tone}">${escapeHtml(run.status === 'success' ? 'Terminée' : syncRunStatusLabel(run))}</span>
      </div>
    `;
  }

  function renderOverride(item) {
    return `
      <article class="report">
        <div class="report-top">
          <div><div class="report-title">${escapeHtml(item.station_name || item.station_id)}</div><div class="meta"><span>ID ${escapeHtml(item.station_id)}</span><span>${escapeHtml(formatDate(item.updated_at))}</span></div></div>
          <span class="pill ${item.is_active ? 'success' : 'muted'}">${item.is_active ? 'Active' : 'Inactive'}</span>
        </div>
        <div class="correction-grid" style="margin-top:14px">
          <label>Marque<input data-override-field="brand_override" data-id="${escapeHtml(item.id)}" value="${escapeHtml(item.brand_override || '')}" /></label>
          <label>Prix JSON<textarea data-override-field="fuels" data-id="${escapeHtml(item.id)}">${escapeHtml(JSON.stringify(item.fuels || {}, null, 2))}</textarea></label>
          <label>Restaurants ajoutés<input data-override-field="tenants_add" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.tenants_add || []).join(', '))}" /></label>
          <label>Restaurants retirés<input data-override-field="tenants_remove" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.tenants_remove || []).join(', '))}" /></label>
          <label>Services ajoutés<input data-override-field="services_add" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.services_add || []).join(', '))}" /></label>
          <label>Services retirés<input data-override-field="services_remove" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.services_remove || []).join(', '))}" /></label>
          <label class="checkline"><input data-override-field="hidden" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.hidden ? 'checked' : ''} />Masquer l’aire</label>
          <label class="checkline"><input data-override-field="is_active" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.is_active ? 'checked' : ''} />Correction active</label>
        </div>
        <div class="review-box"><label>Note interne<textarea data-override-field="note" data-id="${escapeHtml(item.id)}">${escapeHtml(item.note || '')}</textarea></label></div>
        <div class="report-actions"><button data-save-override="${escapeHtml(item.id)}" type="button">Enregistrer</button></div>
      </article>
    `;
  }

  function fuelReviewErrorMessage(error) {
    const message = String(error?.message || '');
    if (message.includes('station_already_linked')) return 'Cette station vient déjà d’être reliée. Recharge la liste.';
    if (message.includes('link_already_decided')) return 'Cette association possède déjà une décision définitive.';
    if (message.includes('area_not_in_suggestions')) return 'Cette aire ne fait plus partie des trois propositions les plus proches.';
    if (message.includes('area_too_far')) return 'Cette aire est trop éloignée pour être enregistrée sans analyse complémentaire.';
    if (message.includes('not_admin')) return 'Ta session administrateur doit être reconnectée.';
    return 'Le choix n’a pas pu être enregistré.';
  }

  async function saveFuelLinkReview(button) {
    const row = button.closest('[data-fuel-candidate]');
    const stationId = button.dataset.saveFuelReview;
    const areaSelect = row?.querySelector('[data-fuel-area-choice]');
    const note = row?.querySelector('[data-fuel-review-note]')?.value.trim() || null;
    const areaId = areaSelect?.value;
    if (!stationId || !areaId) {
      showFeedback('Aucune aire n’est sélectionnée.');
      return;
    }

    const areaLabel = areaSelect.options[areaSelect.selectedIndex]?.textContent || areaId;
    const confirmed = window.confirm(
      `Enregistrer ce choix pour vérification ?\n\nStation ${stationId}\n${areaLabel}\n\nCette action ne modifie pas l’application.`,
    );
    if (!confirmed) return;

    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Enregistrement…';
    try {
      const { error } = await client.rpc('admin_stage_fuel_link_review_v1', {
        p_station_id: stationId,
        p_area_id: areaId,
        p_note: note,
      });
      if (error) throw error;
      invalidate('home', 'data', 'links');
      await loadView('links', true);
      showFeedback('Choix enregistré pour vérification, sans effet sur l’application.');
    } catch (error) {
      showFeedback(fuelReviewErrorMessage(error));
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function clearFuelLinkReview(button) {
    const stationId = button.dataset.clearFuelReview;
    if (!stationId) return;
    if (!window.confirm(`Annuler le choix préparatoire pour la station ${stationId} ?`)) return;

    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Annulation…';
    try {
      const { error } = await client.rpc('admin_clear_fuel_link_review_v1', {
        p_station_id: stationId,
      });
      if (error) throw error;
      invalidate('home', 'data', 'links');
      await loadView('links', true);
      showFeedback('Choix préparatoire annulé. L’application reste inchangée.');
    } catch (error) {
      showFeedback('Le choix préparatoire n’a pas pu être annulé.');
      button.disabled = false;
      button.textContent = previous;
    }
  }

  async function handleDataAction(event) {
    const scopeButton = event.target.closest('[data-data-scope]');
    if (scopeButton) {
      dataScope = scopeButton.dataset.dataScope === 'all' ? 'all' : 'attention';
      renderData();
      return;
    }
    const pageButton = event.target.closest('[data-list-page="fuel"]');
    if (pageButton) {
      fuelLinkPage += Number(pageButton.dataset.step);
      applyFuelCandidateFilters();
      return;
    }
    const saveFuelReviewButton = event.target.closest('button[data-save-fuel-review]');
    if (saveFuelReviewButton) {
      await saveFuelLinkReview(saveFuelReviewButton);
      return;
    }
    const clearFuelReviewButton = event.target.closest('button[data-clear-fuel-review]');
    if (clearFuelReviewButton) {
      await clearFuelLinkReview(clearFuelReviewButton);
      return;
    }
    const filterButton = event.target.closest('button[data-fuel-link-filter]');
    if (filterButton) {
      fuelLinkFilter = filterButton.dataset.fuelLinkFilter || 'all';
      fuelLinkPage = 1;
      document.querySelectorAll('button[data-fuel-link-filter]').forEach((button) => {
        button.classList.toggle('active', button === filterButton);
      });
      applyFuelCandidateFilters();
      return;
    }
    const showZonesButton = event.target.closest('button[data-show-zones]');
    if (showZonesButton) {
      const details = $('osm-zone-status');
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    const bulkSyncButton = event.target.closest('button[data-sync-all-regions]');
    if (bulkSyncButton) {
      await triggerBulkOsmSync(bulkSyncButton);
      return;
    }
    const syncButton = event.target.closest('button[data-sync-target]');
    if (syncButton) {
      await triggerSync(syncButton);
      return;
    }
    const overrideButton = event.target.closest('button[data-save-override]');
    if (overrideButton) await saveOverride(overrideButton.dataset.saveOverride, overrideButton);
  }

  async function triggerSync(button) {
    const target = button.dataset.syncTarget;
    const region = target === 'osm_region' ? button.dataset.syncRegion || null : null;
    const labels = {
      fuel_prices: 'les prix carburant',
      service_areas: 'les aires officielles',
      osm_region: `les restaurants et services de ${REGION_LABELS[region] || 'la zone'}`,
    };
    if (!labels[target] || (target === 'osm_region' && !region)) return;
    if (!window.confirm(`Actualiser ${labels[target]} maintenant ?`)) return;
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = 'Lancement…';
    try {
      const result = await requestSync(target, region);
      invalidate('home', 'data');
      await loadView('data', true);
      showFeedback(result?.alreadyRunning
        ? 'Cette mise à jour est déjà en cours.'
        : 'Mise à jour lancée. Le résultat apparaîtra automatiquement.');
    } catch (error) {
      showFeedback('Impossible de lancer la mise à jour.');
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function requestSync(target, region = null) {
    if (target === 'osm_region') {
      return query(client.rpc('admin_trigger_osm_region_v2', { p_region: region })).then(result => {
        if (!result?.ok) throw new Error('sync_queue_failed');
        return result;
      });
    }
    return query(client.rpc('admin_trigger_sync', {
      p_target: target,
      p_region: region,
    }));
  }

  async function triggerBulkOsmSync(button) {
    if (state.bulkSync.active) return;
    const activeRuns = (state.data?.recentRuns ?? []).filter((run) => ACTIVE_SYNC_STATUSES.has(run.status));
    const regions = currentSyncRows(state.data?.latestSyncs)
      .filter((run) => (
        run.source === 'service_areas_osm'
        && run.region
        && isActionableDataRun(run)
        && !isMatchingSyncActive(run, activeRuns)
      ))
      .map((run) => run.region);
    if (regions.length < 2) {
      showFeedback('Il n’y a pas plusieurs zones à relancer.');
      return;
    }
    const regionNames = regions.map((region) => REGION_LABELS[region] || region).join(', ');
    const confirmed = window.confirm(
      `Relancer progressivement ${regions.length} zones ?\n\n${regionNames}\n\nElles seront traitées une par une pour ne pas surcharger la source publique. Garde la page ouverte jusqu’à la fin.`,
    );
    if (!confirmed) return;

    state.bulkSync = { active: true, completed: 0, total: regions.length, region: regions[0] };
    button.disabled = true;
    renderData();
    let failureMessage = '';
    let successful = 0;
    let attempted = 0;

    try {
      for (const [index, region] of regions.entries()) {
        state.bulkSync.completed = index;
        state.bulkSync.region = region;
        renderData();
        showFeedback(`Relance ${index + 1}/${regions.length} : ${REGION_LABELS[region] || region}`);
        const result = await requestSync('osm_region', region);
        const completedRun = await waitForSyncRun(result?.runId);
        if (!completedRun) {
          throw new Error(`La relance de ${REGION_LABELS[region] || region} continue trop longtemps.`);
        }
        attempted += 1;
        if (completedRun.status === 'success') successful += 1;
        state.bulkSync.completed = index + 1;
      }
    } catch (error) {
      failureMessage = String(error?.message || 'La relance progressive a été interrompue.');
    } finally {
      state.bulkSync = { active: false, completed: 0, total: 0, region: null };
      invalidate('home', 'data');
      await loadView('data', true);
      showFeedback(failureMessage || `${attempted} secteurs relancés : ${successful} terminés, ${attempted - successful} encore en attente ou en échec. Les données précédentes restent disponibles.`);
    }
  }

  async function waitForSyncRun(runId) {
    if (!runId) return null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < SYNC_WAIT_TIMEOUT_MS) {
      await delay(SYNC_POLL_INTERVAL_MS);
      const payload = await query(client.rpc('admin_data_v2'));
      state.syncStatus = await queryOptional(client.rpc('admin_sync_status_v1'), null);
      state.data = payload;
      state.loaded.add('data');
      const run = (payload?.recentRuns ?? []).find((item) => item.id === runId);
      if (activeView === 'data') renderData();
      if (run && !ACTIVE_SYNC_STATUSES.has(run.status)) return run;
    }
    return null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function overrideFieldValue(id, field) {
    const element = document.querySelector(`[data-override-field="${field}"][data-id="${id}"]`);
    if (!element) return '';
    return element.type === 'checkbox' ? element.checked : element.value.trim();
  }

  async function saveOverride(id, button) {
    let fuels;
    try {
      fuels = JSON.parse(overrideFieldValue(id, 'fuels') || '{}');
    } catch {
      showFeedback('Le JSON des prix est invalide.');
      return;
    }
    button.disabled = true;
    try {
      const { error } = await client
        .from('station_overrides')
        .update({
          brand_override: overrideFieldValue(id, 'brand_override') || null,
          fuels,
          tenants_add: splitList(overrideFieldValue(id, 'tenants_add')),
          tenants_remove: splitList(overrideFieldValue(id, 'tenants_remove')),
          services_add: splitList(overrideFieldValue(id, 'services_add')),
          services_remove: splitList(overrideFieldValue(id, 'services_remove')),
          hidden: overrideFieldValue(id, 'hidden') === true,
          is_active: overrideFieldValue(id, 'is_active') === true,
          note: overrideFieldValue(id, 'note'),
          updated_at: new Date().toISOString(),
          updated_by: session.user.id,
        })
        .eq('id', id);
      if (error) throw error;
      invalidate('home', 'data', 'links');
      await loadView('links', true);
      showFeedback('Correction enregistrée.');
    } catch (error) {
      showFeedback('La correction n’a pas pu être enregistrée.');
    } finally {
      button.disabled = false;
    }
  }

  function renderReleases() {
    const releases = state.releases;
    const commands = [
      ['Test avant production', 'npm run update:preview -- --message "Test avant production"'],
      ['Mise à jour après validation', 'npm run update:production -- --message "Description de la mise à jour"'],
      ['Build iOS pour TestFlight', 'npm run build:ios:testflight -- --message "Nouvelle version iOS"'],
      ['APK Android de test', 'npm run build:android:internal -- --message "Test Android sur téléphone"'],
      ['AAB Android pour Google Play', 'npm run build:android:play -- --message "Nouvelle version Android"'],
    ];
    $('releases-view').innerHTML = `
      <p class="hint">Ce journal suit les livraisons enregistrées. Un build prêt ou une mise à jour OTA ne prouve pas la disponibilité d’une version sur les stores.</p>
      <section class="section-grid">
        ${['ios', 'android'].map(platform => {
          const latest = releases.find(release => release.platform === platform || release.platform === 'all');
          return `<article class="card"><div class="card-head"><div><h3>${platform === 'ios' ? 'iPhone' : 'Android'}</h3><p>Dernière livraison enregistrée</p></div></div>
            ${latest ? renderReleaseRow(latest) : emptyInline('Aucune livraison identifiée pour cette plateforme.')}</article>`;
        }).join('')}
      </section>
      <details class="card data-details">
        <summary><div><strong>Historique des livraisons</strong><p>Un statut inchangé depuis plus de 7 jours est signalé, sans modifier l’enregistrement.</p></div></summary>
        <div class="history-list data-details-body">${releases.length ? releases.map(renderReleaseRow).join('') : emptyInline('Aucune livraison enregistrée.')}</div>
        ${releases.length === 100 ? '<p class="hint">Les 100 derniers enregistrements sont chargés.</p>' : ''}
      </details>
      <details class="card data-details">
        <summary><div><strong>Commandes techniques</strong><p>Copier une commande ne lance aucune publication.</p></div></summary>
        <div class="data-details-body">
          <p class="hint">Interface ou JavaScript : OTA. Icône, permission ou dépendance native : nouveau build. Toujours tester avant publication.</p>
          <p><a href="${EXPO_BUILDS_URL}" target="_blank" rel="noopener noreferrer">Ouvrir les builds Expo</a></p>
          ${commands.map(([label, command]) => `<div class="command-block"><h4>${escapeHtml(label)}</h4><div class="command-wrap"><pre class="command">${escapeHtml(command)}</pre><button class="ghost small" data-copy-command="${escapeHtml(command)}" type="button">Copier</button></div></div>`).join('')}
        </div>
      </details>
    `;
  }

  function renderReleaseRow(release) {
    const tone = isStaleRelease(release) ? 'warning' : releaseTone(release.status);
    const externalUrl = safeExternalUrl(release.external_url);
    const dates = [
      relativeDate(release.updated_at),
      release.channel || release.environment,
      release.platform,
      release.commit_sha ? release.commit_sha.slice(0, 8) : '',
    ].filter(Boolean);
    return `
      <div class="release-row">
        <span class="row-icon ${tone}">${release.kind === 'ota_update' ? '↑' : release.kind === 'native_build' ? '▣' : 'A'}</span>
        <div>
          <h4>${escapeHtml(releaseLabel(release))}</h4>
          <div class="release-meta">
            ${dates.map((item) => `<span>${escapeHtml(item)}</span>`).join('')}
            ${externalUrl ? `<a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>` : ''}
          </div>
          ${release.error_summary ? `<p class="hint" style="color:var(--red);margin-top:5px">${escapeHtml(release.error_summary)}</p>` : ''}
        </div>
        <span class="pill ${tone}">${escapeHtml(releaseStatusText(release))}</span>
      </div>
    `;
  }

  async function handleReleaseAction(event) {
    const button = event.target.closest('button[data-copy-command]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copyCommand);
      showFeedback('Commande copiée.');
    } catch {
      showFeedback('Copie impossible dans ce navigateur.');
    }
  }

  function renderStats() {
    $('stats-view').innerHTML = renderStoreDownloads();
  }

  function renderSparkline(rows) {
    if (!rows.length) return emptyInline('Aucune recherche sur cette période.');
    const values = rows.map((row) => Number(row.routeSearches) || 0);
    const width = 900;
    const height = 160;
    const max = Math.max(...values, 1);
    const points = values.map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - 12 - ((value / max) * (height - 28));
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    });
    const line = points.map(([x, y]) => `${x},${y}`).join(' ');
    const area = `0,${height} ${line} ${width},${height}`;
    return `
      <svg class="sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Recherches quotidiennes">
        <defs><linearGradient id="routeGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#6d28d9" stop-opacity="0.25"/><stop offset="1" stop-color="#6d28d9" stop-opacity="0"/></linearGradient></defs>
        <line class="grid-line" x1="0" x2="${width}" y1="${height - 1}" y2="${height - 1}" />
        <polygon class="area" points="${area}" />
        <polyline class="line" points="${line}" />
      </svg>
      <div class="chart-caption"><span>${escapeHtml(shortDate(rows[0].date))}</span><span>Maximum ${formatNumber(max)} / jour</span><span>${escapeHtml(shortDate(rows.at(-1).date))}</span></div>
    `;
  }

  function renderBarList(items, labelFn, valueFn) {
    if (!items.length) return emptyInline('Pas encore assez de données.');
    const values = items.map((item) => Number(valueFn(item)) || 0);
    const max = Math.max(...values, 1);
    return `
      <div class="bar-list">
        ${items.slice(0, 8).map((item) => {
          const value = Number(valueFn(item)) || 0;
          return `<div class="bar-row"><strong>${escapeHtml(labelFn(item) || 'Sans nom')}</strong><span>${formatNumber(value)}</span><div class="bar-track"><i style="width:${Math.max(4, Math.round((value / max) * 100))}%"></i></div></div>`;
        }).join('')}
      </div>
    `;
  }

  async function handleStatsAction(event) {
    const button = event.target.closest('button[data-analytics-days]');
    if (!button) return;
    const days = Number(button.dataset.analyticsDays);
    if (![7, 30, 90].includes(days) || days === state.analyticsDays) return;
    state.analyticsDays = days;
    invalidate('stats');
    await loadView('stats', true);
    if ($('usage-details')) $('usage-details').open = true;
  }

  function renderMaintenance() {
    const operations = state.operations;
    if (!operations) {
      $('maintenance-view').innerHTML = loadingMarkup('du suivi technique');
      return;
    }
    const users = operations.users ?? {};
    const database = operations.database ?? {};
    const emails = operations.emails ?? {};
    const activity = operations.activity ?? {};
    const automation = operations.automation ?? {};
    const emailCapacity = getEmailCapacity(state.emailQuota);
    $('maintenance-view').innerHTML = `
      ${renderPlanCapacity(operations, state.emailQuota, true)}
      <details class="card data-details">
        <summary><div><strong>Automatisations et e-mails</strong><p>État des tâches et de la livraison des messages.</p></div></summary>
        <div class="source-list data-details-body">
          ${maintenanceRow('Tâches planifiées', Number(automation.cronActive) === Number(automation.cronTotal), `${automation.cronActive ?? '—'} actives sur ${automation.cronTotal ?? '—'}`)}
          ${maintenanceRow('Connexions PostgreSQL', Number(database.connectionPercent) < 80, `${database.connections ?? '—'} sur ${database.maxConnections ?? '—'}`)}
          ${maintenanceRow('Livraison sur 7 jours', Number(emails.failed7d) === 0, `${emails.delivered7d ?? '—'} livrés · ${emails.failed7d ?? '—'} échec(s)`)}
          ${maintenanceRow('Dernier événement e-mail reçu', Boolean(emailCapacity.lastEventAt), emailCapacity.lastEventAt ? relativeDate(emailCapacity.lastEventAt) : 'Aucun événement connu')}
          ${maintenanceRow('Suivi Resend', emailCapacity.trackingActive, emailCapacity.trackingActive ? `Actif depuis ${formatDate(emailCapacity.trackedSince)}` : 'Pas encore initialisé')}
        </div>
      </details>
      <details class="card data-details">
        <summary><div><strong>Diagnostic partageable</strong><p>Résumé technique sans clé ni adresse utilisateur.</p></div></summary>
        <div class="data-details-body">
          <button class="ghost small" data-copy-diagnostic type="button">Copier le diagnostic</button>
          <pre class="command">${escapeHtml(diagnosticText({ users, database, emails, emailQuota: state.emailQuota, activity, automation }))}</pre>
        </div>
      </details>
    `;
  }

  function quotaUsage(value) {
    if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function quotaStatus(metrics) {
    if (metrics.some(metric => metric.known && metric.percent >= 100)) return { tone: 'danger', label: 'Limite atteinte' };
    if (metrics.some(metric => metric.tone === 'danger')) return { tone: 'danger', label: 'Limite proche' };
    if (metrics.some(metric => metric.tone === 'warning')) return { tone: 'warning', label: 'À surveiller' };
    if (metrics.some(metric => !metric.known)) return { tone: 'muted', label: 'À vérifier' };
    return { tone: 'success', label: 'Marge disponible' };
  }

  function renderQuotaOverview() {
    const metrics = [...getSupabaseCapacity(state.operations).metrics, ...getEmailCapacity(state.emailQuota).metrics];
    const status = quotaStatus(metrics);
    const labels = { mau: 'Comptes actifs · estim.', database: 'Base de données', 'email-day': 'E-mails suivis · jour', 'email-month': 'E-mails suivis · mois' };
    return `<button type="button" class="quota-overview ${status.tone}" data-go-view="maintenance" aria-haspopup="dialog">
      <span class="quota-overview-heading"><span><strong>Quotas et limites</strong><small>Supabase et Resend · 4 limites suivies</small></span><span class="pill ${status.tone}">${status.label}</span><span class="quota-overview-arrow" aria-hidden="true">→</span></span>
      <span class="quota-overview-metrics">${metrics.map(metric => `<span class="quota-overview-metric ${metric.tone}"><span>${labels[metric.key]}</span><strong>${metric.known ? escapeHtml(formatPercent(metric.percent)) : 'Non disponible'}</strong><span class="quota-overview-track" aria-hidden="true"><i style="width:${metric.known ? Math.min(100, metric.percent) : 0}%"></i></span></span>`).join('')}</span>
    </button>`;
  }

  function getSupabaseCapacity(operations = {}) {
    const config = readConfig();
    const users = operations?.users ?? {};
    const database = operations?.database ?? {};
    const monthlyActiveUsersLimit = Number(config.limits.monthlyActiveUsers) || 0;
    const databaseBytesLimit = Number(config.limits.databaseBytes) || 0;
    const monthlyActiveUsers = quotaUsage(users.signedIn30d);
    const databaseBytes = quotaUsage(database.bytes);

    return {
      plan: config.plan,
      usageUrl: safeExternalUrl(config.usageUrl),
      totalUsers: Number(users.total) || 0,
      metrics: [
        quotaMetric({
          key: 'mau',
          label: 'Utilisateurs actifs mensuels',
          shortLabel: 'MAU',
          used: monthlyActiveUsers,
          limit: monthlyActiveUsersLimit,
          usedLabel: monthlyActiveUsers === null ? '—' : formatNumber(monthlyActiveUsers),
          limitLabel: formatNumber(monthlyActiveUsersLimit),
          remainingLabel: monthlyActiveUsers === null ? 'Utilisation non disponible' : `${formatNumber(Math.max(0, monthlyActiveUsersLimit - monthlyActiveUsers))} disponibles`,
          detail: 'Estimation à partir des connexions des 30 derniers jours',
        }),
        quotaMetric({
          key: 'database',
          label: 'Base de données',
          shortLabel: 'Base',
          used: databaseBytes,
          limit: databaseBytesLimit,
          usedLabel: databaseBytes === null ? '—' : formatBytes(databaseBytes),
          limitLabel: formatBytes(databaseBytesLimit),
          remainingLabel: databaseBytes === null ? 'Utilisation non disponible' : `${formatBytes(Math.max(0, databaseBytesLimit - databaseBytes))} disponibles`,
          detail: 'Taille PostgreSQL mesurée en direct',
        }),
      ],
    };
  }

  function getEmailCapacity(quota = {}) {
    const config = readConfig();
    const dailyLimit = Number(config.limits.emailDailyUnits) || 0;
    const monthlyLimit = Number(config.limits.emailMonthlyUnits) || 0;
    const usedToday = quota?.trackedSince ? quotaUsage(quota.usedToday) : null;
    const usedMonth = quota?.trackedSince ? quotaUsage(quota.usedMonth) : null;

    return {
      plan: config.emailPlan,
      usageUrl: safeExternalUrl(config.emailUsageUrl),
      trackedSince: quota?.trackedSince || null,
      lastEventAt: quota?.lastEventAt || null,
      trackingActive: Boolean(quota?.trackedSince),
      metrics: [
        quotaMetric({
          key: 'email-day',
          label: 'E-mails aujourd’hui',
          shortLabel: 'Jour',
          used: usedToday,
          limit: dailyLimit,
          usedLabel: usedToday === null ? '—' : formatNumber(usedToday),
          limitLabel: formatNumber(dailyLimit),
          remainingLabel: usedToday === null ? 'Suivi non disponible' : `${formatNumber(Math.max(0, dailyLimit - usedToday))} disponibles`,
          detail: quota?.nextDayAt ? `Remise à zéro ${relativeDate(quota.nextDayAt)}` : 'Quota quotidien Resend',
        }),
        quotaMetric({
          key: 'email-month',
          label: 'E-mails ce mois-ci',
          shortLabel: 'Mois',
          used: usedMonth,
          limit: monthlyLimit,
          usedLabel: usedMonth === null ? '—' : formatNumber(usedMonth),
          limitLabel: formatNumber(monthlyLimit),
          remainingLabel: usedMonth === null ? 'Suivi non disponible' : `${formatNumber(Math.max(0, monthlyLimit - usedMonth))} disponibles`,
          detail: quota?.nextMonthAt ? `Remise à zéro ${formatDate(quota.nextMonthAt)}` : 'Quota mensuel Resend',
        }),
      ],
    };
  }

  function quotaMetric(metric) {
    const known = Number.isFinite(metric.used) && metric.used >= 0 && Number.isFinite(metric.limit) && metric.limit > 0;
    const percent = known ? (metric.used / metric.limit) * 100 : null;
    return {
      ...metric,
      known,
      percent,
      tone: !known ? 'muted' : percent >= QUOTA_DANGER_PERCENT
        ? 'danger'
        : percent >= QUOTA_WARNING_PERCENT ? 'warning' : 'success',
    };
  }

  function renderPlanCapacity(operations, emailQuota, detailed = false) {
    const supabaseCapacity = getSupabaseCapacity(operations);
    const emailCapacity = getEmailCapacity(emailQuota);
    const supabasePlanName = supabaseCapacity.plan === 'free' ? 'gratuit' : supabaseCapacity.plan;
    const emailPlanName = emailCapacity.plan === 'free' ? 'gratuit' : emailCapacity.plan;
    const status = quotaStatus([...supabaseCapacity.metrics, ...emailCapacity.metrics]);
    return `
      <section class="capacity-panel">
        <div class="capacity-head">
          <div>
            <p class="eyebrow">Capacité et quotas</p>
            <h3>Quotas et limites</h3>
            <p>Supabase ${escapeHtml(supabasePlanName)} · Resend ${escapeHtml(emailPlanName)} · ${formatNumber(supabaseCapacity.totalUsers)} compte${supabaseCapacity.totalUsers > 1 ? 's' : ''}.</p>
          </div>
          <div class="capacity-links">
            <span class="pill ${status.tone}">${status.label}</span>
            ${supabaseCapacity.usageUrl ? `<a class="ghost capacity-link" href="${escapeHtml(supabaseCapacity.usageUrl)}" target="_blank" rel="noopener noreferrer">Supabase</a>` : ''}
            ${emailCapacity.usageUrl ? `<a class="ghost capacity-link" href="${escapeHtml(emailCapacity.usageUrl)}" target="_blank" rel="noopener noreferrer">Resend</a>` : ''}
          </div>
        </div>
        <div class="quota-grid">
          ${[...supabaseCapacity.metrics, ...emailCapacity.metrics].map(renderQuotaMetric).join('')}
        </div>
        <p class="capacity-note">
          MAU : estimation locale sur 30 jours. E-mails : envois et réceptions suivis par webhook ; chaque destinataire compte pour une unité.
          ${detailed ? 'Les pages d’utilisation Supabase et Resend restent la référence de facturation.' : ''}
        </p>
      </section>
    `;
  }

  function renderQuotaMetric(metric) {
    const visualPercent = metric.used > 0 ? Math.max(1, Math.min(100, metric.percent)) : 0;
    return `
      <article class="quota-item ${escapeHtml(metric.tone)}">
        <div class="quota-top">
          <div><strong>${escapeHtml(metric.label)}</strong><p>${escapeHtml(metric.detail)}</p></div>
          <span class="pill ${escapeHtml(metric.tone)}">${metric.known ? escapeHtml(formatPercent(metric.percent)) : 'Non disponible'}</span>
        </div>
        <div class="quota-values"><strong>${escapeHtml(metric.usedLabel)}</strong><span>sur ${escapeHtml(metric.limitLabel)}</span></div>
        ${metric.known ? `<div class="quota-track" role="progressbar" aria-label="${escapeHtml(metric.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(metric.percent))}"><i style="width:${visualPercent}%"></i></div>` : '<p class="hint">Mesure ou limite indisponible.</p>'}
        <small>${escapeHtml(metric.remainingLabel)}</small>
      </article>
    `;
  }

  function maintenanceCard(label, value, detail) {
    return `<article class="maintenance-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumberOrText(value))}</strong><small>${escapeHtml(detail)}</small></article>`;
  }

  function maintenanceRow(label, healthy, detail) {
    return `<div class="source-row"><span class="row-icon ${healthy ? 'success' : 'danger'}">${healthy ? '✓' : '!'}</span><div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(detail)}</p></div><span class="pill ${healthy ? 'success' : 'danger'}">${healthy ? 'OK' : 'À vérifier'}</span></div>`;
  }

  async function handleMaintenanceAction(event) {
    const button = event.target.closest('button[data-copy-diagnostic]');
    if (!button || !state.operations) return;
    const operations = state.operations;
    try {
      await navigator.clipboard.writeText(diagnosticText({
        users: operations.users ?? {},
        database: operations.database ?? {},
        emails: operations.emails ?? {},
        emailQuota: state.emailQuota,
        activity: operations.activity ?? {},
        automation: operations.automation ?? {},
      }));
      showFeedback('Diagnostic copié.');
    } catch {
      showFeedback('Copie impossible dans ce navigateur.');
    }
  }

  function diagnosticText({ users, database, emails, emailQuota, activity, automation }) {
    const capacity = getSupabaseCapacity({ users, database });
    const monthlyActiveUsers = capacity.metrics.find((metric) => metric.key === 'mau');
    const databaseUsage = capacity.metrics.find((metric) => metric.key === 'database');
    const emailCapacity = getEmailCapacity(emailQuota);
    const emailDaily = emailCapacity.metrics.find((metric) => metric.key === 'email-day');
    const emailMonthly = emailCapacity.metrics.find((metric) => metric.key === 'email-month');
    return [
      '# RouteStop Admin — diagnostic',
      '',
      `- Comptes : ${users.total ?? 0}`,
      `- MAU estimés sur 30 jours : ${monthlyActiveUsers?.usedLabel ?? 0}/${monthlyActiveUsers?.limitLabel ?? '—'} (${formatPercent(monthlyActiveUsers?.percent ?? 0)})`,
      `- Utilisateurs actifs sur 7 jours : ${activity.activeUsers7d ?? 0}`,
      `- Prix centralisés : ${database.fuelPriceRows ?? 0}`,
      `- Aires centralisées : ${database.serviceAreaRows ?? 0}`,
      `- Tâches planifiées : ${automation.cronActive ?? 0}/${automation.cronTotal ?? 0}`,
      `- Tentatives de synchronisation échouées sur 24 h : ${automation.syncFailures24h ?? 0}`,
      `- Quota e-mail du jour : ${emailDaily?.usedLabel ?? 0}/${emailDaily?.limitLabel ?? '—'} (${formatPercent(emailDaily?.percent ?? 0)})`,
      `- Quota e-mail du mois : ${emailMonthly?.usedLabel ?? 0}/${emailMonthly?.limitLabel ?? '—'} (${formatPercent(emailMonthly?.percent ?? 0)})`,
      `- E-mails livrés sur 7 jours : ${emails.delivered7d ?? 0}`,
      `- E-mails en échec sur 7 jours : ${emails.failed7d ?? 0}`,
      `- Base : ${databaseUsage?.usedLabel ?? formatBytes(database.bytes ?? 0)}/${databaseUsage?.limitLabel ?? '—'} (${formatPercent(databaseUsage?.percent ?? 0)})`,
      `- Connexions : ${database.connections ?? 0}/${database.maxConnections ?? 0}`,
    ].join('\n');
  }

  function subscribeRealtime() {
    if (!client || realtimeChannel) return;
    realtimeChannel = client
      .channel(`routestop-admin-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'data_sync_runs' }, () => {
        queueRealtime('home', 'data');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'app_release_runs' }, () => {
        queueRealtime('home', 'releases');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'station_reports' }, () => {
        queueRealtime('home', 'actions');
      })
      .subscribe((status) => {
        const live = $('live-state');
        const connected = status === 'SUBSCRIBED';
        live.classList.toggle('offline', !connected);
        live.lastChild.textContent = connected ? 'Suivi connecté' : 'Reconnexion';
      });
  }

  function unsubscribeRealtime() {
    if (realtimeTimer) window.clearTimeout(realtimeTimer);
    if (activePoll) window.clearInterval(activePoll);
    realtimeTimer = null;
    activePoll = null;
    if (client && realtimeChannel) client.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  function queueRealtime(...views) {
    invalidate(...views);
    if (realtimeTimer) window.clearTimeout(realtimeTimer);
    realtimeTimer = window.setTimeout(() => {
      realtimeTimer = null;
      if (views.includes(activeView)) loadView(activeView, true);
    }, 700);
  }

  function startActivePoll() {
    if (activePoll) return;
    activePoll = window.setInterval(() => {
      const dataActive = (state.data?.recentRuns ?? []).some((run) => ACTIVE_SYNC_STATUSES.has(run.status))
        || (state.home?.data?.activeRuns ?? []).length > 0;
      const releaseActive = state.releases.some((run) => ACTIVE_RELEASE_STATUSES.has(run.status))
        || ACTIVE_RELEASE_STATUSES.has(state.home?.releases?.latest?.status);
      if ((dataActive && ['home', 'data'].includes(activeView))
        || (releaseActive && ['home', 'releases'].includes(activeView))) {
        invalidate(activeView);
        loadView(activeView, true);
      }
    }, 15000);
  }

  function invalidate(...views) {
    if (views.includes('data')) state.loaded.delete('links');
    views.forEach((view) => state.loaded.delete(view));
  }

  function emptyInline(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function splitList(value) {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  function fuelFromTarget(value) {
    const match = String(value || '').match(/^Prix\s+(.+)$/i);
    return match ? match[1].trim() : '';
  }

  function syncSourceLabel(source) {
    if (source === 'fuel_prices_gov') return 'Prix carburant';
    if (source === 'service_areas_operator') return 'Aires officielles';
    if (source === 'service_areas_osm') return 'Restaurants et services';
    return 'Mise à jour des données';
  }

  function currentSyncRows(rows) {
    if (Array.isArray(state.syncStatus?.runs)) return state.syncStatus.runs;
    if (!Array.isArray(rows)) return [];
    return rows.filter((run) => (
      run.source !== 'service_areas_osm' || OSM_REGIONS.includes(run.region)
    ));
  }

  function isNotApplicable(run) {
    return run?.notApplicable === true || (run?.source === 'service_areas_osm' && run.region === 'north_1');
  }

  function syncDataDate(run) {
    return run?.dataAsOf || run?.lastSuccessfulAt || (run?.status === 'success' ? run.finishedAt : null);
  }

  function isSyncDataFresh(run) {
    if (isNotApplicable(run)) return false;
    const timestamp = dateValue(syncDataDate(run));
    const maximumAge = run?.source === 'fuel_prices_gov' ? 3 * 3600000 : 48 * 3600000;
    const age = Date.now() - timestamp;
    return timestamp > 0 && age >= 0 && age <= maximumAge;
  }

  function syncDatesLabel(run) {
    const success = run?.lastSuccessfulAt || (run?.status === 'success' ? run.finishedAt : null);
    const attempt = run?.finishedAt || run?.startedAt || run?.requestedAt;
    return `Dernière réussite : ${success ? formatDate(success) : 'inconnue'} · Dernière tentative : ${attempt ? formatDate(attempt) : 'aucune'}`
      + (run?.dataAsOf && dateValue(run.dataAsOf) < dateValue(success) - 3600000 ? ` · Collecte commencée le ${formatDate(run.dataAsOf)}` : '');
  }

  function syncStatusLabel(status) {
    if (status === 'requested') return 'En attente';
    if (status === 'running') return 'En cours';
    if (status === 'success') return 'À jour';
    if (status === 'partial') return 'Incomplet';
    if (status === 'error') return 'Échec';
    return 'Pas encore';
  }

  function syncTone(status) {
    if (status === 'success') return 'success';
    if (status === 'error') return 'danger';
    if (status === 'partial') return 'warning';
    if (status === 'requested' || status === 'running') return 'info';
    return 'muted';
  }

  function isTransientSyncMessage(message) {
    return /timeout|timed out|aborted|http 429|http 502|http 503|http 504|overpass/i.test(String(message || ''));
  }

  function isTransientSyncError(run) {
    return run?.source === 'service_areas_osm'
      && run?.status === 'error'
      && isTransientSyncMessage(run.message);
  }

  function isAutomaticRetryPending(run) {
    if (isNotApplicable(run) || !['error', 'partial'].includes(run?.status)) return false;
    if (!isTransientSyncError(run) && !run.metadata?.retryable && run.status !== 'partial') return false;
    const retryAttempt = Number(run.metadata?.retryAttempt) || 0;
    const retryStillAvailable = ['schedule', 'admin'].includes(run.triggerSource)
      || (run.triggerSource === 'retry' && retryAttempt < 3);
    if (!retryStillAvailable) return false;
    const failedAt = dateValue(run.finishedAt || run.startedAt || run.requestedAt);
    const cycleAt = dateValue(run.metadata?.cycleStartedAt) || failedAt;
    return failedAt > 0 && Date.now() - cycleAt < (run.source === 'service_areas_osm' ? 18 : 3) * 60 * 60 * 1000;
  }

  function isActionableDataRun(run) {
    if (!run || isNotApplicable(run) || ACTIVE_SYNC_STATUSES.has(run.status)) return false;
    if (!['error', 'partial', 'never'].includes(run.status) && isSyncDataFresh(run)) return false;
    return !isAutomaticRetryPending(run);
  }

  function isMatchingSyncActive(run, activeRuns) {
    return activeRuns.some((active) => (
      active.source === run.source
      && (run.source !== 'service_areas_osm' || active.region === run.region)
    ));
  }

  function syncTargetForRun(run) {
    if (run?.source === 'fuel_prices_gov') return 'fuel_prices';
    if (run?.source === 'service_areas_operator') return 'service_areas';
    if (run?.source === 'service_areas_osm') return 'osm_region';
    return '';
  }

  function dataActionLabel(run) {
    if (run?.status === 'success') return 'Données anciennes';
    if (run?.status === 'never') return 'Jamais actualisé';
    if (run?.status === 'partial') return 'Mise à jour incomplète';
    if (isTransientSyncError(run) && run?.triggerSource === 'retry') return 'Relance automatique échouée';
    if (isTransientSyncError(run) && run?.triggerSource === 'admin') return 'Relance manuelle échouée';
    return 'Échec à traiter';
  }

  function syncRunStatusLabel(run) {
    if (isNotApplicable(run)) return 'Non applicable';
    if (run?.status === 'success' && !isSyncDataFresh(run)) return 'Données anciennes';
    return isAutomaticRetryPending(run) ? 'Relance prévue' : syncStatusLabel(run?.status);
  }

  function syncRunTone(run) {
    if (isNotApplicable(run)) return 'muted';
    if (run?.status === 'success' && !isSyncDataFresh(run)) return 'warning';
    return isAutomaticRetryPending(run) || run?.status === 'partial' ? 'warning' : syncTone(run?.status);
  }

  function reportStatusTone(status) {
    if (status === 'reviewed') return 'success';
    if (status === 'rejected') return 'danger';
    return 'warning';
  }

  function friendlySyncError(message) {
    const value = String(message || '').toLowerCase();
    if (/checkpoint_pending|details_batch_pending/.test(value)) return 'Import non terminé. Les morceaux reçus sont conservés pour la prochaine reprise.';
    if (/http (401|403|406)/.test(value)) return 'Accès refusé par une source. Elle est mise en pause, sans contourner son refus.';
    if (/overpass_cooldown/.test(value)) return 'Les sources publiques sont temporairement en pause. La progression est conservée.';
    if (isTransientSyncMessage(value)) {
      return 'La source publique n’a pas répondu à temps. Les données précédentes restent disponibles.';
    }
    if (/no_motorway_geometry/.test(value)) return 'Aucune autoroute reconnue dans cette zone.';
    if (/no_osm_service_areas|no_osm_details/.test(value)) {
      return 'Aucune aire n’a pu être confirmée. Les données précédentes restent disponibles.';
    }
    return 'La mise à jour n’a pas abouti. Les données précédentes restent disponibles.';
  }

  function releaseStatusLabel(status) {
    const labels = {
      requested: 'Demandée',
      checking: 'Contrôles en cours',
      publishing: 'Publication en cours',
      running: 'En cours',
      succeeded: 'Publiée',
      failed: 'Échec',
      cancelled: 'Annulée',
      waiting_review: 'En attente Apple',
      in_review: 'En vérification Apple',
      approved: 'Approuvée',
      rejected: 'Refusée',
      available: 'Disponible',
    };
    return labels[status] || status || 'Inconnu';
  }

  function isStaleRelease(release) {
    const updated = dateValue(release?.updated_at || release?.updatedAt);
    return ACTIVE_RELEASE_STATUSES.has(release?.status) && updated > 0 && Date.now() - updated > 7 * 86400000;
  }

  function releaseStatusText(release) {
    if (isStaleRelease(release)) return 'Statut ancien à vérifier';
    if (release?.kind === 'native_build' && release?.status === 'succeeded') return 'Build prêt';
    if (release?.kind === 'store_submission' && release?.status === 'succeeded') return 'Envoyée';
    return releaseStatusLabel(release?.status);
  }

  function releaseTone(status) {
    if (['succeeded', 'approved', 'available'].includes(status)) return 'success';
    if (['failed', 'rejected'].includes(status)) return 'danger';
    if (['cancelled'].includes(status)) return 'muted';
    if (['waiting_review', 'in_review'].includes(status)) return 'warning';
    return 'info';
  }

  function releaseLabel(release) {
    const platform = release.platform === 'ios'
      ? 'iOS'
      : release.platform === 'android' ? 'Android'
        : release.platform === 'all' ? 'iOS + Android' : '';
    const kind = release.kind === 'ota_update'
      ? `Mise à jour OTA${platform ? ` ${platform}` : ''}`
      : release.kind === 'native_build' ? `Build${platform ? ` ${platform}` : ' natif'}`
        : release.kind === 'store_submission' ? `Soumission${platform ? ` ${platform}` : ''}`
          : `Publication${platform ? ` ${platform}` : ' App Store'}`;
    const version = release.version ? ` ${release.version}` : '';
    const build = release.buildNumber || release.build_number;
    return `${kind}${version}${build ? ` (build ${build})` : ''}`;
  }

  function releaseProgress(release) {
    if (Number.isFinite(Number(release.progress))) return Math.max(0, Math.min(100, Number(release.progress)));
    const defaults = {
      requested: 0,
      checking: 15,
      publishing: 45,
      running: 65,
      waiting_review: 75,
      in_review: 85,
      succeeded: 100,
      failed: 100,
      cancelled: 100,
      approved: 100,
      rejected: 100,
      available: 100,
    };
    return defaults[release.status] ?? 0;
  }

  function formatNumber(value) {
    return (Number(value) || 0).toLocaleString('fr-FR');
  }

  function formatNumberOrText(value) {
    return typeof value === 'number' ? formatNumber(value) : String(value ?? '—');
  }

  function formatPercent(value) {
    const percent = Number(value) || 0;
    if (percent > 0 && percent < 0.1) return '< 0,1 %';
    return `${percent.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  }

  function formatBytes(value) {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} o`;
    const units = ['Ko', 'Mo', 'Go', 'To'];
    let size = bytes / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${units[index]}`;
  }

  function dateValue(value) {
    const date = new Date(value || 0).getTime();
    return Number.isFinite(date) ? date : 0;
  }

  function formatDate(value) {
    if (!value) return '—';
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  function formatTime(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  }

  function shortDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(value));
  }

  function relativeDate(value) {
    const timestamp = dateValue(value);
    if (!timestamp) return 'date inconnue';
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 2) return 'à l’instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `il y a ${hours} h`;
    return `il y a ${Math.round(hours / 24)} j`;
  }

  boot().catch((error) => {
    setText('config-state', error?.message || 'Erreur inattendue.');
  });
})();
