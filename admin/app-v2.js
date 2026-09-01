(() => {
  const CONFIG_KEY = 'routestop_admin_supabase_v1';
  const ACTIVE_SYNC_STATUSES = new Set(['requested', 'running']);
  const ACTIVE_RELEASE_STATUSES = new Set([
    'requested', 'checking', 'publishing', 'running', 'waiting_review', 'in_review',
  ]);
  const OSM_REGIONS = [
    'north_1', 'north_2', 'north_3a', 'north_3b', 'north_4', 'north_5',
    'center_1', 'center_2', 'center_3', 'center_4',
    'south_1', 'south_2', 'south_3', 'south_4',
  ];
  const REGION_LABELS = {
    north_1: 'Bretagne ouest',
    north_2: 'Bretagne est et Normandie',
    north_3a: 'Région parisienne ouest',
    north_3b: 'Région parisienne est et Champagne',
    north_4: 'Nord-Est',
    north_5: 'Alsace',
    center_1: 'Centre-Ouest',
    center_2: 'Centre',
    center_3: 'Centre-Est',
    center_4: 'Alpes du Nord',
    south_1: 'Sud-Ouest',
    south_2: 'Languedoc',
    south_3: 'Sud-Est',
    south_4: 'Corse et frontière italienne',
  };
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
  const VIEW_TITLES = {
    home: ['Pilotage', 'Aujourd’hui'],
    actions: ['Décisions', 'À traiter'],
    data: ['Fiabilité', 'Données'],
    releases: ['Livraison', 'Versions'],
    stats: ['Utilisation', 'Statistiques'],
    maintenance: ['Technique', 'Maintenance'],
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
    overrides: [],
    releases: [],
    analytics: null,
    analyticsDays: 30,
    operations: null,
    emailQuota: null,
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
  let activeView = 'home';
  let statusFilter = 'pending';
  let search = '';
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
    setText('admin-feedback', message);
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
    document.querySelectorAll('.nav[data-view]').forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.view));
    });

    $('status-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-status]');
      if (!button) return;
      statusFilter = button.dataset.status;
      $('status-tabs').querySelectorAll('button').forEach((item) => {
        item.classList.toggle('active', item === button);
      });
      renderReports();
    });

    $('search').addEventListener('input', (event) => {
      search = event.target.value.trim().toLowerCase();
      renderReports();
    });

    $('home-view').addEventListener('click', handleNavigationAction);
    $('actions-view').addEventListener('click', handleReportAction);
    $('data-view').addEventListener('click', handleDataAction);
    $('releases-view').addEventListener('click', handleReleaseAction);
    $('stats-view').addEventListener('click', handleStatsAction);
    $('maintenance-view').addEventListener('click', handleMaintenanceAction);
  }

  function clearState() {
    state.home = null;
    state.reports = [];
    state.data = null;
    state.overrides = [];
    state.releases = [];
    state.analytics = null;
    state.operations = null;
    state.emailQuota = null;
    state.bulkSync = { active: false, completed: 0, total: 0, region: null };
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

  async function setView(view) {
    if (!VIEW_TITLES[view]) view = 'home';
    activeView = view;
    const [eyebrow, title] = VIEW_TITLES[view];
    setText('view-eyebrow', eyebrow);
    setText('view-title', title);
    document.querySelectorAll('.nav[data-view]').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach((panel) => panel.classList.add('hidden'));
    $(`${view}-view`).classList.remove('hidden');
    await loadView(view, false);
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

  async function loadView(view, force = false) {
    if (!client || !session || state.loading.has(view)) return;
    if (state.loaded.has(view) && !force) {
      renderView(view);
      return;
    }

    state.loading.add(view);
    const viewElement = viewRenderTarget(view);
    if (viewElement) viewElement.innerHTML = loadingMarkup(VIEW_TITLES[view][1].toLowerCase());
    showFeedback('Vérification…');

    try {
      if (view === 'home') {
        const [home, operations, emailQuota] = await Promise.all([
          query(client.rpc('admin_home_v2')),
          query(client.rpc('admin_operations_v1')),
          query(client.rpc('admin_email_quota_v1')),
        ]);
        state.home = home;
        state.operations = operations;
        state.emailQuota = emailQuota;
      } else if (view === 'actions') {
        state.reports = await query(client
          .from('station_reports')
          .select('id, station_id, station_name, station_brand, station_lat, station_lon, station_source, operator_source, report_type, target_label, details, snapshot, status, created_at, reviewed_at, review_note')
          .order('created_at', { ascending: false })
          .limit(250)) ?? [];
      } else if (view === 'data') {
        const [data, overrides] = await Promise.all([
          query(client.rpc('admin_data_v2')),
          query(client
            .from('station_overrides')
            .select('id, station_id, station_name, station_brand, brand_override, fuels, services_add, services_remove, tenants_add, tenants_remove, hidden, note, is_active, updated_at')
            .order('updated_at', { ascending: false })
            .limit(200)),
        ]);
        state.data = data;
        state.overrides = overrides ?? [];
      } else if (view === 'releases') {
        state.releases = await query(client
          .from('app_release_runs')
          .select('id, kind, environment, channel, platform, version, build_number, runtime_version, status, progress, message, commit_sha, initiated_by, external_id, external_url, requested_at, started_at, finished_at, updated_at, error_summary')
          .order('updated_at', { ascending: false })
          .limit(100)) ?? [];
      } else if (view === 'stats') {
        state.analytics = await query(client.rpc('admin_analytics_v2', { p_days: state.analyticsDays }));
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
      showFeedback(`Vérifié ${formatTime(new Date().toISOString())}`);
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

    const reportData = payload.reports ?? {};
    const data = payload.data ?? {};
    const releaseData = payload.releases ?? {};
    const activity = payload.activity ?? {};
    const operations = payload.operations ?? {};
    const capacityOperations = state.operations ?? {
      users: {
        total: activity.usersTotal,
        new7d: activity.newUsers7d,
        signedIn7d: activity.activeUsers7d,
        signedIn30d: activity.activeUsers7d,
      },
      database: { bytes: operations.databaseBytes },
    };
    const latestSyncs = currentSyncRows(data.latestSyncs);
    const osmSyncs = latestSyncs.filter((item) => item.source === 'service_areas_osm');
    const osmSuccesses = osmSyncs.filter((item) => item.status === 'success').length;
    const dataActions = latestSyncs.filter(isActionableDataRun);
    const syncErrors = latestSyncs.filter((item) => item.status === 'error' && !isAutomaticRetryPending(item));
    const syncWarnings = latestSyncs.filter(isAutomaticRetryPending);
    const syncPartials = latestSyncs.filter((item) => item.status === 'partial');
    const latestRelease = releaseData.latest;
    const releaseFailed = latestRelease && ['failed', 'rejected'].includes(latestRelease.status);
    const emailFailures = Number(operations.emailFailures7d) || 0;
    const emailCapacity = getEmailCapacity(state.emailQuota);
    const emailQuotaCritical = emailCapacity.metrics.some((metric) => metric.percent >= QUOTA_DANGER_PERCENT);
    const emailQuotaWarning = emailCapacity.metrics.some((metric) => metric.percent >= QUOTA_WARNING_PERCENT);
    const danger = syncErrors.length > 0 || releaseFailed || emailFailures > 0 || emailQuotaCritical;
    const warning = !danger && (
      syncPartials.length > 0
      || syncWarnings.length > 0
      || Number(reportData.pending) > 0
      || Number(releaseData.active) > 0
      || (data.activeRuns ?? []).length > 0
      || emailQuotaWarning
    );
    const healthTone = danger ? 'danger' : warning ? 'warning' : 'success';
    const healthTitle = danger
      ? 'Une intervention est nécessaire'
      : warning ? 'Tout fonctionne, avec des points à suivre' : 'Tout fonctionne normalement';
    const healthText = danger
      ? 'Les éléments prioritaires sont regroupés ci-dessous.'
      : warning ? 'Aucun blocage critique. Les actions utiles sont listées au même endroit.'
        : 'Aucun signalement, incident de données ou échec de livraison à traiter.';
    const tasks = buildHomeTasks(payload).slice(0, 5);

    const pendingCount = Number(reportData.pending) || 0;
    setText('pending-nav-count', pendingCount);
    $('pending-nav-count').classList.toggle('hidden', pendingCount === 0);

    $('home-view').innerHTML = `
      <section class="hero-status ${healthTone}">
        <div class="status-icon">${danger ? '!' : warning ? '•' : '✓'}</div>
        <div>
          <p class="eyebrow">État général</p>
          <h3>${escapeHtml(healthTitle)}</h3>
          <p>${escapeHtml(healthText)}</p>
        </div>
        <span class="hero-time">${escapeHtml(formatDate(payload.generatedAt))}</span>
      </section>

      <section class="kpi-grid">
        ${kpiCard('À traiter', pendingCount, pendingCount ? 'Action requise' : 'File vide')}
        ${kpiCard('Recherches sur 7 jours', activity.routeSearches7d ?? 0, `${activity.routeSearches24h ?? 0} sur 24 h`)}
        ${kpiCard('Comptes inscrits', activity.usersTotal ?? 0, `${activity.activeUsers7d ?? 0} actifs sur 7 jours`)}
        ${kpiCard('Zones de services', `${osmSuccesses}/${OSM_REGIONS.length}`, dataActions.length ? `${dataActions.length} action${dataActions.length > 1 ? 's' : ''} requise${dataActions.length > 1 ? 's' : ''}` : 'Aucune intervention')}
      </section>

      ${renderPlanCapacity(capacityOperations, state.emailQuota)}

      <section class="section-grid">
        <article class="card">
          <div class="card-head">
            <div><h3>À faire maintenant</h3><p>Maximum cinq actions prioritaires.</p></div>
          </div>
          <div class="task-list">
            ${tasks.length ? tasks.map(renderTask).join('') : emptyInline('Rien à traiter pour le moment.')}
          </div>
        </article>

        <article class="card">
          <div class="card-head">
            <div><h3>Dernière version</h3><p>Suivi des mises à jour et publications.</p></div>
            <button class="link-button" data-go-view="releases" type="button">Voir tout</button>
          </div>
          ${renderLatestRelease(latestRelease)}
        </article>

        <article class="card wide-card">
          <div class="card-head">
            <div><h3>Fraîcheur des données</h3><p>Une ligne par source, sans masquer les échecs.</p></div>
            <button class="link-button" data-go-view="data" type="button">Gérer les données</button>
          </div>
          <div class="source-list">${renderHomeSources(latestSyncs)}</div>
        </article>
      </section>
    `;
  }

  function kpiCard(label, value, detail) {
    return `<article class="kpi-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNumberOrText(value))}</strong><small>${escapeHtml(detail)}</small></article>`;
  }

  function buildHomeTasks(payload) {
    const tasks = [];
    const reports = payload.reports ?? {};
    const data = payload.data ?? {};
    const releases = payload.releases ?? {};
    const operations = payload.operations ?? {};
    const latestSyncs = currentSyncRows(data.latestSyncs);
    const errors = latestSyncs.filter((item) => item.status === 'error' && !isAutomaticRetryPending(item));
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
        title: `${errors.length} source${errors.length > 1 ? 's' : ''} en échec`,
        text: 'Les anciennes données restent disponibles. Une relance est possible.',
        view: 'data',
        action: 'Vérifier',
      });
    } else if (transientErrors.length) {
      tasks.push({
        icon: '↻',
        tone: 'warning',
        title: `${transientErrors.length} zone${transientErrors.length > 1 ? 's' : ''} à relancer`,
        text: 'La source publique a été trop lente. Une relance automatique est prévue sans supprimer les anciennes données.',
        view: 'data',
        action: 'Suivre',
      });
    } else if (partials.length) {
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
        title: 'Version en cours de traitement',
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
    return `
      <div class="source-row">
        <span class="row-icon ${tone}">${run?.status === 'success' ? '✓' : run ? '!' : '?'}</span>
        <div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)} · ${run ? relativeDate(run.finishedAt || run.startedAt || run.requestedAt) : 'jamais vérifiée'}</p></div>
        <span class="pill ${tone}">${escapeHtml(syncRunStatusLabel(run))}</span>
      </div>
    `;
  }

  function homeOsmRow(runs) {
    const successes = runs.filter((run) => run.status === 'success').length;
    const errors = runs.filter((run) => run.status === 'error' && !isAutomaticRetryPending(run)).length;
    const transientErrors = runs.filter(isAutomaticRetryPending).length;
    const partials = runs.filter((run) => run.status === 'partial').length;
    const tone = errors ? 'danger' : transientErrors || partials || successes < OSM_REGIONS.length ? 'warning' : 'success';
    const latest = [...runs].sort((a, b) => dateValue(b.finishedAt || b.startedAt) - dateValue(a.finishedAt || a.startedAt))[0];
    return `
      <div class="source-row">
        <span class="row-icon ${tone}">${tone === 'success' ? '✓' : '!'}</span>
        <div><strong>Restaurants et services</strong><p>${successes}/${OSM_REGIONS.length} zones vérifiées · ${latest ? relativeDate(latest.finishedAt || latest.startedAt) : 'jamais vérifiée'}</p></div>
        <span class="pill ${tone}">${errors ? `${errors} échec${errors > 1 ? 's' : ''}` : transientErrors ? `${transientErrors} à relancer` : tone === 'success' ? 'À jour' : 'À suivre'}</span>
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

  function renderReports() {
    const list = visibleReports();
    const pendingCount = state.reports.filter((report) => report.status === 'pending').length;
    setText('pending-nav-count', pendingCount);
    $('pending-nav-count').classList.toggle('hidden', pendingCount === 0);
    $('reports-list').innerHTML = list.length
      ? list.map(renderReport).join('')
      : `<div class="empty">Aucun signalement dans cette vue.</div>`;
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
    invalidate('home', 'actions', 'data');
    await loadView('actions', true);
    showFeedback('Décision enregistrée.');
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
    const activeRuns = recent.filter((run) => ACTIVE_SYNC_STATUSES.has(run.status));
    const actionableRuns = latest.filter((run) => isActionableDataRun(run) && !isMatchingSyncActive(run, activeRuns));
    const automaticRetries = latest.filter((run) => isAutomaticRetryPending(run) && !isMatchingSyncActive(run, activeRuns));
    const osmSuccesses = osmRuns.filter((run) => run.status === 'success').length;
    const fuelActive = activeRuns.some((run) => run.source === 'fuel_prices_gov');
    const officialActive = activeRuns.some((run) => run.source === 'service_areas_operator');
    const osmActive = activeRuns.some((run) => run.source === 'service_areas_osm');

    $('data-view').innerHTML = `
      <section class="kpi-grid">
        ${kpiCard('Actions requises', actionableRuns.length, actionableRuns.length ? 'À relancer ci-dessous' : 'Aucune intervention')}
        ${kpiCard('Zones de services à jour', `${osmSuccesses}/${OSM_REGIONS.length}`, automaticRetries.length ? `${automaticRetries.length} relance${automaticRetries.length > 1 ? 's' : ''} automatique${automaticRetries.length > 1 ? 's' : ''} prévue${automaticRetries.length > 1 ? 's' : ''}` : 'Restaurants et services')}
        ${kpiCard('Stations avec prix disponible', counts.fuelPrices ?? 0, 'Source officielle des prix')}
        ${kpiCard('Corrections actives', counts.activeOverrides ?? 0, 'Modifications admin')}
      </section>

      ${renderDataActionPanel(actionableRuns, automaticRetries)}

      <section class="source-grid">
        ${renderSyncCard({
          title: 'Prix carburant',
          description: 'Prix officiels du gouvernement.',
          run: fuel,
          target: 'fuel_prices',
          active: fuelActive,
        })}
        ${renderSyncCard({
          title: 'Aires officielles',
          description: 'VINCI, APRR et SANEF.',
          run: official,
          target: 'service_areas',
          active: officialActive,
        })}
        ${renderOsmSyncCard(osmRuns, osmActive, actionableRuns)}
      </section>

      <section class="section-grid">
        <details class="card wide-card data-details" id="osm-zone-status">
          <summary>
            <div><strong>État des 14 zones</strong><p>Consulte ou actualise directement une zone précise.</p></div>
            <span class="pill ${actionableRuns.some((run) => run.source === 'service_areas_osm') ? 'danger' : automaticRetries.length ? 'warning' : 'success'}">${osmSuccesses}/${OSM_REGIONS.length} à jour</span>
          </summary>
          <div class="zone-list data-details-body">
            ${OSM_REGIONS.map((region) => renderOsmZoneRow(region, osmRuns, activeRuns)).join('')}
          </div>
        </details>

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
              <p>Enregistrements issus de plusieurs sources, parfois séparés par sens. Ce nombre ne représente pas des aires physiques uniques.</p>
            </article>
            <article>
              <span>Stations avec prix disponible</span>
              <strong>${formatNumber(counts.fuelPrices ?? 0)}</strong>
              <p>Une ligne par station ayant au moins un prix officiel exploitable. Ce volume n’est pas comparable au nombre de fiches techniques d’aires.</p>
            </article>
            <article>
              <span>Aires physiques uniques</span>
              <strong>Non calculé</strong>
              <p>Le chiffre ne sera affiché qu’après un regroupement fiable des sources, des sens de circulation et des identifiants officiels.</p>
            </article>
          </div>
        </details>

        <article class="card wide-card">
          <details ${state.overrides.length && state.overrides.length <= 5 ? 'open' : ''}>
            <summary><strong>Corrections administrateur (${state.overrides.length})</strong></summary>
            <div class="stack" style="margin-top:14px">
              ${state.overrides.length ? state.overrides.map(renderOverride).join('') : emptyInline('Aucune correction active.')}
            </div>
          </details>
        </article>
      </section>
    `;
  }

  function renderDataActionPanel(actionableRuns, automaticRetries) {
    const actionableOsmRuns = actionableRuns.filter((run) => run.source === 'service_areas_osm' && run.region);
    const bulk = state.bulkSync;
    const tone = actionableRuns.length ? 'danger' : automaticRetries.length ? 'warning' : 'success';
    const title = bulk.active
      ? `Relance progressive ${bulk.completed}/${bulk.total}`
      : actionableRuns.length ? `${actionableRuns.length} action${actionableRuns.length > 1 ? 's' : ''} requise${actionableRuns.length > 1 ? 's' : ''}`
        : automaticRetries.length ? 'Relance automatique prévue' : 'Aucune action requise';
    const detail = bulk.active
      ? `${REGION_LABELS[bulk.region] || 'Zone'} est en cours. La zone suivante attendra la fin de celle-ci. Garde cette page ouverte.`
      : actionableRuns.length ? 'Les anciennes données restent disponibles pendant la relance.'
        : automaticRetries.length ? 'La source publique sera retentée automatiquement. Aucune manipulation nécessaire.'
          : 'Toutes les sources sont utilisables. Les données techniques restent accessibles plus bas.';

    return `
      <section class="data-action-panel ${tone}">
        <div class="data-action-head">
          <div>
            <p class="eyebrow">À traiter maintenant</p>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(detail)}</p>
          </div>
          ${actionableOsmRuns.length > 1 || bulk.active ? `
            <button class="${bulk.active ? 'ghost' : ''}" data-sync-all-regions type="button" ${bulk.active ? 'disabled' : ''}>
              ${bulk.active ? `${bulk.completed}/${bulk.total} zones` : `Relancer les ${actionableOsmRuns.length} zones`}
            </button>
          ` : ''}
        </div>
        <div class="data-action-list">
          ${actionableRuns.map((run) => renderDataActionRow(run, false)).join('')}
          ${automaticRetries.map((run) => renderDataActionRow(run, true)).join('')}
          ${!actionableRuns.length && !automaticRetries.length ? '<div class="data-clear-state"><span>✓</span><p>Rien à chercher dans l’historique : aucune relance manuelle n’est nécessaire.</p></div>' : ''}
        </div>
      </section>
    `;
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
        <div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(message)} · ${escapeHtml(relativeDate(run.finishedAt || run.startedAt || run.requestedAt))}</p></div>
        <span class="pill ${tone}">${escapeHtml(status)}</span>
        ${automatic ? '<span class="data-action-wait">Automatique</span>' : `
          <button class="ghost small" data-sync-target="${escapeHtml(target)}" ${run.region ? `data-sync-region="${escapeHtml(run.region)}"` : ''} type="button" ${state.bulkSync.active ? 'disabled' : ''}>Relancer</button>
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
          <p style="margin-top:8px">${run ? `Dernier résultat ${escapeHtml(relativeDate(run.finishedAt || run.startedAt || run.requestedAt))}` : 'Aucun résultat enregistré.'}</p>
          ${run?.message ? `<p style="margin-top:6px;color:var(--red)">${escapeHtml(friendlySyncError(run.message))}</p>` : ''}
        </div>
        <div class="source-actions">
          <button data-sync-target="${escapeHtml(target)}" type="button" ${active || state.bulkSync.active ? 'disabled' : ''}>${active ? 'Mise à jour en cours…' : 'Actualiser maintenant'}</button>
        </div>
      </article>
    `;
  }

  function renderOsmSyncCard(runs, active, actionableRuns) {
    const successes = runs.filter((run) => run.status === 'success').length;
    const actions = actionableRuns.filter((run) => run.source === 'service_areas_osm').length;
    const automaticRetries = runs.filter(isAutomaticRetryPending).length;
    const tone = actions ? 'danger' : automaticRetries || successes < OSM_REGIONS.length ? 'warning' : 'success';
    return `
      <article class="source-card">
        <div>
          <span class="pill ${tone}">${successes}/${OSM_REGIONS.length} zones à jour</span>
          <h3>Restaurants et services</h3>
          <p>Données OpenStreetMap vérifiées par zone.</p>
          ${actions ? `<p style="margin-top:8px;color:var(--red)">${actions} zone${actions > 1 ? 's nécessitent' : ' nécessite'} une relance.</p>` : ''}
          ${automaticRetries ? `<p style="margin-top:8px">${automaticRetries} zone${automaticRetries > 1 ? 's seront relancées' : ' sera relancée'} automatiquement.</p>` : ''}
        </div>
        <div class="source-actions">
          <button class="ghost" data-show-zones type="button">Voir les 14 zones</button>
          ${active ? '<span class="pill info">Mise à jour en cours</span>' : ''}
        </div>
      </article>
    `;
  }

  function renderOsmZoneRow(region, runs, activeRuns) {
    const run = runs.find((item) => item.region === region);
    const active = activeRuns.some((item) => item.source === 'service_areas_osm' && item.region === region);
    const tone = active ? 'info' : syncRunTone(run);
    const status = active ? 'En cours' : syncRunStatusLabel(run);
    const detail = run
      ? `${escapeHtml(relativeDate(run.finishedAt || run.startedAt || run.requestedAt))}${run.message ? ` · ${escapeHtml(friendlySyncError(run.message))}` : ''}`
      : 'Aucun résultat enregistré.';
    return `
      <div class="zone-row">
        <span class="row-icon ${tone}">${active ? '↻' : run?.status === 'success' ? '✓' : run ? '!' : '?'}</span>
        <div><strong>${escapeHtml(REGION_LABELS[region])}</strong><p>${detail}</p></div>
        <span class="pill ${tone}">${escapeHtml(status)}</span>
        <button class="ghost small" data-sync-target="osm_region" data-sync-region="${escapeHtml(region)}" type="button" ${active || state.bulkSync.active ? 'disabled' : ''}>Actualiser</button>
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
        <span class="pill ${tone}">${escapeHtml(syncRunStatusLabel(run))}</span>
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

  async function handleDataAction(event) {
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
        state.bulkSync.completed = index + 1;
      }
    } catch (error) {
      failureMessage = String(error?.message || 'La relance progressive a été interrompue.');
    } finally {
      state.bulkSync = { active: false, completed: 0, total: 0, region: null };
      invalidate('home', 'data');
      await loadView('data', true);
      showFeedback(failureMessage || `${regions.length} zones ont été relancées une par une.`);
    }
  }

  async function waitForSyncRun(runId) {
    if (!runId) return null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < SYNC_WAIT_TIMEOUT_MS) {
      await delay(SYNC_POLL_INTERVAL_MS);
      const payload = await query(client.rpc('admin_data_v2'));
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
      invalidate('home', 'data');
      await loadView('data', true);
      showFeedback('Correction enregistrée.');
    } catch (error) {
      showFeedback('La correction n’a pas pu être enregistrée.');
    } finally {
      button.disabled = false;
    }
  }

  function renderReleases() {
    const releases = state.releases;
    const latest = releases[0] ?? null;
    const command = 'npm run update:production -- --message "Description de la mise à jour"';
    const previewCommand = 'npm run update:preview -- --message "Test avant production"';
    const iosCommand = 'npm run build:ios:testflight -- --message "Nouvelle version iOS"';
    const androidPreviewCommand = 'npm run build:android:internal -- --message "Test Android sur téléphone"';
    const androidPlayCommand = 'npm run build:android:play -- --message "Nouvelle version Android"';
    const heroStatus = latest ? releaseStatusText(latest) : 'Suivi prêt';
    const heroTitle = latest ? releaseLabel(latest) : 'Prochaine mise à jour';
    const heroMessage = latest
      ? latest.error_summary || latest.message || 'Statut enregistré automatiquement.'
      : 'Les prochaines mises à jour EAS seront enregistrées ici du contrôle initial au résultat final.';
    const progress = latest ? releaseProgress(latest) : 0;

    $('releases-view').innerHTML = `
      <section class="release-hero">
        <div>
          <p class="eyebrow">${escapeHtml(heroStatus)}</p>
          <h3>${escapeHtml(heroTitle)}</h3>
          <p>${escapeHtml(heroMessage)}</p>
          <div class="progress"><i style="width:${progress}%"></i></div>
        </div>
        <div class="release-side">
          <strong>${latest ? escapeHtml(relativeDate(latest.updated_at)) : '—'}</strong>
          <span>${latest ? escapeHtml(latest.channel || latest.environment) : 'Aucune publication suivie'}</span>
        </div>
      </section>

      <section class="release-tools">
        <div>
          <strong>Choisir le bon type de livraison</strong>
          <p>Interface ou JavaScript : mise à jour OTA. Icône, permission ou dépendance native : nouveau build.</p>
        </div>
        <a href="${EXPO_BUILDS_URL}" target="_blank" rel="noopener noreferrer">Ouvrir les builds Expo</a>
      </section>

      <section class="section-grid">
        <article class="card wide-card">
          <div class="card-head"><div><h3>Correction sans nouveau build</h3><p>À utiliser pour les changements d’interface ou de logique JavaScript.</p></div></div>
          <div class="release-command-grid">
            <div class="command-block">
              <h4>1. Tester sur le canal preview</h4>
              <div class="command-wrap">
                <pre class="command">${escapeHtml(previewCommand)}</pre>
                <button class="ghost small" data-copy-command="${escapeHtml(previewCommand)}" type="button">Copier</button>
              </div>
            </div>
            <div class="command-block">
              <h4>2. Publier en production après validation</h4>
              <div class="command-wrap">
                <pre class="command">${escapeHtml(command)}</pre>
                <button class="ghost small" data-copy-command="${escapeHtml(command)}" type="button">Copier</button>
              </div>
            </div>
          </div>
        </article>

        <article class="card">
          <div class="card-head"><div><h3>Nouvelle version iOS</h3><p>Build natif pour TestFlight puis l’App Store.</p></div></div>
          <div class="command-wrap">
            <pre class="command">${escapeHtml(iosCommand)}</pre>
            <button class="ghost small" data-copy-command="${escapeHtml(iosCommand)}" type="button">Copier</button>
          </div>
        </article>

        <article class="card">
          <div class="card-head"><div><h3>Nouvelle version Android</h3><p>Commencer par l’APK installable. Créer l’AAB seulement après validation.</p></div></div>
          <div class="command-block">
            <h4>APK de test sur téléphone</h4>
            <div class="command-wrap">
              <pre class="command">${escapeHtml(androidPreviewCommand)}</pre>
              <button class="ghost small" data-copy-command="${escapeHtml(androidPreviewCommand)}" type="button">Copier</button>
            </div>
          </div>
          <div class="command-block">
            <h4>AAB pour le test fermé Google Play</h4>
            <div class="command-wrap">
              <pre class="command">${escapeHtml(androidPlayCommand)}</pre>
              <button class="ghost small" data-copy-command="${escapeHtml(androidPlayCommand)}" type="button">Copier</button>
            </div>
          </div>
        </article>

        <article class="card wide-card">
          <div class="card-head"><div><h3>Historique des versions</h3><p>Plateforme, environnement et état réel de chaque livraison.</p></div></div>
          <div class="history-list">
            ${releases.length ? releases.map(renderReleaseRow).join('') : emptyInline('Aucune version suivie pour le moment.')}
          </div>
        </article>
      </section>
    `;
  }

  function renderReleaseRow(release) {
    const tone = releaseTone(release.status);
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
    const analytics = state.analytics;
    if (!analytics) {
      $('stats-view').innerHTML = loadingMarkup('des statistiques');
      return;
    }
    const totals = analytics.totals ?? {};
    const daily = Array.isArray(analytics.daily) ? analytics.daily : [];
    const topRoutes = Array.isArray(analytics.topRoutes) ? analytics.topRoutes : [];
    const topStations = Array.isArray(analytics.topStations) ? analytics.topStations : [];
    const topBrands = Array.isArray(analytics.topBrands) ? analytics.topBrands : [];
    const fuelPreferences = Array.isArray(analytics.fuelPreferences) ? analytics.fuelPreferences : [];

    $('stats-view').innerHTML = `
      <div class="toolbar">
        <div><strong>Période analysée</strong><p class="hint">Les calculs restent agrégés et rapides.</p></div>
        <div class="segmented" id="analytics-period">
          ${[7, 30, 90].map((days) => `<button class="${state.analyticsDays === days ? 'active' : ''}" data-analytics-days="${days}" type="button">${days} jours</button>`).join('')}
        </div>
      </div>

      <section class="kpi-grid">
        ${kpiCard('Utilisateurs actifs', totals.activeUsers ?? 0, `Sur ${analytics.days} jours`)}
        ${kpiCard('Recherches trajet', totals.routeSearches ?? 0, 'Demandes de trajet')}
        ${kpiCard('Fiches consultées', totals.stationViews ?? 0, 'Ouvertures d’aires')}
        ${kpiCard('Distance moyenne', totals.averageDistanceKm ?? 0, 'Kilomètres par trajet')}
      </section>

      <section class="section-grid">
        <article class="card chart-card wide-card">
          <div class="card-head"><div><h3>Recherches de trajet</h3><p>Évolution quotidienne sur la période.</p></div><span class="pill info">${formatNumber(totals.routeSearches ?? 0)} total</span></div>
          ${renderSparkline(daily)}
        </article>
        <article class="card">
          <div class="card-head"><div><h3>Trajets les plus recherchés</h3><p>Départ et destination déclarés.</p></div></div>
          ${renderBarList(topRoutes, (item) => `${item.departure} → ${item.arrival}`, (item) => item.searches)}
        </article>
        <article class="card">
          <div class="card-head"><div><h3>Aires les plus consultées</h3><p>Consultations de fiches.</p></div></div>
          ${renderBarList(topStations, (item) => item.name, (item) => item.views)}
        </article>
        <article class="card">
          <div class="card-head"><div><h3>Enseignes consultées</h3><p>Répartition des vues d’aires.</p></div></div>
          ${renderBarList(topBrands, (item) => item.brand, (item) => item.views)}
        </article>
        <article class="card">
          <div class="card-head"><div><h3>Carburants préférés</h3><p>Préférences enregistrées dans les comptes.</p></div></div>
          ${renderBarList(fuelPreferences, (item) => item.fuel, (item) => item.users)}
        </article>
      </section>
    `;
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
  }

  function renderMaintenance() {
    const operations = state.operations;
    if (!operations) {
      $('maintenance-view').innerHTML = loadingMarkup('de la maintenance');
      return;
    }
    const users = operations.users ?? {};
    const database = operations.database ?? {};
    const emails = operations.emails ?? {};
    const activity = operations.activity ?? {};
    const automation = operations.automation ?? {};
    const config = readConfig();
    const usageUrl = safeExternalUrl(config.usageUrl);
    const homeSyncs = state.home?.data?.latestSyncs;
    const currentSyncFailures = Array.isArray(homeSyncs)
      ? currentSyncRows(homeSyncs).filter((run) => run.status === 'error' && !isAutomaticRetryPending(run)).length
      : Number(automation.syncFailures24h) || 0;
    const emailCapacity = getEmailCapacity(state.emailQuota);
    const emailDaily = emailCapacity.metrics.find((metric) => metric.key === 'email-day');
    const emailMonthly = emailCapacity.metrics.find((metric) => metric.key === 'email-month');

    $('maintenance-view').innerHTML = `
      ${renderPlanCapacity(operations, state.emailQuota, true)}

      <section class="maintenance-grid">
        ${maintenanceCard('Comptes inscrits', users.total ?? 0, `${users.new7d ?? 0} nouveaux sur 7 jours`)}
        ${maintenanceCard('Actifs estimés', users.signedIn30d ?? 0, 'Comptes connectés sur 30 jours')}
        ${maintenanceCard('Taille de la base', formatBytes(database.bytes ?? 0), 'Stockage PostgreSQL')}
        ${maintenanceCard('Tâches planifiées', `${automation.cronActive ?? 0}/${automation.cronTotal ?? 0}`, 'Actives / configurées')}
        ${maintenanceCard('Connexions base', `${database.connections ?? 0}/${database.maxConnections ?? 0}`, `${database.connectionPercent ?? 0}% utilisé`)}
        ${maintenanceCard('Quota e-mail du jour', `${emailDaily?.usedLabel ?? 0}/${emailDaily?.limitLabel ?? 100}`, formatPercent(emailDaily?.percent ?? 0))}
        ${maintenanceCard('Quota e-mail du mois', `${emailMonthly?.usedLabel ?? 0}/${emailMonthly?.limitLabel ?? 3000}`, formatPercent(emailMonthly?.percent ?? 0))}
        ${maintenanceCard('Échecs e-mail', emails.failed7d ?? 0, 'Échecs, rebonds ou plaintes')}
      </section>

      <section class="section-grid">
        <article class="card">
          <div class="card-head"><div><h3>Base et automatisations</h3><p>État technique utile, sans détails internes inutiles.</p></div></div>
          <div class="source-list">
            ${maintenanceRow('Tâches planifiées', Number(automation.cronActive) === Number(automation.cronTotal), `${automation.cronActive ?? 0} actives sur ${automation.cronTotal ?? 0}`)}
            ${maintenanceRow('Sources en échec actuellement', currentSyncFailures === 0, `${currentSyncFailures} source(s) concernée(s)`)}
            ${maintenanceRow('Connexions PostgreSQL', Number(database.connectionPercent) < 80, `${database.connectionPercent ?? 0}% de la capacité`)}
          </div>
          ${usageUrl ? `<p style="margin-top:14px"><a href="${escapeHtml(usageUrl)}" target="_blank" rel="noopener noreferrer">Ouvrir l’utilisation Supabase</a></p>` : ''}
        </article>

        <article class="card">
          <div class="card-head"><div><h3>E-mails techniques</h3><p>Quotas Resend, alertes et événements de livraison.</p></div></div>
          <div class="source-list">
            ${maintenanceRow('Quota quotidien', (emailDaily?.percent ?? 0) < QUOTA_WARNING_PERCENT, `${emailDaily?.usedLabel ?? 0}/${emailDaily?.limitLabel ?? 100} unité(s) · ${formatPercent(emailDaily?.percent ?? 0)}`)}
            ${maintenanceRow('Quota mensuel', (emailMonthly?.percent ?? 0) < QUOTA_WARNING_PERCENT, `${emailMonthly?.usedLabel ?? 0}/${emailMonthly?.limitLabel ?? 3000} unité(s) · ${formatPercent(emailMonthly?.percent ?? 0)}`)}
            ${maintenanceRow('Livraison sur 7 jours', Number(emails.failed7d) === 0, `${emails.delivered7d ?? 0} livrés · ${emails.failed7d ?? 0} échec(s)`)}
            ${maintenanceRow('Dernier événement reçu', Boolean(emailCapacity.lastEventAt), emailCapacity.lastEventAt ? relativeDate(emailCapacity.lastEventAt) : 'Aucun événement')}
            ${maintenanceRow('Suivi Resend', emailCapacity.trackingActive, emailCapacity.trackingActive ? `Actif depuis ${formatDate(emailCapacity.trackedSince)}` : 'Pas encore initialisé')}
          </div>
        </article>

        <article class="card wide-card">
          <div class="card-head"><div><h3>Diagnostic partageable</h3><p>Résumé sans clé, adresse utilisateur ni donnée sensible.</p></div><button class="ghost small" data-copy-diagnostic type="button">Copier</button></div>
          <pre class="command">${escapeHtml(diagnosticText({ users, database, emails, emailQuota: state.emailQuota, activity, automation }))}</pre>
        </article>
      </section>
    `;
  }

  function getSupabaseCapacity(operations = {}) {
    const config = readConfig();
    const users = operations?.users ?? {};
    const database = operations?.database ?? {};
    const monthlyActiveUsersLimit = Number(config.limits.monthlyActiveUsers) || 0;
    const databaseBytesLimit = Number(config.limits.databaseBytes) || 0;
    const monthlyActiveUsers = Number(users.signedIn30d) || 0;
    const databaseBytes = Number(database.bytes) || 0;

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
          usedLabel: formatNumber(monthlyActiveUsers),
          limitLabel: formatNumber(monthlyActiveUsersLimit),
          remainingLabel: `${formatNumber(Math.max(0, monthlyActiveUsersLimit - monthlyActiveUsers))} disponibles`,
          detail: 'Estimation à partir des connexions des 30 derniers jours',
        }),
        quotaMetric({
          key: 'database',
          label: 'Base de données',
          shortLabel: 'Base',
          used: databaseBytes,
          limit: databaseBytesLimit,
          usedLabel: formatBytes(databaseBytes),
          limitLabel: formatBytes(databaseBytesLimit),
          remainingLabel: `${formatBytes(Math.max(0, databaseBytesLimit - databaseBytes))} disponibles`,
          detail: 'Taille PostgreSQL mesurée en direct',
        }),
      ],
    };
  }

  function getEmailCapacity(quota = {}) {
    const config = readConfig();
    const dailyLimit = Number(config.limits.emailDailyUnits) || 0;
    const monthlyLimit = Number(config.limits.emailMonthlyUnits) || 0;
    const usedToday = Number(quota?.usedToday) || 0;
    const usedMonth = Number(quota?.usedMonth) || 0;

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
          usedLabel: formatNumber(usedToday),
          limitLabel: formatNumber(dailyLimit),
          remainingLabel: `${formatNumber(Math.max(0, dailyLimit - usedToday))} disponibles`,
          detail: quota?.nextDayAt ? `Remise à zéro ${relativeDate(quota.nextDayAt)}` : 'Quota quotidien Resend',
        }),
        quotaMetric({
          key: 'email-month',
          label: 'E-mails ce mois-ci',
          shortLabel: 'Mois',
          used: usedMonth,
          limit: monthlyLimit,
          usedLabel: formatNumber(usedMonth),
          limitLabel: formatNumber(monthlyLimit),
          remainingLabel: `${formatNumber(Math.max(0, monthlyLimit - usedMonth))} disponibles`,
          detail: quota?.nextMonthAt ? `Remise à zéro ${formatDate(quota.nextMonthAt)}` : 'Quota mensuel Resend',
        }),
      ],
    };
  }

  function quotaMetric(metric) {
    const percent = metric.limit > 0 ? (metric.used / metric.limit) * 100 : 0;
    return {
      ...metric,
      percent,
      tone: percent >= QUOTA_DANGER_PERCENT
        ? 'danger'
        : percent >= QUOTA_WARNING_PERCENT ? 'warning' : 'success',
    };
  }

  function renderPlanCapacity(operations, emailQuota, detailed = false) {
    const supabaseCapacity = getSupabaseCapacity(operations);
    const emailCapacity = getEmailCapacity(emailQuota);
    const supabasePlanName = supabaseCapacity.plan === 'free' ? 'gratuit' : supabaseCapacity.plan;
    const emailPlanName = emailCapacity.plan === 'free' ? 'gratuit' : emailCapacity.plan;
    return `
      <section class="capacity-panel">
        <div class="capacity-head">
          <div>
            <p class="eyebrow">Capacité et quotas</p>
            <h3>Plans gratuits sous contrôle</h3>
            <p>Supabase ${escapeHtml(supabasePlanName)} · Resend ${escapeHtml(emailPlanName)} · ${formatNumber(supabaseCapacity.totalUsers)} compte${supabaseCapacity.totalUsers > 1 ? 's' : ''}.</p>
          </div>
          <div class="capacity-links">
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
          <span class="pill ${escapeHtml(metric.tone)}">${escapeHtml(formatPercent(metric.percent))}</span>
        </div>
        <div class="quota-values"><strong>${escapeHtml(metric.usedLabel)}</strong><span>sur ${escapeHtml(metric.limitLabel)}</span></div>
        <div class="quota-track" role="progressbar" aria-label="${escapeHtml(metric.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(metric.percent))}"><i style="width:${visualPercent}%"></i></div>
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
        live.lastChild.textContent = connected ? 'Direct' : 'Reconnexion';
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
    if (!Array.isArray(rows)) return [];
    return rows.filter((run) => (
      run.source !== 'service_areas_osm' || OSM_REGIONS.includes(run.region)
    ));
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
    if (!isTransientSyncError(run) || run.triggerSource !== 'schedule') return false;
    const failedAt = dateValue(run.finishedAt || run.startedAt || run.requestedAt);
    return failedAt > 0 && Date.now() - failedAt < 3 * 60 * 60 * 1000;
  }

  function isActionableDataRun(run) {
    if (!run || ACTIVE_SYNC_STATUSES.has(run.status)) return false;
    if (!['error', 'partial'].includes(run.status)) return false;
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
    if (run?.status === 'partial') return 'Mise à jour incomplète';
    if (isTransientSyncError(run) && run?.triggerSource === 'retry') return 'Relance automatique échouée';
    if (isTransientSyncError(run) && run?.triggerSource === 'admin') return 'Relance manuelle échouée';
    return 'Échec à traiter';
  }

  function syncRunStatusLabel(run) {
    return isAutomaticRetryPending(run) ? 'Relance prévue' : syncStatusLabel(run?.status);
  }

  function syncRunTone(run) {
    return isAutomaticRetryPending(run) || run?.status === 'partial' ? 'warning' : syncTone(run?.status);
  }

  function reportStatusTone(status) {
    if (status === 'reviewed') return 'success';
    if (status === 'rejected') return 'danger';
    return 'warning';
  }

  function friendlySyncError(message) {
    const value = String(message || '').toLowerCase();
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

  function releaseStatusText(release) {
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
