(() => {
  const CONFIG_KEY = 'routestop_admin_supabase_v1';
  const OSM_SYNC_REGIONS = new Set([
    'north_1', 'north_2', 'north_3a', 'north_3b', 'north_4', 'north_5',
    'center_1', 'center_2', 'center_3', 'center_4',
    'south_1', 'south_2', 'south_3', 'south_4',
  ]);
  const OSM_SYNC_REGION_COUNT = OSM_SYNC_REGIONS.size;
  const OSM_REGION_LABELS = {
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

  const typeLabels = {
    brand_closed: 'Enseigne fermée',
    brand_missing: 'Enseigne manquante',
    wrong_brand: 'Mauvaise enseigne',
    service_closed: 'Service fermé',
    service_missing: 'Service manquant',
    wrong_price: 'Prix incorrect',
    other: 'Autre',
  };

  const statusLabels = {
    pending: 'À traiter',
    reviewed: 'Traité',
    rejected: 'Rejeté',
  };

  const viewTitles = {
    dashboard: ['Vue globale', 'Accueil'],
    reports: ['Modération', 'Signalements'],
    data: ['Base applicative', 'Corrections actives'],
    automation: ['Contrôle', 'Mises à jour'],
    analytics: ['Monétisation', 'Statistiques d’utilisation'],
  };

  let client = null;
  let session = null;
  let reports = [];
  let overrides = [];
  let profiles = [];
  let favorites = [];
  let notes = [];
  let events = [];
  let syncRuns = [];
  let fuelPrices = [];
  let serviceAreas = [];
  let stats = {};
  let operations = {};
  let statusFilter = 'pending';
  let search = '';
  let activeView = 'dashboard';

  const $ = (id) => document.getElementById(id);

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function syncStatusLabel(status) {
    if (status === 'success') return 'Réussi';
    if (status === 'error') return 'À relancer';
    return 'Inconnu';
  }

  function syncSourceLabel(source) {
    if (source === 'fuel_prices_gov') return 'Prix carburant';
    if (source === 'service_areas_operator') return 'Liste officielle des aires';
    if (source === 'service_areas_osm') return 'Restaurants et services';
    return 'Mise à jour des données';
  }

  function regionLabel(region) {
    return OSM_REGION_LABELS[region] || 'Zone autoroutière';
  }

  function friendlySyncError(message) {
    const value = String(message || '').toLowerCase();
    if (/timeout|timed out|aborted|http 504|http 502|http 503/.test(value)) {
      return 'La source publique n’a pas répondu à temps. Les données précédentes restent disponibles.';
    }
    if (/no_motorway_geometry/.test(value)) {
      return 'Aucune autoroute reconnue dans cette zone.';
    }
    if (/no_osm_service_areas|no_osm_details/.test(value)) {
      return 'Aucune aire n’a pu être confirmée pendant ce passage. Les données précédentes restent disponibles.';
    }
    return 'La mise à jour n’a pas abouti. Les données précédentes restent disponibles.';
  }

  function readConfig() {
    const fromWindow = window.ROUTESTOP_SUPABASE ?? {};
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}');
      return {
        url: fromWindow.url || saved.url || '',
        anonKey: fromWindow.anonKey || saved.anonKey || '',
        managed: fromWindow.managed === true,
        plan: fromWindow.plan || 'free',
        limits: fromWindow.limits || {},
        usageUrl: fromWindow.usageUrl || '',
      };
    } catch {
      return {
        url: fromWindow.url || '',
        anonKey: fromWindow.anonKey || '',
        managed: fromWindow.managed === true,
        plan: fromWindow.plan || 'free',
        limits: fromWindow.limits || {},
        usageUrl: fromWindow.usageUrl || '',
      };
    }
  }

  function saveConfig(config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }

  function setText(id, text) {
    $(id).textContent = text;
  }

  function setHidden(id, hidden) {
    $(id).classList.toggle('hidden', hidden);
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
      if (!client && !initClient()) {
        setText('auth-state', 'Configuration Supabase manquante : renseigne le bloc Supabase au-dessus.');
        return;
      }
      setText('auth-state', 'Connexion en cours...');
      const { error } = await client.auth.signInWithPassword({
        email: $('email').value.trim(),
        password: $('password').value,
      });
      setText('auth-state', error ? error.message : '');
    });

    $('logout-btn').addEventListener('click', async () => {
      if (client) await client.auth.signOut();
      session = null;
      reports = [];
      overrides = [];
      renderAll();
      await renderSession();
    });

    $('refresh-btn').addEventListener('click', loadAdminData);

    document.querySelectorAll('.nav').forEach((button) => {
      button.addEventListener('click', () => setView(button.dataset.view));
    });

    $('status-tabs').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-status]');
      if (!button) return;
      statusFilter = button.dataset.status;
      for (const item of $('status-tabs').querySelectorAll('button')) {
        item.classList.toggle('active', item === button);
      }
      renderReports();
    });

    $('search').addEventListener('input', (event) => {
      search = event.target.value.trim().toLowerCase();
      renderReports();
    });

    $('reports-list').addEventListener('click', handleReportAction);
    $('data-view').addEventListener('click', handleOverrideAction);
    $('automation-view').addEventListener('click', handleAutomationAction);
    $('dashboard-view').addEventListener('click', handleAutomationAction);
  }

  function setView(view) {
    activeView = view;
    const [eyebrow, title] = viewTitles[view] ?? viewTitles.dashboard;
    setText('view-eyebrow', eyebrow);
    setText('view-title', title);
    document.querySelectorAll('.nav').forEach((button) => {
      button.classList.toggle('active', button.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach((panel) => panel.classList.add('hidden'));
    $(`${view}-view`).classList.remove('hidden');
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

    const admin = await isAdmin();
    if (!admin) {
      setHidden('setup-panel', true);
      setHidden('denied-panel', false);
      $('admin-sql').textContent = `insert into public.admin_users (id)\nvalues ('${session.user.id}')\non conflict (id) do nothing;`;
      return;
    }

    setHidden('app-shell', false);
    setView(activeView);
    await loadAdminData();
  }

  async function isAdmin() {
    const { data, error } = await client.rpc('is_admin');
    if (error) {
      setHidden('denied-panel', false);
      $('admin-sql').textContent = 'Applique supabase/schema.sql puis relance la page admin.';
      return false;
    }
    return data === true;
  }

  async function query(name, promise, fallback) {
    const { data, error } = await promise;
    if (error) {
      showFeedback(`${name}: ${error.message}`);
      return fallback;
    }
    return data ?? fallback;
  }

  async function loadAdminData() {
    if (!client || !session) return;
    showFeedback('Chargement...');

    const [
      statsData,
      operationsData,
      reportsData,
      overridesData,
      profilesData,
      favoritesData,
      notesData,
      eventsData,
      syncRunsData,
      fuelPricesData,
      serviceAreasData,
    ] = await Promise.all([
      query('Stats', client.rpc('admin_dashboard_stats'), {}),
      query('Supervision', client.rpc('admin_operations_v1'), {}),
      query('Signalements', client.from('station_reports').select('*').order('created_at', { ascending: false }).limit(500), []),
      query('Corrections', client.from('station_overrides').select('*').order('updated_at', { ascending: false }).limit(500), []),
      query('Profils', client.from('profiles').select('id, pseudo, preferred_fuel, favorite_brands, favorite_tenants, updated_at').limit(1000), []),
      query('Favoris', client.from('station_favorites').select('station_id, station_name, station_brand, created_at').limit(1500), []),
      query('Notes', client.from('station_notes').select('station_id, station_name, station_brand, rating, updated_at').limit(1500), []),
      query('Analytics', client.from('analytics_events').select('*').order('created_at', { ascending: false }).limit(2000), []),
      query('Synchros', client.from('data_sync_runs').select('*').order('started_at', { ascending: false }).limit(50), []),
      query('Prix carburant', client.from('fuel_price_snapshots').select('station_id, city, department, synced_at, source_updated_at').order('synced_at', { ascending: false }).limit(25), []),
      query('Aires centralisées', client.from('service_area_snapshots').select('area_id, name, operator_source, synced_at').order('synced_at', { ascending: false }).limit(25), []),
    ]);

    stats = statsData;
    operations = operationsData;
    reports = reportsData;
    overrides = overridesData;
    profiles = profilesData;
    favorites = favoritesData;
    notes = notesData;
    events = eventsData;
    syncRuns = syncRunsData;
    fuelPrices = fuelPricesData;
    serviceAreas = serviceAreasData;
    showFeedback(`Données vérifiées ${formatDate(new Date().toISOString())}`);
    renderAll();
  }

  function renderAll() {
    renderDashboard();
    renderReports();
    renderData();
    renderAutomation();
    renderAnalytics();
  }

  function renderDashboard() {
    const latestReports = reports.slice(0, 4).map(renderSmallReport).join('');
    const alerts = [...buildOperationsAlerts(), ...buildAutomationAlerts()];
    const health = operationsHealth(alerts);
    const users = operations.users || {};
    const activity = operations.activity || {};
    const database = operations.database || {};
    const emails = operations.emails || {};
    const automation = operations.automation || {};
    const syncProblems = buildAutomationAlerts().filter((alert) => alert.category === 'sync').length;
    const limits = monitoringLimits();
    const mauPercent = percent(users.signedIn30d || 0, limits.monthlyActiveUsers);
    const databasePercent = percent(database.bytes || 0, limits.databaseBytes);
    const urgentReports = reports
      .filter((report) => report.status === 'pending')
      .map((report) => ({ report, priority: reportPriorityInfo(report) }))
      .sort((a, b) => b.priority.score - a.priority.score)
      .slice(0, 3);
    $('dashboard-view').innerHTML = `
      <section class="ops-hero ${escapeHtml(health.tone)}">
        <div class="ops-status-icon"><span></span></div>
        <div class="ops-hero-copy">
          <p class="eyebrow">État de RouteStop</p>
          <h3>${escapeHtml(health.title)}</h3>
          <p>${escapeHtml(health.text)}</p>
        </div>
        <div class="ops-hero-meta">
          <span class="pill ${escapeHtml(health.tone)}">${escapeHtml(health.label)}</span>
          <small>${operations.generatedAt ? `Mesuré ${formatDate(operations.generatedAt)}` : 'Métriques indisponibles'}</small>
        </div>
      </section>

      <div class="ops-grid">
        ${opsCard('Comptes inscrits', users.total ?? stats.users ?? profiles.length, `+${users.new7d || 0} sur 7 jours`, 'users')}
        ${opsCard('Actifs dans l’app', activity.activeUsers7d ?? '-', `${activity.activeUsers24h || 0} sur 24 h`, 'activity')}
        ${opsCard('E-mails envoyés', emails.sent7d ?? '-', `${emails.failed7d || 0} échec sur 7 jours`, emails.failed7d ? 'warning' : 'email')}
        ${opsCard('Mises à jour prévues', `${automation.cronActive ?? '-'}/${automation.cronTotal ?? '-'}`, syncProblems ? `${syncProblems} problème(s) actif(s)` : 'Aucun problème actif', syncProblems ? 'warning' : 'success')}
      </div>

      <div class="monitoring-grid">
        <article class="panel inner health-panel">
          <div class="panel-head compact">
            <div><p class="eyebrow">Capacité</p><h3>Supabase Free</h3></div>
            ${monitoringUsageLink()}
          </div>
          ${quotaRow('Connexions mensuelles', users.signedIn30d || 0, limits.monthlyActiveUsers, mauPercent, 'approximation du quota MAU')}
          ${quotaRow('Taille de la base', formatBytes(database.bytes || 0), formatBytes(limits.databaseBytes), databasePercent, `${database.fuelPriceRows || 0} prix · ${database.serviceAreaRows || 0} aires`)}
          ${quotaRow('Connexions à la base', database.connections || 0, database.maxConnections || '-', Number(database.connectionPercent) || 0, 'connexions ouvertes maintenant')}
        </article>

        <article class="panel inner health-panel">
          <div class="panel-head compact">
            <div><p class="eyebrow">Santé</p><h3>Points à surveiller</h3></div>
            <span class="pill ${escapeHtml(health.tone)}">${alerts.length || 'OK'}</span>
          </div>
          <div class="health-list">
            ${alerts.length ? alerts.slice(0, 5).map(renderHealthRow).join('') : renderHealthRow({ tone: 'success', title: 'Tout fonctionne', text: 'Aucune alerte opérationnelle détectée.' })}
          </div>
        </article>
      </div>

      <div class="stat-grid compact-stats">
        ${statCard('Recherches 24 h', activity.routeSearches24h ?? 0, '')}
        ${statCard('Recherches 7 j', activity.routeSearches7d ?? 0, '')}
        ${statCard('Aires vues 24 h', activity.stationViews24h ?? 0, '')}
        ${statCard('Aires vues 7 j', activity.stationViews7d ?? 0, '')}
        ${statCard('E-mails délivrés 7 j', emails.delivered7d ?? '-', emails.failed7d ? 'warning' : 'success')}
        ${statCard('Signalements à traiter', stats.reportsPending ?? countReports('pending'), countReports('pending') ? 'warning' : 'success')}
      </div>

      <div class="dashboard-grid">
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Données</p><h3>À surveiller maintenant</h3></div>
            <button class="ghost" data-action="focus-automation" type="button">Gérer</button>
          </div>
          ${alerts.length ? alerts.slice(0, 4).map(renderAutomationAlert).join('') : '<p class="hint">Aucune alerte bloquante. Les sources et la modération sont propres.</p>'}
        </article>
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Priorité</p><h3>Signalements récents</h3></div>
            <button class="ghost" data-action="focus-reports" data-status="pending" type="button">Voir</button>
          </div>
          <div class="stack">${latestReports || '<p class="hint">Aucun signalement.</p>'}</div>
        </article>
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">File intelligente</p><h3>À traiter en premier</h3></div>
          </div>
          <div class="stack">${urgentReports.length ? urgentReports.map(({ report, priority }) => renderPriorityRow(report, priority)).join('') : '<p class="hint">Aucun signalement prioritaire.</p>'}</div>
        </article>
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Usage</p><h3>Top routes</h3></div>
          </div>
          ${renderTopList(topRoutes(), 'Aucune recherche enregistrée.')}
        </article>
      </div>
    `;
  }

  function monitoringLimits() {
    const config = readConfig();
    return {
      monthlyActiveUsers: Number(config.limits?.monthlyActiveUsers) || 50000,
      databaseBytes: Number(config.limits?.databaseBytes) || 500 * 1024 * 1024,
    };
  }

  function monitoringUsageLink() {
    const url = readConfig().usageUrl;
    if (!url) return '<span class="pill muted">Quotas</span>';
    return `<a class="text-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Voir l’usage Supabase</a>`;
  }

  function operationsHealth(alerts) {
    if (!Object.keys(operations).length) {
      return {
        tone: 'warning',
        label: 'À connecter',
        title: 'Supervision en attente',
        text: 'La fonction de supervision doit être déployée sur Supabase.',
      };
    }
    const danger = alerts.filter((alert) => alert.tone === 'danger').length;
    const warning = alerts.filter((alert) => alert.tone === 'warning').length;
    if (danger) {
      return { tone: 'danger', label: `${danger} critique`, title: 'Intervention nécessaire', text: 'Au moins un service essentiel demande une vérification.' };
    }
    if (warning) {
      return { tone: 'warning', label: `${warning} à surveiller`, title: 'Plateforme opérationnelle', text: 'RouteStop fonctionne, avec quelques points préventifs à contrôler.' };
    }
    return { tone: 'success', label: 'Tout va bien', title: 'Tous les systèmes sont opérationnels', text: 'La base, les comptes et les mises à jour fonctionnent normalement.' };
  }

  function buildOperationsAlerts() {
    if (!Object.keys(operations).length) return [];
    const result = [];
    const database = operations.database || {};
    const emails = operations.emails || {};
    const limits = monitoringLimits();
    const databasePercent = percent(database.bytes || 0, limits.databaseBytes);
    const mauPercent = percent(operations.users?.signedIn30d || 0, limits.monthlyActiveUsers);

    if (databasePercent >= 85) {
      result.push({ tone: 'danger', title: 'Base proche de la limite', text: `${formatBytes(database.bytes)} utilisés sur ${formatBytes(limits.databaseBytes)}.` });
    } else if (databasePercent >= 70) {
      result.push({ tone: 'warning', title: 'Taille de base à surveiller', text: `${databasePercent}% du quota base de données est utilisé.` });
    }
    if (Number(database.connectionPercent) >= 85) {
      result.push({ tone: 'danger', title: 'Connexions base saturées', text: `${database.connections}/${database.maxConnections} connexions sont ouvertes.` });
    } else if (Number(database.connectionPercent) >= 70) {
      result.push({ tone: 'warning', title: 'Connexions base élevées', text: `${database.connectionPercent}% des connexions sont utilisées.` });
    }
    if (mauPercent >= 85) {
      result.push({ tone: 'danger', title: 'Quota utilisateurs proche', text: `${operations.users?.signedIn30d || 0} connexions sur 30 jours.` });
    } else if (mauPercent >= 70) {
      result.push({ tone: 'warning', title: 'Quota utilisateurs à surveiller', text: `${mauPercent}% du seuil mensuel estimé est atteint.` });
    }
    if (Number(emails.failed7d) > 0) {
      result.push({ tone: 'warning', title: 'Échecs d’e-mail', text: `${emails.failed7d} échec(s) détecté(s) sur les 7 derniers jours.` });
    }
    return result;
  }

  function opsCard(label, value, sub, tone) {
    return `
      <article class="ops-card ${escapeHtml(tone || '')}">
        <span class="ops-card-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(sub)}</small>
      </article>
    `;
  }

  function quotaRow(label, value, limit, usagePercent, sub) {
    const safePercent = Math.max(0, Math.min(100, Number(usagePercent) || 0));
    const tone = safePercent >= 85 ? 'danger' : safePercent >= 70 ? 'warning' : 'success';
    return `
      <div class="quota-row">
        <div class="quota-head"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)} / ${escapeHtml(limit)}</span></div>
        <div class="quota-track"><i class="${tone}" style="width:${safePercent}%"></i></div>
        <small>${escapeHtml(sub)} · ${formatPercent(safePercent)}</small>
      </div>
    `;
  }

  function renderHealthRow(alert) {
    return `
      <div class="health-row ${escapeHtml(alert.tone || 'muted')}">
        <span class="health-dot"></span>
        <div><strong>${escapeHtml(alert.title)}</strong><small>${escapeHtml(alert.text)}</small></div>
      </div>
    `;
  }

  function renderReports() {
    const list = visibleReports();
    $('reports-list').innerHTML = list.length
      ? `${renderReportQueue(list)}${list.map(renderReport).join('')}`
      : '<p class="hint">Aucun signalement à afficher.</p>';
  }

  function renderReportQueue(list) {
    const pending = reports.filter((report) => report.status === 'pending').length;
    const priceReports = list.filter((report) => report.report_type === 'wrong_price').length;
    const serviceReports = list.filter((report) => /service|brand|wrong_brand/.test(report.report_type || '')).length;
    const urgentReports = reports
      .filter((report) => report.status === 'pending')
      .filter((report) => reportPriorityInfo(report).score >= 75).length;
    return `
      <article class="process-card">
        <div>
          <p class="eyebrow">Process</p>
          <h3>File de traitement</h3>
        </div>
        <div class="process-stats">
          <span><strong>${pending}</strong> à traiter</span>
          <span><strong>${urgentReports}</strong> urgents</span>
          <span><strong>${priceReports}</strong> prix</span>
          <span><strong>${serviceReports}</strong> services / enseignes</span>
        </div>
      </article>
    `;
  }

  function renderData() {
    $('data-view').innerHTML = `
      ${renderSyncPanel()}
      <div class="panel inner">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">Corrections app</p>
            <h3>Données appliquées dans RouteStop</h3>
          </div>
          <span class="pill">${overrides.length} lignes</span>
        </div>
        <div class="stack">
          ${overrides.length ? overrides.map(renderOverride).join('') : '<p class="hint">Aucune correction active.</p>'}
        </div>
      </div>
    `;
  }

  function renderSyncPanel() {
    const last = lastFuelSync();
    return `
      <div class="panel inner">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">Toutes les heures</p>
            <h3>Prix carburant</h3>
          </div>
          <div class="sync-panel-actions">
            <span class="pill ${syncTone()}">${lastFuelSyncLabel()}</span>
            <button class="ghost small" data-action="trigger-sync" data-target="fuel_prices" type="button">Actualiser</button>
          </div>
        </div>
        <div class="mini-stat-grid">
          ${statCard('Stations avec prix', stats.fuelPriceRows ?? fuelPrices.length, '')}
          ${statCard('Modifiées au dernier passage', last?.rowsUpserted ?? last?.rows_upserted ?? '-', '')}
          ${statCard('Résultat', syncStatusLabel(last?.status), syncTone())}
        </div>
        ${last?.message ? `<p class="hint danger-text">${escapeHtml(friendlySyncError(last.message))}</p>` : ''}
        ${syncRuns.length ? renderTopList(syncRuns.slice(0, 6).map((run) => ({
          label: `${syncSourceLabel(run.source)} · ${syncStatusLabel(run.status)}`,
          count: run.rows_upserted || 1,
          sub: `${formatDate(run.finished_at)} · ${run.rows_fetched || 0} éléments contrôlés`,
        })), 'Aucune mise à jour.') : '<p class="hint">Aucune mise à jour automatique lancée pour le moment.</p>'}
      </div>
      <div class="panel inner">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">Chaque nuit</p>
            <h3>Aires et services</h3>
          </div>
          <div class="sync-panel-actions">
            <span class="pill ${serviceSyncTone()}">${lastServiceAreaSyncLabel()}</span>
            <button class="ghost small" data-action="trigger-sync" data-target="service_areas" type="button">Actualiser</button>
          </div>
        </div>
        <div class="mini-stat-grid">
          ${statCard('Aires disponibles', stats.serviceAreaRows ?? serviceAreas.length, '')}
          ${statCard('Modifiées au dernier passage', lastServiceAreaSync()?.rowsUpserted ?? lastServiceAreaSync()?.rows_upserted ?? '-', '')}
          ${statCard('Liste officielle', syncStatusLabel(lastServiceAreaSync()?.status), serviceSyncTone())}
          ${statCard('Restaurants et services', osmAreaSyncLabel(), osmAreaSyncTone())}
        </div>
      </div>
    `;
  }

  function renderAutomation() {
    const alerts = buildAutomationAlerts();
    const suggestions = buildAutomationSuggestions();
    const duplicateGroups = duplicateReportGroups();
    const sourceRows = sourceHealthRows();

    $('automation-view').innerHTML = `
      <div class="automation-hero">
        <div>
          <p class="eyebrow">Centre de contrôle</p>
          <h3>Voir un problème et agir immédiatement</h3>
          <p class="hint">Les données continuent d’être servies depuis la dernière mise à jour réussie, même lorsqu’une source publique répond mal.</p>
        </div>
        <div class="automation-actions">
          <button data-action="copy-diagnostic" type="button">Copier le diagnostic</button>
          <button class="ghost" data-action="focus-reports" data-status="pending" type="button">Voir la file</button>
        </div>
      </div>

      <div class="automation-grid">
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Actions</p><h3>Problèmes à régler</h3></div>
            <span class="pill ${alerts.some(a => a.tone === 'danger') ? 'danger' : alerts.length ? 'warning' : 'success'}">${alerts.length || 'OK'}</span>
          </div>
          <div class="stack">
            ${alerts.length ? alerts.map(renderAutomationAlert).join('') : '<p class="hint">Tout va bien. Aucune intervention nécessaire.</p>'}
          </div>
        </article>

        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Derniers passages</p><h3>État des données</h3></div>
          </div>
          <div class="source-table">
            ${sourceRows.map(renderSourceHealthRow).join('')}
          </div>
        </article>
      </div>

      <div class="automation-grid">
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Suggestions</p><h3>Signalements à traiter en premier</h3></div>
            <span class="pill">${suggestions.length} recommandations</span>
          </div>
          <div class="stack">
            ${suggestions.length ? suggestions.map(renderAutomationSuggestion).join('') : '<p class="hint">Aucune recommandation prioritaire.</p>'}
          </div>
        </article>

        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Doublons</p><h3>Signalements regroupés</h3></div>
            <span class="pill">${duplicateGroups.length} groupes</span>
          </div>
          <div class="stack">
            ${duplicateGroups.length ? duplicateGroups.slice(0, 8).map(renderDuplicateGroup).join('') : '<p class="hint">Aucun doublon détecté dans la file active.</p>'}
          </div>
        </article>
      </div>

      <div class="automation-grid">
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">Sécurité</p><h3>Contrôles back-office</h3></div>
            <span class="pill ${securityFindings().some(item => item.tone === 'danger') ? 'danger' : securityFindings().some(item => item.tone === 'warning') ? 'warning' : 'success'}">Audit</span>
          </div>
          <div class="stack">${securityFindings().map(renderSecurityFinding).join('')}</div>
        </article>
        <article class="panel inner">
          <div class="panel-head compact">
            <div><p class="eyebrow">À automatiser ensuite</p><h3>Actions serveur utiles</h3></div>
          </div>
          ${renderTopList(nextAutomationIdeas(), 'Aucune idée prioritaire.')}
        </article>
      </div>
    `;
  }

  function buildAutomationAlerts() {
    const alerts = [];
    const pending = reports.filter((report) => report.status === 'pending');
    const oldestPending = pending
      .map((report) => ({ report, age: ageHours(report.created_at) }))
      .sort((a, b) => b.age - a.age)[0];
    const duplicates = duplicateReportGroups();
    const lastFuel = lastFuelSync();
    const lastFuelFinished = lastFuel?.finishedAt || lastFuel?.finished_at;
    const lastService = lastServiceAreaSync();
    const lastServiceFinished = lastService?.finishedAt || lastService?.finished_at;
    const osmRuns = latestOsmAreaRuns();
    const fuelAge = ageHours(lastFuelFinished);
    const serviceAge = ageHours(lastServiceFinished);

    if (lastFuel?.status && lastFuel.status !== 'success') {
      alerts.push({
        category: 'sync',
        tone: 'danger',
        title: 'Les prix n’ont pas été actualisés',
        text: friendlySyncError(lastFuel.message),
        action: 'trigger-sync',
        target: 'fuel_prices',
        actionLabel: 'Relancer',
      });
    } else if (!lastFuelFinished) {
      alerts.push({
        category: 'sync',
        tone: 'danger',
        title: 'Aucune mise à jour des prix trouvée',
        text: 'Lance une première actualisation des prix carburant.',
        action: 'trigger-sync',
        target: 'fuel_prices',
        actionLabel: 'Actualiser',
      });
    } else if (fuelAge > 8) {
      alerts.push({
        category: 'sync',
        tone: 'danger',
        title: 'Les prix sont trop anciens',
        text: `Dernière actualisation il y a ${formatAgeHours(fuelAge)}.`,
        action: 'trigger-sync',
        target: 'fuel_prices',
        actionLabel: 'Actualiser',
      });
    } else if (fuelAge > 3) {
      alerts.push({
        category: 'sync',
        tone: 'warning',
        title: 'Les prix prennent du retard',
        text: `Dernière actualisation il y a ${formatAgeHours(fuelAge)}.`,
        action: 'trigger-sync',
        target: 'fuel_prices',
        actionLabel: 'Actualiser',
      });
    }

    if (lastService?.status && lastService.status !== 'success') {
      alerts.push({
        category: 'sync',
        tone: 'danger',
        title: 'La liste officielle des aires n’a pas été actualisée',
        text: friendlySyncError(lastService.message),
        action: 'trigger-sync',
        target: 'service_areas',
        actionLabel: 'Relancer',
      });
    } else if (!lastServiceFinished) {
      alerts.push({
        category: 'sync',
        tone: 'warning',
        title: 'Aucune mise à jour des aires trouvée',
        text: 'Lance une première actualisation de la liste officielle.',
        action: 'trigger-sync',
        target: 'service_areas',
        actionLabel: 'Actualiser',
      });
    } else if (serviceAge > 36) {
      alerts.push({
        category: 'sync',
        tone: 'warning',
        title: 'La liste des aires prend du retard',
        text: `Dernière actualisation il y a ${formatAgeHours(serviceAge)}.`,
        action: 'trigger-sync',
        target: 'service_areas',
        actionLabel: 'Actualiser',
      });
    }

    const failedOsmRuns = osmRuns.filter((run) => run.status !== 'success');
    if (!osmRuns.length) {
      alerts.push({
        category: 'sync',
        tone: 'warning',
        title: 'Les restaurants et services n’ont pas été vérifiés',
        text: 'Aucune zone n’a été contrôlée depuis 36 heures. La liste officielle reste disponible.',
        action: 'focus-data',
        actionLabel: 'Voir les données',
      });
    } else if (failedOsmRuns.length) {
      for (const run of failedOsmRuns) {
        const region = run.metadata?.region;
        alerts.push({
          category: 'sync',
          tone: 'warning',
          title: `${regionLabel(region)} n’a pas été vérifiée`,
          text: friendlySyncError(run.message),
          action: 'trigger-sync',
          target: 'osm_region',
          region,
          actionLabel: 'Relancer',
        });
      }
    } else if (osmRuns.length > 0 && osmRuns.length < OSM_SYNC_REGION_COUNT) {
      const completed = new Set(osmRuns.map((run) => run.metadata?.region));
      for (const region of OSM_SYNC_REGIONS) {
        if (completed.has(region)) continue;
        alerts.push({
          category: 'sync',
          tone: 'warning',
          title: `${regionLabel(region)} n’a pas encore été vérifiée`,
          text: 'La dernière version disponible continue d’être utilisée.',
          action: 'trigger-sync',
          target: 'osm_region',
          region,
          actionLabel: 'Vérifier',
        });
      }
    }

    if ((stats.fuelPriceRows ?? fuelPrices.length) === 0) {
      alerts.push({
        category: 'sync',
        tone: 'danger',
        title: 'Aucun prix disponible',
        text: 'La base ne contient actuellement aucun prix carburant exploitable.',
        action: 'trigger-sync',
        target: 'fuel_prices',
        actionLabel: 'Actualiser',
      });
    }

    if ((stats.serviceAreaRows ?? serviceAreas.length) === 0) {
      alerts.push({
        category: 'sync',
        tone: 'danger',
        title: 'Aucune aire disponible',
        text: 'La base ne contient actuellement aucune aire exploitable.',
        action: 'trigger-sync',
        target: 'service_areas',
        actionLabel: 'Actualiser',
      });
    }

    if (pending.length > 15) {
      alerts.push({
        tone: 'danger',
        title: 'File de signalements trop longue',
        text: `${pending.length} signalements sont en attente. Il faut réduire la dette avant TestFlight externe.`,
        action: 'focus-reports',
      });
    } else if (pending.length > 5) {
      alerts.push({
        tone: 'warning',
        title: 'Signalements à traiter',
        text: `${pending.length} signalements attendent une décision.`,
        action: 'focus-reports',
      });
    }

    if (oldestPending?.age > 72) {
      alerts.push({
        tone: 'danger',
        title: 'Signalement ancien non traité',
        text: `${oldestPending.report.station_name || 'Une aire'} attend depuis ${formatAgeHours(oldestPending.age)}.`,
        action: 'focus-reports',
        search: oldestPending.report.station_name || oldestPending.report.station_id,
      });
    } else if (oldestPending?.age > 24) {
      alerts.push({
        tone: 'warning',
        title: 'Signalement à vérifier',
        text: `${oldestPending.report.station_name || 'Une aire'} attend depuis ${formatAgeHours(oldestPending.age)}.`,
        action: 'focus-reports',
        search: oldestPending.report.station_name || oldestPending.report.station_id,
      });
    }

    if (duplicates.length) {
      alerts.push({
        tone: 'warning',
        title: 'Doublons détectés',
        text: `${duplicates.length} groupe(s) de signalements parlent probablement du même problème.`,
        action: 'focus-reports',
      });
    }

    return alerts;
  }

  function buildAutomationSuggestions() {
    return reports
      .filter((report) => report.status === 'pending')
      .map((report) => ({ report, priority: reportPriorityInfo(report) }))
      .sort((a, b) => b.priority.score - a.priority.score)
      .slice(0, 10);
  }

  function renderAutomationAlert(alert) {
    return `
      <div class="automation-alert ${escapeHtml(alert.tone || 'muted')}">
        <div>
          <strong>${escapeHtml(alert.title)}</strong>
          <span>${escapeHtml(alert.text)}</span>
        </div>
        ${alert.action ? `<button class="ghost small" data-action="${escapeHtml(alert.action)}" data-target="${escapeHtml(alert.target || '')}" data-region="${escapeHtml(alert.region || '')}" data-search="${escapeHtml(alert.search || '')}" type="button">${escapeHtml(alert.actionLabel || 'Voir')}</button>` : ''}
      </div>
    `;
  }

  function renderPriorityRow(report, priority) {
    return `
      <div class="priority-row">
        <div>
          <strong>${escapeHtml(report.station_name || report.station_id)}</strong>
          <span>${escapeHtml(priority.label)} · ${escapeHtml(typeLabels[report.report_type] || report.report_type)} · ${formatDate(report.created_at)}</span>
        </div>
        <button class="ghost small" data-action="focus-reports" data-status="pending" data-search="${escapeHtml(report.station_name || report.station_id)}" type="button">Ouvrir</button>
      </div>
    `;
  }

  function renderAutomationSuggestion(item) {
    const { report, priority } = item;
    return `
      <div class="suggestion-card ${escapeHtml(priority.tone)}">
        <div class="suggestion-top">
          <div>
            <strong>${escapeHtml(report.station_name || report.station_id)}</strong>
            <span>${escapeHtml(typeLabels[report.report_type] || report.report_type)} · ${formatDate(report.created_at)}</span>
          </div>
          <span class="score">${priority.score}</span>
        </div>
        <p>${escapeHtml(priority.reasons.join(' · ') || 'Signalement standard')}</p>
        <div class="suggestion-actions">
          <button data-action="focus-reports" data-status="pending" data-search="${escapeHtml(report.station_name || report.station_id)}" type="button">Ouvrir</button>
          <button class="ghost" data-action="focus-report-suggestion" data-id="${escapeHtml(report.id)}" type="button">${escapeHtml(priority.suggestedLabel)}</button>
        </div>
      </div>
    `;
  }

  function renderDuplicateGroup(group) {
    const first = group.items[0];
    return `
      <div class="duplicate-row">
        <div>
          <strong>${escapeHtml(first.station_name || first.station_id)}</strong>
          <span>${escapeHtml(typeLabels[first.report_type] || first.report_type)} · ${escapeHtml(first.target_label || 'Sans cible')}</span>
        </div>
        <em>${group.items.length}</em>
        <button class="ghost small" data-action="focus-reports" data-status="pending" data-search="${escapeHtml(first.station_name || first.station_id)}" type="button">Traiter</button>
      </div>
    `;
  }

  function sourceHealthRows() {
    const lastFuel = lastFuelSync();
    const lastService = lastServiceAreaSync();
    const fuelFinished = lastFuel?.finishedAt || lastFuel?.finished_at;
    const serviceFinished = lastService?.finishedAt || lastService?.finished_at;
    return [
      {
        label: 'Prix carburant',
        sub: `${stats.fuelPriceRows ?? fuelPrices.length} stations avec prix`,
        status: syncStatusLabel(lastFuel?.status),
        updated: fuelFinished,
        tone: syncTone(),
      },
      {
        label: 'Liste officielle des aires',
        sub: `${stats.serviceAreaRows ?? serviceAreas.length} aires disponibles`,
        status: syncStatusLabel(lastService?.status),
        updated: serviceFinished,
        tone: serviceSyncTone(),
      },
      {
        label: 'Restaurants et services',
        sub: `${latestOsmAreaRuns().length}/${OSM_SYNC_REGION_COUNT} zones contrôlées`,
        status: osmAreaSyncLabel(),
        updated: lastOsmAreaSync()?.finishedAt || lastOsmAreaSync()?.finished_at,
        tone: osmAreaSyncTone(),
      },
      {
        label: 'Signalements',
        sub: `${reports.filter(r => r.status === 'pending').length} en attente`,
        status: reports.some(r => r.status === 'pending') ? 'à traiter' : 'ok',
        updated: reports[0]?.created_at,
        tone: reports.some(r => r.status === 'pending') ? 'warning' : 'success',
      },
      {
        label: 'Corrections manuelles',
        sub: `${overrides.filter(x => x.is_active).length} correction(s) active(s)`,
        status: 'Appliquées',
        updated: overrides[0]?.updated_at,
        tone: 'success',
      },
    ];
  }

  function renderSourceHealthRow(row) {
    return `
      <div class="source-row">
        <div>
          <strong>${escapeHtml(row.label)}</strong>
          <span>${escapeHtml(row.sub)}</span>
        </div>
        <div>
          <span class="pill ${escapeHtml(row.tone)}">${escapeHtml(row.status)}</span>
          <small>${row.updated ? escapeHtml(formatDate(row.updated)) : 'Jamais'}</small>
        </div>
      </div>
    `;
  }

  function securityFindings() {
    const hasLocalVendor = Boolean(document.querySelector('script[src^="./vendor/"]'));
    const hasCsp = Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]'));
    const usesFile = window.location.protocol === 'file:';
    return [
      {
        tone: 'success',
        title: 'Accès admin limité côté Supabase',
        text: 'Le site vérifie public.is_admin() et les tables sensibles restent protégées par RLS.',
      },
      {
        tone: hasLocalVendor ? 'success' : 'warning',
        title: hasLocalVendor ? 'Supabase JS chargé localement' : 'Librairie externe à vérifier',
        text: hasLocalVendor ? 'Pas de CDN public pour le client Supabase.' : 'Évite un CDN sans intégrité pour un back-office.',
      },
      {
        tone: hasCsp ? 'success' : 'warning',
        title: hasCsp ? 'CSP active' : 'CSP absente',
        text: hasCsp ? 'Les scripts, images et connexions sont limités aux sources attendues.' : 'Ajoute une Content-Security-Policy.',
      },
      {
        tone: 'warning',
        title: 'Session navigateur',
        text: 'Supabase garde la session côté navigateur. Pour la production web, héberge le site derrière un accès privé et active MFA sur le compte admin.',
      },
      {
        tone: usesFile ? 'warning' : 'success',
        title: usesFile ? 'Site ouvert en fichier local' : 'Site servi en HTTP(S)',
        text: usesFile ? 'OK pour travailler seul, mais pour un vrai admin il faudra un hébergement HTTPS avec accès restreint.' : 'Meilleur contexte pour CSP, cookies et accès contrôlé.',
      },
    ];
  }

  function renderSecurityFinding(item) {
    return `
      <div class="security-row ${escapeHtml(item.tone)}">
        <span class="security-dot"></span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </div>
      </div>
    `;
  }

  function nextAutomationIdeas() {
    return [
      { label: 'Déclencher une synchro depuis l’admin', count: 95, sub: 'Prix carburant et aires, avec trace dans data_sync_runs' },
      { label: 'Valider les doublons en lot', count: 82, sub: 'Même aire, même cible, même type de correction' },
      { label: 'Alerte email si synchro en erreur', count: 74, sub: 'Utile avant ouverture TestFlight externe' },
      { label: 'Auto-prévalidation multi-signalements', count: 68, sub: 'Quand 2+ utilisateurs signalent la même chose' },
      { label: 'Rapport mensuel partenaires', count: 61, sub: 'Routes, enseignes, carburants et restaurants les plus demandés' },
    ];
  }

  function duplicateReportGroups() {
    const groups = new Map();
    for (const report of reports.filter((item) => item.status === 'pending')) {
      const key = [
        report.station_id || report.station_name || '',
        report.report_type || '',
        cleanReportTarget(report).toLowerCase(),
      ].join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(report);
    }
    return Array.from(groups.values())
      .filter((items) => items.length > 1)
      .map((items) => ({ items }))
      .sort((a, b) => b.items.length - a.items.length);
  }

  function reportPriorityInfo(report) {
    let score = 20;
    const reasons = [];
    const age = ageHours(report.created_at);
    const duplicates = duplicateCount(report);
    const impact = stationImpact(report);
    const type = report.report_type || '';
    const target = cleanReportTarget(report);

    if (type === 'wrong_price') {
      score += 28;
      reasons.push('prix carburant');
    }
    if (/brand|service|wrong_brand/.test(type)) {
      score += 22;
      reasons.push('donnée visible');
    }
    if (duplicates > 1) {
      score += Math.min(24, duplicates * 8);
      reasons.push(`${duplicates} signalements similaires`);
    }
    if (age > 72) {
      score += 24;
      reasons.push('ancien');
    } else if (age > 24) {
      score += 12;
      reasons.push('attend depuis 24h+');
    }
    if (impact > 4) {
      score += 18;
      reasons.push('aire utilisée');
    } else if (impact > 0) {
      score += 8;
      reasons.push('activité utilisateur');
    }
    if (target) {
      score += 4;
      reasons.push(`cible : ${target}`);
    }

    const tone = score >= 75 ? 'danger' : score >= 52 ? 'warning' : 'success';
    const suggestedLabel = suggestedActionLabel(report);
    return {
      score,
      tone,
      label: score >= 75 ? 'Urgent' : score >= 52 ? 'À prioriser' : 'Normal',
      reasons,
      suggestedLabel,
    };
  }

  function duplicateCount(report) {
    const target = cleanReportTarget(report).toLowerCase();
    return reports.filter((item) => (
      item.status === 'pending'
      && (item.station_id || item.station_name) === (report.station_id || report.station_name)
      && item.report_type === report.report_type
      && cleanReportTarget(item).toLowerCase() === target
    )).length;
  }

  function stationImpact(report) {
    const id = report.station_id;
    const name = String(report.station_name || '').toLowerCase();
    return events.filter((event) => event.station_id === id || String(event.station_name || '').toLowerCase() === name).length
      + favorites.filter((item) => item.station_id === id || String(item.station_name || '').toLowerCase() === name).length
      + notes.filter((item) => item.station_id === id || String(item.station_name || '').toLowerCase() === name).length;
  }

  function suggestedActionLabel(report) {
    const type = report.report_type || '';
    if (type === 'wrong_price') return 'Préparer prix';
    if (type === 'brand_closed' || type === 'service_closed') return 'Préparer retrait';
    if (type === 'brand_missing' || type === 'service_missing') return 'Préparer ajout';
    if (type === 'wrong_brand') return 'Préparer marque';
    return 'Préparer note';
  }

  async function handleAutomationAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'copy-diagnostic') {
      await copyDiagnostic();
      return;
    }
    if (action === 'focus-data') {
      setView('data');
      return;
    }
    if (action === 'focus-automation') {
      setView('automation');
      return;
    }
    if (action === 'focus-reports') {
      focusReports(button.dataset.status || 'pending', button.dataset.search || '');
      return;
    }
    if (action === 'focus-report-suggestion') {
      const report = reports.find((item) => item.id === button.dataset.id);
      focusReports('pending', report?.station_name || report?.station_id || '');
      if (report) setTimeout(() => prepareSuggestedAction(report.id), 40);
      return;
    }
    if (action === 'trigger-sync') {
      await triggerSync(button);
    }
  }

  async function triggerSync(button) {
    const target = button.dataset.target;
    const region = button.dataset.region || null;
    const labels = {
      fuel_prices: 'les prix carburant',
      service_areas: 'la liste officielle des aires',
      osm_region: `les restaurants et services pour ${regionLabel(region)}`,
    };
    const label = labels[target];
    if (!label) {
      showFeedback('Action inconnue. Aucune mise à jour lancée.');
      return;
    }
    if (!window.confirm(`Actualiser ${label} maintenant ?`)) return;

    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Lancement…';
    try {
      const { error } = await client.rpc('admin_trigger_sync', {
        p_target: target,
        p_region: region,
      });
      if (error) throw error;
      showFeedback(`Mise à jour lancée pour ${label}. Le résultat apparaîtra dans quelques instants.`);
      window.setTimeout(() => loadAdminData().catch(() => {}), 7000);
      window.setTimeout(() => loadAdminData().catch(() => {}), 25000);
    } catch (error) {
      const message = String(error?.message || 'unknown_error');
      if (/not_admin|permission|forbidden/i.test(message)) {
        showFeedback('Action refusée : reconnecte-toi avec le compte administrateur.');
      } else {
        showFeedback('Impossible de lancer la mise à jour. Réessaie dans quelques instants.');
      }
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  function focusReports(status = 'pending', nextSearch = '') {
    statusFilter = status;
    search = String(nextSearch || '').trim().toLowerCase();
    $('search').value = nextSearch || '';
    for (const item of $('status-tabs').querySelectorAll('button')) {
      item.classList.toggle('active', item.dataset.status === statusFilter);
    }
    setView('reports');
    renderReports();
  }

  async function copyDiagnostic() {
    const text = diagnosticMarkdown();
    try {
      await navigator.clipboard.writeText(text);
      showFeedback('Diagnostic copié.');
    } catch {
      showFeedback('Copie impossible dans ce navigateur.');
    }
  }

  function diagnosticMarkdown() {
    const alerts = buildAutomationAlerts();
    const routes = routeStats();
    return [
      '# RouteStop Admin — diagnostic',
      '',
      `- Signalements à traiter : ${reports.filter(r => r.status === 'pending').length}`,
      `- Corrections actives : ${overrides.filter(x => x.is_active).length}`,
      `- Prix centralisés : ${stats.fuelPriceRows ?? fuelPrices.length}`,
      `- Aires centralisées : ${stats.serviceAreaRows ?? serviceAreas.length}`,
      `- Dernière synchro prix : ${lastFuelSyncLabel()}`,
      `- Dernière synchro aires : ${lastServiceAreaSyncLabel()}`,
      `- Recherches trajet : ${routes.count}`,
      `- Distance moyenne : ${routes.avgDistance || '-'} km`,
      '',
      '## Alertes',
      alerts.length ? alerts.map((alert) => `- [${alert.tone}] ${alert.title} — ${alert.text}`).join('\n') : '- Aucune',
    ].join('\n');
  }

  function renderAnalytics() {
    const routes = routeStats();
    const revenue = monetizationStats();
    $('analytics-view').innerHTML = `
      <div class="monetization-hero">
        <div>
          <p class="eyebrow">Monétisation</p>
          <h3>Signaux commerciaux RouteStop</h3>
          <p class="hint">Ces stats sont pensées pour identifier les axes, enseignes et profils de trajets intéressants pour des partenariats.</p>
        </div>
        <div class="mini-stat-grid monetization-stats">
          ${statCard('Score data', revenue.dataScore, revenue.dataScore >= 70 ? 'success' : revenue.dataScore >= 40 ? 'warning' : '')}
          ${statCard('Profils qualifiés', revenue.qualifiedProfiles, '')}
          ${statCard('Taux favoris', revenue.favoriteRate ? `${revenue.favoriteRate}%` : '-', '')}
          ${statCard('Signalements utiles', revenue.actionableReports, 'warning')}
        </div>
      </div>

      <div class="panel inner route-overview">
        <div class="panel-head compact">
          <div>
            <p class="eyebrow">Trajets</p>
            <h3>Qualité commerciale des parcours</h3>
          </div>
          <span class="pill">${routes.count} recherches</span>
        </div>
        <div class="mini-stat-grid">
          ${statCard('Distance moyenne', routes.avgDistance ? `${routes.avgDistance} km` : '-', '')}
          ${statCard('Durée moyenne', routes.avgDuration ? `${routes.avgDuration} min` : '-', '')}
          ${statCard('Aires moyennes', routes.avgStations ? `${routes.avgStations}` : '-', '')}
          ${statCard('Plus long trajet', routes.longest ? `${routes.longest} km` : '-', '')}
        </div>
      </div>

      <div class="analytics-grid">
        <article class="panel inner">
          <p class="eyebrow">Opportunités</p>
          <h3>Pistes partenaires</h3>
          ${renderTopList(monetizationOpportunities(), 'Pas encore assez de données commerciales.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Audience</p>
          <h3>Segments de trajets</h3>
          ${renderTopList(distanceSegments(), 'Aucune distance exploitable.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Routes</p>
          <h3>Parcours les plus demandés</h3>
          ${renderTopList(topRoutes(), 'Aucune route pour le moment.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Stations</p>
          <h3>Aires les plus consultées</h3>
          ${renderTopList(topStationViews(), 'Aucune consultation pour le moment.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Adresses</p>
          <h3>Types de lieux recherchés</h3>
          ${renderTopList(topPlaceKinds(), 'Pas encore assez de recherches.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Monétisation</p>
          <h3>Demande enseignes globale</h3>
          ${renderTopList(topCommercialBrands(), 'Aucune préférence ou favori renseigné.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Restauration</p>
          <h3>Demande restauration</h3>
          ${renderTopList(topFoodDemand(), 'Aucune préférence renseignée.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Carburant</p>
          <h3>Carburants préférés</h3>
          ${renderTopList(topFuelPrefs(), 'Aucun carburant préféré.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Favoris</p>
          <h3>Stations favorites</h3>
          ${renderTopList(topFavorites(), 'Aucun favori.')}
        </article>
        <article class="panel inner">
          <p class="eyebrow">Qualité data</p>
          <h3>Corrections à valeur commerciale</h3>
          ${renderTopList(dataQualitySignals(), 'Aucune correction prioritaire.')}
        </article>
      </div>
    `;
  }

  function statCard(label, value, tone) {
    return `<article class="stat-card ${tone || ''}"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`;
  }

  function renderSmallReport(report) {
    return `
      <div class="small-row">
        <strong>${escapeHtml(report.station_name)}</strong>
        <span>${escapeHtml(typeLabels[report.report_type] || report.report_type)} · ${formatDate(report.created_at)}</span>
      </div>
    `;
  }

  function visibleReports() {
    return reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (!search) return true;
      const haystack = [
        report.station_name,
        report.station_brand,
        report.target_label,
        report.details,
        report.report_type,
        report.station_id,
      ].join(' ').toLowerCase();
      return haystack.includes(search);
    });
  }

  function renderReport(report) {
    const status = report.status || 'pending';
    const coords = typeof report.station_lat === 'number' && typeof report.station_lon === 'number'
      ? `${report.station_lat.toFixed(5)}, ${report.station_lon.toFixed(5)}`
      : '';
    const mapsUrl = coords ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}` : '';
    const snapshot = report.snapshot || {};
    const tenants = Array.isArray(snapshot.tenants) ? snapshot.tenants.slice(0, 10) : [];
    const services = Array.isArray(snapshot.services) ? snapshot.services.slice(0, 10) : [];
    const fuels = snapshot.fuels && typeof snapshot.fuels === 'object' ? snapshot.fuels : {};
    const fuelName = fuelFromTarget(report.target_label);
    const priority = reportPriorityInfo(report);
    const suggestedCopy = reportSuggestedCopy(report, priority);
    const impact = stationImpact(report);

    return `
      <article class="report">
        <div class="report-top">
          <div>
            <div class="report-title">${escapeHtml(report.station_name)}</div>
            <div class="meta">
              <span>${escapeHtml(typeLabels[report.report_type] || report.report_type)}</span>
              <span>${formatDate(report.created_at)}</span>
              ${report.station_brand ? `<span>${escapeHtml(report.station_brand)}</span>` : ''}
              ${report.operator_source ? `<span>${escapeHtml(report.operator_source.toUpperCase())}</span>` : ''}
            </div>
          </div>
          <div class="report-badges">
            ${status === 'pending' ? `<span class="pill ${priority.tone}">${escapeHtml(priority.label)} · ${priority.score}</span>` : ''}
            <span class="pill ${statusClass(status)}">${escapeHtml(statusLabels[status] || status)}</span>
          </div>
        </div>

        ${status === 'pending' ? `
          <div class="decision-card ${priority.tone}">
            <div>
              <p class="eyebrow">Décision recommandée</p>
              <h3>${escapeHtml(suggestedCopy.title)}</h3>
              <p>${escapeHtml(suggestedCopy.text)}</p>
            </div>
            <div class="decision-actions">
              <button data-action="quick-suggested" data-id="${escapeHtml(report.id)}" type="button">Préparer</button>
              <button class="ghost" data-action="apply-report" data-id="${escapeHtml(report.id)}" type="button">Valider avec correction</button>
            </div>
          </div>
        ` : ''}

        <div class="report-summary-grid">
          <div class="summary-block">
            <span>Signalement</span>
            <strong>${escapeHtml(report.target_label || typeLabels[report.report_type] || report.report_type)}</strong>
            <p>${escapeHtml(report.details || 'Aucun détail fourni.')}</p>
          </div>
          <div class="summary-block">
            <span>Impact app</span>
            <strong>${impact ? `${impact} interactions` : 'Pas encore mesuré'}</strong>
            <p>${escapeHtml(priority.reasons.join(' · ') || 'Signalement standard')}</p>
          </div>
          <div class="summary-block">
            <span>Source</span>
            <strong>${escapeHtml(report.operator_source ? report.operator_source.toUpperCase() : report.station_source || 'RouteStop')}</strong>
            <p>${coords ? escapeHtml(coords) : 'Coordonnées non disponibles'}</p>
          </div>
        </div>

        <div class="chips compact-chips">
          <span class="chip">ID ${escapeHtml(report.station_id)}</span>
          ${coords ? `<a class="chip" href="${mapsUrl}" target="_blank" rel="noopener noreferrer">Carte</a>` : ''}
          ${Object.entries(fuels).slice(0, 5).map(([k, v]) => `<span class="chip">${escapeHtml(k)} ${escapeHtml(v)}</span>`).join('')}
          ${tenants.slice(0, 6).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}
          ${services.slice(0, 6).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}
        </div>

        <details class="advanced-editor" data-editor-id="${escapeHtml(report.id)}">
          <summary>Correction avancée</summary>
          <div class="quick-actions">
            <button class="ghost small" data-action="quick-remove-target" data-id="${escapeHtml(report.id)}" type="button">Retirer la cible</button>
            <button class="ghost small" data-action="quick-add-target" data-id="${escapeHtml(report.id)}" type="button">Ajouter la cible</button>
            <button class="ghost small danger-text" data-action="quick-hide" data-id="${escapeHtml(report.id)}" type="button">Masquer l’aire</button>
          </div>
          <div class="correction-grid">
            <label>Marque station
              <input data-report-field="brandOverride" data-id="${escapeHtml(report.id)}" value="" placeholder="Ex : TotalEnergies" />
            </label>
            <label>Carburant corrigé
              <input data-report-field="fuelName" data-id="${escapeHtml(report.id)}" value="${escapeHtml(fuelName)}" placeholder="SP95/E10" />
            </label>
            <label>Prix corrigé
              <input data-report-field="fuelPrice" data-id="${escapeHtml(report.id)}" type="number" step="0.001" min="0" max="5" placeholder="1.899" />
            </label>
            <label>Restaurants à ajouter
              <input data-report-field="tenantsAdd" data-id="${escapeHtml(report.id)}" placeholder="McDonald's, Paul" />
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
            <textarea data-report-field="reviewNote" data-id="${escapeHtml(report.id)}" placeholder="Note interne / justification">${escapeHtml(report.review_note || '')}</textarea>
          </div>
        </details>

        <div class="report-actions">
          <button class="ghost" data-action="reviewed" data-id="${escapeHtml(report.id)}" type="button">Traité sans modif</button>
          <button class="ghost" data-action="pending" data-id="${escapeHtml(report.id)}" type="button">Remettre à traiter</button>
          <button class="ghost danger-text" data-action="rejected" data-id="${escapeHtml(report.id)}" type="button">Rejeter</button>
        </div>
      </article>
    `;
  }

  async function handleReportAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    if (!id || !action) return;

    if (action === 'apply-report') {
      await applyReport(id, 'reviewed', buildOverridePayload(id));
    } else if (action.startsWith('quick-')) {
      if (action === 'quick-suggested') prepareSuggestedAction(id);
      else prepareQuickAction(id, action);
    } else if (['pending', 'reviewed', 'rejected'].includes(action)) {
      await applyReport(id, action, {});
    }
  }

  function prepareSuggestedAction(id) {
    const report = reports.find((item) => item.id === id);
    if (!report) return;
    openReportEditor(id);
    const type = report.report_type || '';
    const target = cleanReportTarget(report);

    if (type === 'wrong_price') {
      const fuelName = fuelFromTarget(report.target_label);
      if (fuelName) setFieldValue(id, 'fuelName', fuelName);
      setFieldValue(id, 'reviewNote', `Prix à vérifier puis corriger${fuelName ? ` pour ${fuelName}` : ''}.`);
      showFeedback('Correction prix préparée. Renseigne le prix puis valide.');
      return;
    }

    if (type === 'brand_closed' || type === 'service_closed') {
      if (target) {
        const field = isRestaurantLike(target) ? 'tenantsRemove' : 'servicesRemove';
        appendCsvField(id, field, target);
      }
      setFieldValue(id, 'reviewNote', target ? `Retrait recommandé : ${target}` : 'Retrait recommandé, cible à confirmer.');
      showFeedback('Retrait recommandé préparé. Vérifie puis valide.');
      return;
    }

    if (type === 'brand_missing' || type === 'service_missing') {
      if (target) {
        const field = isRestaurantLike(target) ? 'tenantsAdd' : 'servicesAdd';
        appendCsvField(id, field, target);
      }
      setFieldValue(id, 'reviewNote', target ? `Ajout recommandé : ${target}` : 'Ajout recommandé, cible à confirmer.');
      showFeedback('Ajout recommandé préparé. Vérifie puis valide.');
      return;
    }

    if (type === 'wrong_brand') {
      if (target) setFieldValue(id, 'brandOverride', target);
      setFieldValue(id, 'reviewNote', target ? `Marque recommandée : ${target}` : 'Marque à confirmer.');
      showFeedback('Marque préparée. Vérifie puis valide.');
      return;
    }

    setFieldValue(id, 'reviewNote', 'Signalement analysé automatiquement. Décision admin à confirmer.');
    showFeedback('Note préparée. Vérifie puis valide.');
  }

  function prepareQuickAction(id, action) {
    const report = reports.find((item) => item.id === id);
    if (!report) return;
    openReportEditor(id);
    const target = cleanReportTarget(report);

    if (action === 'quick-hide') {
      setFieldValue(id, 'hidden', true);
      setFieldValue(id, 'reviewNote', `Masquage préparé depuis le signalement ${report.id}.`);
      showFeedback('Masquage préparé. Vérifie puis clique sur Valider + appliquer.');
      return;
    }

    if (!target) {
      showFeedback('Aucune cible claire à préparer automatiquement.');
      return;
    }

    const field = isRestaurantLike(target) ? 'tenants' : 'services';
    if (action === 'quick-remove-target') {
      appendCsvField(id, `${field}Remove`, target);
      setFieldValue(id, 'reviewNote', `Retrait préparé : ${target}`);
      showFeedback('Retrait préparé. Vérifie puis clique sur Valider + appliquer.');
      return;
    }

    if (action === 'quick-add-target') {
      appendCsvField(id, `${field}Add`, target);
      setFieldValue(id, 'reviewNote', `Ajout préparé : ${target}`);
      showFeedback('Ajout préparé. Vérifie puis clique sur Valider + appliquer.');
    }
  }

  function openReportEditor(id) {
    const editor = document.querySelector(`details[data-editor-id="${id}"]`);
    if (editor) editor.open = true;
  }

  function reportSuggestedCopy(report, priority) {
    const target = cleanReportTarget(report);
    const type = report.report_type || '';
    if (type === 'wrong_price') {
      return {
        title: 'Vérifier le prix puis appliquer une correction',
        text: `Priorité ${priority.score}. Le carburant concerné est ${fuelFromTarget(report.target_label) || 'à confirmer'}.`,
      };
    }
    if (type === 'brand_closed' || type === 'service_closed') {
      return {
        title: target ? `Retirer ${target}` : 'Retirer un service à confirmer',
        text: 'Prépare une correction de retrait, puis valide uniquement si la donnée officielle ou terrain confirme.',
      };
    }
    if (type === 'brand_missing' || type === 'service_missing') {
      return {
        title: target ? `Ajouter ${target}` : 'Ajouter un service à confirmer',
        text: 'Prépare une correction d’ajout pour enrichir immédiatement la fiche aire.',
      };
    }
    if (type === 'wrong_brand') {
      return {
        title: target ? `Remplacer la marque par ${target}` : 'Corriger la marque station',
        text: 'La correction changera l’enseigne affichée dans l’app pour cette aire.',
      };
    }
    return {
      title: priority.suggestedLabel,
      text: 'Analyse le signalement, ajoute une note interne, puis traite ou rejette.',
    };
  }

  function setFieldValue(id, field, value) {
    const el = document.querySelector(`[data-report-field="${field}"][data-id="${id}"]`);
    if (!el) return;
    if (el.type === 'checkbox') el.checked = value === true;
    else el.value = value ?? '';
  }

  function appendCsvField(id, field, value) {
    const current = splitList(fieldValue(id, field));
    if (!current.some((item) => item.toLowerCase() === value.toLowerCase())) current.push(value);
    setFieldValue(id, field, current.join(', '));
  }

  function cleanReportTarget(report) {
    const target = String(report.target_label || '').trim();
    if (!target || /^prix\s+/i.test(target)) return '';
    return target;
  }

  function isRestaurantLike(value) {
    return /mcdo|mcdonald|burger|kfc|paul|brioche|starbucks|cafe|café|restau|food|sandwich|pizza|subway|class'croute|courtepaille|leon|poivre rouge/i.test(value);
  }

  function fieldValue(id, field) {
    const el = document.querySelector(`[data-report-field="${field}"][data-id="${id}"]`);
    if (!el) return '';
    return el.type === 'checkbox' ? el.checked : el.value.trim();
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
    payload.servicesAdd = splitList(fieldValue(id, 'servicesAdd'));
    payload.servicesRemove = splitList(fieldValue(id, 'servicesRemove'));
    payload.tenantsAdd = splitList(fieldValue(id, 'tenantsAdd'));
    payload.tenantsRemove = splitList(fieldValue(id, 'tenantsRemove'));
    payload.hidden = fieldValue(id, 'hidden') === true;
    if (note) payload.note = note;

    for (const key of ['servicesAdd', 'servicesRemove', 'tenantsAdd', 'tenantsRemove']) {
      if (!payload[key].length) delete payload[key];
    }
    if (!payload.hidden) delete payload.hidden;
    return payload;
  }

  async function applyReport(id, status, payload) {
    showFeedback('Application...');
    const note = fieldValue(id, 'reviewNote');
    const { error } = await client.rpc('admin_apply_report', {
      p_report_id: id,
      p_status: status,
      p_review_note: note,
      p_override: payload,
    });
    if (error) {
      showFeedback(error.message);
      return;
    }
    await loadAdminData();
  }

  function renderOverride(item) {
    return `
      <article class="report compact-report">
        <div class="report-top">
          <div>
            <div class="report-title">${escapeHtml(item.station_name || item.station_id)}</div>
            <div class="meta">
              <span>ID ${escapeHtml(item.station_id)}</span>
              <span>Maj ${formatDate(item.updated_at)}</span>
              ${item.brand_override ? `<span>${escapeHtml(item.brand_override)}</span>` : ''}
            </div>
          </div>
          <span class="pill ${item.is_active ? 'success' : 'muted'}">${item.is_active ? 'Active' : 'Inactive'}</span>
        </div>

        <div class="correction-grid">
          <label>Marque
            <input data-override-field="brand_override" data-id="${escapeHtml(item.id)}" value="${escapeHtml(item.brand_override || '')}" />
          </label>
          <label>Prix JSON
            <textarea data-override-field="fuels" data-id="${escapeHtml(item.id)}">${escapeHtml(JSON.stringify(item.fuels || {}, null, 2))}</textarea>
          </label>
          <label>Restaurants ajoutés
            <input data-override-field="tenants_add" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.tenants_add || []).join(', '))}" />
          </label>
          <label>Restaurants retirés
            <input data-override-field="tenants_remove" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.tenants_remove || []).join(', '))}" />
          </label>
          <label>Services ajoutés
            <input data-override-field="services_add" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.services_add || []).join(', '))}" />
          </label>
          <label>Services retirés
            <input data-override-field="services_remove" data-id="${escapeHtml(item.id)}" value="${escapeHtml((item.services_remove || []).join(', '))}" />
          </label>
          <label class="checkline">
            <input data-override-field="hidden" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.hidden ? 'checked' : ''} />
            Masquer dans l’app
          </label>
          <label class="checkline">
            <input data-override-field="is_active" data-id="${escapeHtml(item.id)}" type="checkbox" ${item.is_active ? 'checked' : ''} />
            Correction active
          </label>
        </div>

        <div class="review-box">
          <textarea data-override-field="note" data-id="${escapeHtml(item.id)}" placeholder="Note interne">${escapeHtml(item.note || '')}</textarea>
        </div>

        <div class="report-actions">
          <button data-action="save-override" data-id="${escapeHtml(item.id)}" type="button">Enregistrer</button>
        </div>
      </article>
    `;
  }

  async function handleOverrideAction(event) {
    const button = event.target.closest('button[data-action="save-override"]');
    if (!button) return;
    const id = button.dataset.id;
    if (!id) return;
    await saveOverride(id);
  }

  function overrideFieldValue(id, field) {
    const el = document.querySelector(`[data-override-field="${field}"][data-id="${id}"]`);
    if (!el) return '';
    return el.type === 'checkbox' ? el.checked : el.value.trim();
  }

  async function saveOverride(id) {
    let fuels = {};
    try {
      fuels = JSON.parse(overrideFieldValue(id, 'fuels') || '{}');
    } catch {
      showFeedback('Le JSON prix est invalide.');
      return;
    }

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

    if (error) {
      showFeedback(error.message);
      return;
    }
    await loadAdminData();
  }

  function renderTopList(items, empty) {
    if (!items.length) return `<p class="hint">${escapeHtml(empty)}</p>`;
    const max = Math.max(...items.map(item => item.count), 1);
    return `
      <div class="top-list">
        ${items.slice(0, 8).map(item => `
          <div class="top-item">
            <div>
              <strong>${escapeHtml(item.label)}</strong>
              ${item.sub ? `<span>${escapeHtml(item.sub)}</span>` : ''}
            </div>
            <em>${item.count}</em>
            <i style="width:${Math.max(8, Math.round((item.count / max) * 100))}%"></i>
          </div>
        `).join('')}
      </div>
    `;
  }

  function topRoutes() {
    const rows = events.filter(e => e.event_type === 'route_search');
    return topBy(rows, (e) => {
      const dep = coarseGridLabel(e.metadata?.depGrid, 'Départ');
      const arr = coarseGridLabel(e.metadata?.arrGrid, 'Arrivée');
      return `${dep} → ${arr}`;
    }, (group) => ({
      sub: `${avg(group.map(e => e.distance_km))} km moyen · ${avg(group.map(e => e.station_count))} aires`,
    }));
  }

  function coarseGridLabel(value, fallback) {
    const lat = Number(value?.lat);
    const lon = Number(value?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;
    return `Zone ${lat.toFixed(1)}, ${lon.toFixed(1)}`;
  }

  function monetizationStats() {
    const routeCount = events.filter(e => e.event_type === 'route_search').length;
    const stationViews = events.filter(e => e.event_type === 'station_view').length;
    const qualifiedProfiles = profiles.filter((profile) => (
      profile.preferred_fuel
      || (profile.favorite_brands || []).length
      || (profile.favorite_tenants || []).length
    )).length;
    const favoriteRate = stationViews ? Math.round((favorites.length / stationViews) * 100) : 0;
    const actionableReports = reports.filter((report) => report.status === 'pending' && reportPriorityInfo(report).score >= 52).length;
    const dataScore = Math.min(100, Math.round(
      (Math.min(routeCount, 200) / 200) * 32
      + (Math.min(stationViews, 300) / 300) * 24
      + (Math.min(qualifiedProfiles, 100) / 100) * 24
      + (Math.min(favorites.length, 120) / 120) * 20
    ));

    return {
      dataScore,
      qualifiedProfiles,
      favoriteRate,
      actionableReports,
    };
  }

  function monetizationOpportunities() {
    const topBrand = topCommercialBrands()[0];
    const topFood = topFoodDemand()[0];
    const topFuel = topFuelPrefs()[0];
    const route = topRoutes()[0];
    const segment = distanceSegments()[0];
    return [
      topBrand && {
        label: `Partenariat station · ${topBrand.label}`,
        count: topBrand.count,
        sub: 'Préférences, favoris et consultations agrégés',
      },
      topFood && {
        label: `Partenariat restauration · ${topFood.label}`,
        count: topFood.count,
        sub: 'Demande explicite dans les préférences utilisateurs',
      },
      topFuel && {
        label: `Offre carburant · ${topFuel.label}`,
        count: topFuel.count,
        sub: 'Carburant préféré le plus représenté',
      },
      route && {
        label: `Axe prioritaire · ${route.label}`,
        count: route.count,
        sub: route.sub || 'Parcours demandé',
      },
      segment && {
        label: `Segment audience · ${segment.label}`,
        count: segment.count,
        sub: segment.sub || 'Typologie de trajet',
      },
    ].filter(Boolean);
  }

  function distanceSegments() {
    const rows = events
      .filter(e => e.event_type === 'route_search')
      .map(e => Number(e.distance_km))
      .filter(Number.isFinite)
      .map((km) => {
        if (km < 120) return { label: 'Courts trajets', sub: '< 120 km' };
        if (km < 350) return { label: 'Trajets régionaux', sub: '120 à 350 km' };
        if (km < 700) return { label: 'Longs trajets', sub: '350 à 700 km' };
        return { label: 'Très longs trajets', sub: '700 km+' };
      });
    return topBy(rows, item => item.label, (group) => ({ sub: group[0]?.sub || '' }));
  }

  function topCommercialBrands() {
    const rows = [];
    for (const profile of profiles) {
      for (const brand of profile.favorite_brands || []) rows.push({ label: brand, weight: 4, sub: 'préférence compte' });
    }
    for (const favorite of favorites) {
      if (favorite.station_brand) rows.push({ label: favorite.station_brand, weight: 3, sub: 'favori station' });
    }
    for (const event of events.filter(e => e.event_type === 'station_view')) {
      if (event.station_brand) rows.push({ label: event.station_brand, weight: 1, sub: 'vue aire' });
    }
    for (const note of notes) {
      if (note.station_brand) rows.push({ label: note.station_brand, weight: 2, sub: 'note utilisateur' });
    }
    return weightedTop(rows);
  }

  function topFoodDemand() {
    const rows = [];
    for (const profile of profiles) {
      for (const tenant of profile.favorite_tenants || []) rows.push({ label: tenant, weight: 4, sub: 'préférence compte' });
    }
    for (const report of reports) {
      const target = cleanReportTarget(report);
      if (target && isRestaurantLike(target)) rows.push({ label: target, weight: report.status === 'pending' ? 2 : 1, sub: 'signalement terrain' });
    }
    return weightedTop(rows);
  }

  function dataQualitySignals() {
    return [
      {
        label: 'Prix carburant à contrôler',
        count: reports.filter(report => report.status === 'pending' && report.report_type === 'wrong_price').length,
        sub: 'Impact direct sur confiance et conversion',
      },
      {
        label: 'Services / restaurants à corriger',
        count: reports.filter(report => report.status === 'pending' && /service|brand|wrong_brand/.test(report.report_type || '')).length,
        sub: 'Impact sur choix de l’aire',
      },
      {
        label: 'Corrections actives',
        count: overrides.filter(item => item.is_active).length,
        sub: 'Données corrigées visibles dans l’app',
      },
      {
        label: 'Doublons à traiter',
        count: duplicateReportGroups().length,
        sub: 'Peut être traité en lot',
      },
    ].filter(item => item.count > 0);
  }

  function routeStats() {
    const rows = events.filter(e => e.event_type === 'route_search');
    return {
      count: rows.length,
      avgDistance: avg(rows.map(e => e.distance_km)),
      avgDuration: avg(rows.map(e => e.duration_min)),
      avgStations: avg(rows.map(e => e.station_count)),
      longest: Math.max(0, ...rows.map(e => Number(e.distance_km)).filter(Number.isFinite)),
    };
  }

  function topPlaceKinds() {
    const rows = [];
    for (const event of events.filter(e => e.event_type === 'route_search')) {
      const depKind = event.metadata?.depKind;
      const arrKind = event.metadata?.arrKind;
      if (depKind) rows.push({ label: `Départ · ${depKind}` });
      if (arrKind) rows.push({ label: `Arrivée · ${arrKind}` });
    }
    return topBy(rows, item => item.label);
  }

  function topStationViews() {
    return topBy(events.filter(e => e.event_type === 'station_view'), e => e.station_name || e.station_id || 'Station', (group) => ({
      sub: group[0]?.station_brand || '',
    }));
  }

  function topFavorites() {
    return topBy(favorites, item => item.station_name || item.station_id || 'Station', (group) => ({
      sub: group[0]?.station_brand || '',
    }));
  }

  function topFuelPrefs() {
    return topBy(profiles.filter(p => p.preferred_fuel), p => p.preferred_fuel);
  }

  function topProfileArray(field) {
    const rows = [];
    for (const profile of profiles) {
      for (const item of profile[field] || []) rows.push({ label: item });
    }
    return topBy(rows, item => item.label);
  }

  function topBy(rows, labelFn, extraFn = () => ({})) {
    const map = new Map();
    for (const row of rows) {
      const label = labelFn(row);
      if (!label) continue;
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(row);
    }
    return Array.from(map.entries())
      .map(([label, group]) => ({ label, count: group.length, ...extraFn(group) }))
      .sort((a, b) => b.count - a.count);
  }

  function weightedTop(rows) {
    const map = new Map();
    for (const row of rows) {
      const label = String(row.label || '').trim();
      if (!label) continue;
      if (!map.has(label)) map.set(label, { score: 0, subs: new Map() });
      const current = map.get(label);
      current.score += Number(row.weight) || 1;
      if (row.sub) current.subs.set(row.sub, (current.subs.get(row.sub) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({
        label,
        count: Math.round(value.score),
        sub: Array.from(value.subs.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 2).join(' · '),
      }))
      .sort((a, b) => b.count - a.count);
  }

  function classifyAddress(label) {
    const text = String(label || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (!text) return '';
    if (/aeroport|airport|terminal/.test(text)) return 'Aéroport';
    if (/gare|sncf|tgv|rer|metro/.test(text)) return 'Gare';
    if (/disney|parc|zoo|aquarium|futuroscope|asterix|loisirs/.test(text)) return 'Loisir';
    if (/hotel|ibis|novotel|campanile|mercure|b&b/.test(text)) return 'Hôtel';
    if (/centre commercial|mall|galerie|outlet|village des marques/.test(text)) return 'Centre commercial';
    if (/restaurant|mcdo|mcdonald|burger|kfc|pizza|cafe|brasserie/.test(text)) return 'Restaurant';
    if (/hopital|clinique|chu|urgences/.test(text)) return 'Santé';
    if (/universite|ecole|campus|lycee|college/.test(text)) return 'Éducation';
    if (/zone industrielle|zi |za |bureau|siege|entreprise|technopole/.test(text)) return 'Pro';
    if (/mairie|prefecture|tribunal|administration/.test(text)) return 'Administration';
    if (/rue|avenue|boulevard|impasse|chemin|allee|route/.test(text)) return 'Adresse';
    return 'Ville';
  }

  function splitList(value) {
    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function fuelFromTarget(value) {
    const match = String(value || '').match(/^Prix\s+(.+)$/i);
    return match ? match[1].trim() : '';
  }

  function countReports(status) {
    return reports.filter((r) => r.status === status).length;
  }

  function countEvents(type) {
    return events.filter((event) => event.event_type === type).length;
  }

  function lastFuelSync() {
    return stats.lastFuelSync || syncRuns.find((run) => run.source === 'fuel_prices_gov') || null;
  }

  function lastFuelSyncLabel() {
    const last = lastFuelSync();
    const value = last?.finishedAt || last?.finished_at;
    return value ? formatDate(value) : 'Pas encore';
  }

  function syncTone() {
    const last = lastFuelSync();
    if (!last) return 'muted';
    return last.status === 'success' ? 'success' : 'danger';
  }

  function lastServiceAreaSync() {
    return stats.lastServiceAreaSync || syncRuns.find((run) => run.source === 'service_areas_operator') || null;
  }

  function lastServiceAreaSyncLabel() {
    const last = lastServiceAreaSync();
    const value = last?.finishedAt || last?.finished_at;
    return value ? formatDate(value) : 'Pas encore';
  }

  function serviceSyncTone() {
    const last = lastServiceAreaSync();
    if (!last) return 'muted';
    return last.status === 'success' ? 'success' : 'danger';
  }

  function latestOsmAreaRuns() {
    const latestByRegion = new Map();
    const cutoff = Date.now() - 36 * 60 * 60 * 1000;
    for (const run of syncRuns) {
      if (run.source !== 'service_areas_osm') continue;
      const region = run.metadata?.region;
      const startedAt = new Date(run.started_at || run.finished_at || 0).getTime();
      if (!OSM_SYNC_REGIONS.has(region) || !Number.isFinite(startedAt) || startedAt < cutoff) continue;
      if (region && !latestByRegion.has(region)) latestByRegion.set(region, run);
    }
    return Array.from(latestByRegion.values());
  }

  function lastOsmAreaSync() {
    return latestOsmAreaRuns()[0] || stats.lastOsmAreaSync || null;
  }

  function osmAreaSyncLabel() {
    const runs = latestOsmAreaRuns();
    if (!runs.length) return 'Pas encore';
    return `${runs.filter((run) => run.status === 'success').length}/${OSM_SYNC_REGION_COUNT} zones vérifiées`;
  }

  function osmAreaSyncTone() {
    const runs = latestOsmAreaRuns();
    if (!runs.length) return 'muted';
    return runs.length === OSM_SYNC_REGION_COUNT && runs.every((run) => run.status === 'success') ? 'success' : 'warning';
  }

  function statusClass(status) {
    if (status === 'reviewed') return 'success';
    if (status === 'rejected') return 'danger';
    return 'warning';
  }

  function avg(values) {
    const valid = values.map(Number).filter(Number.isFinite);
    if (!valid.length) return 0;
    return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
  }

  function ageHours(value) {
    if (!value) return Infinity;
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return Infinity;
    return Math.max(0, (Date.now() - time) / 36e5);
  }

  function formatAgeHours(value) {
    if (!Number.isFinite(value)) return 'inconnu';
    if (value < 1) return `${Math.max(1, Math.round(value * 60))} min`;
    if (value < 48) return `${Math.round(value)} h`;
    return `${Math.round(value / 24)} j`;
  }

  function percent(value, limit) {
    const numericValue = Number(value) || 0;
    const numericLimit = Number(limit) || 0;
    if (!numericLimit) return 0;
    return Math.round((numericValue / numericLimit) * 1000) / 10;
  }

  function formatPercent(value) {
    const numeric = Number(value) || 0;
    return `${numeric.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`;
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

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }

  boot().catch((error) => {
    setText('config-state', error.message ?? 'Erreur inattendue.');
  });
})();
