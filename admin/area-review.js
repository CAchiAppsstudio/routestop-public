(() => {
  const catalog = window.RouteStopAreaReviewData;
  const categories = {
    access: 'Accès et retour',
    position: 'Position des pompes',
    identity: 'Station et prix',
  };

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function normalize(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function matches(record, search = '', category = 'all') {
    const text = normalize([record.name, record.road, record.id, record.title, record.problem].join(' '));
    return (category === 'all' || record.category === category)
      && normalize(search).trim().split(/\s+/).every((word) => text.includes(word));
  }

  function renderSource(source) {
    if (!/^https:\/\//.test(source.url)) return '';
    return `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.label)} <span aria-label="nouvel onglet">↗</span></a>${source.note ? `<p class="hint">${escapeHtml(source.note)}</p>` : ''}</li>`;
  }

  function renderCard(record) {
    return `<article class="area-review-card" data-area-review-id="${escapeHtml(record.id)}">
      <header class="area-review-card-head">
        <div><p class="area-review-meta"><span class="area-road">${escapeHtml(record.road)}</span> ${escapeHtml(categories[record.category])}</p><h3>${escapeHtml(record.name)}</h3></div>
        <span class="pill warning">En attente</span>
      </header>
      <div class="area-review-columns">
        <div><h4>${escapeHtml(record.title)}</h4><p>${escapeHtml(record.problem)}</p></div>
        <div class="area-review-recommendation"><p class="eyebrow">Ce qu’on garde pour l’instant</p><p>${escapeHtml(record.recommendation)}</p></div>
      </div>
      <details class="area-review-evidence">
        <summary>Ce qu’il faudrait confirmer et les sources</summary>
        <div class="area-review-evidence-body">
          <h4>Pour lever le doute, si on souhaite aller plus loin</h4><p>${escapeHtml(record.next)}</p>
          <h4>Constat du dossier du 18 octobre 2026</h4><p>${escapeHtml(record.reason)}</p>
          ${record.caution ? `<p class="area-review-caution">${escapeHtml(record.caution)}</p>` : ''}
          <ul>${record.sources.map(renderSource).join('')}</ul>
          <p class="hint">Une carte ou une brochure seule peut être incomplète. L’absence de preuve ne signifie pas que l’accès est interdit.</p>
        </div>
      </details>
    </article>`;
  }

  function render() {
    if (!catalog || !Array.isArray(catalog.pending) || !Array.isArray(catalog.confirmed)) {
      return '<div class="error-block">Le dossier des aires n’a pas pu être chargé. Recharge la page. Aucune donnée de l’application n’a été modifiée.</div>';
    }
    return `<div class="area-review">
      <details class="small-help area-review-context">
        <summary>Critères et date de vérification</summary>
      <section class="area-review-intro">
        <p class="eyebrow">Accès aux pompes depuis les deux sens</p>
        <h3>On garde ce qui est sûr.<br>Le reste peut attendre.</h3>
        <p>Pas besoin de tout vérifier maintenant. Cette liste explique les doutes, sans ajouter d’accès incertain ni modifier les prix dans l’application.</p>
        <div class="area-review-counts">
          <div><strong>${catalog.pending.length}</strong><span>dossiers en attente</span></div>
          <div><strong>${catalog.confirmed.length}</strong><span>dossiers retenus, inchangés</span></div>
          <p>Sur les ${catalog.pending.length + catalog.confirmed.length} cas étudiés.<br>Ce n’est pas le nombre total d’aires de RouteStop.</p>
        </div>
        <p class="area-review-date">Sources examinées le 18/10/2026 · Liste préparée le 27/10/2026 · Pas de vérification en temps réel</p>
      </section>
      <div class="area-review-rules">
        <p><strong>Pas de prix ?</strong> Cela ne veut pas dire « pas de station-service ».</p>
        <p><strong>Un pont ?</strong> Il faut aussi pouvoir atteindre les pompes et repartir dans le bon sens, sans sortir de l’autoroute.</p>
      </div>

      </details>
      <div class="area-review-filters">
        <label>Rechercher une aire<input data-area-review-search type="search" placeholder="Chavanon, A29, Esso…" /></label>
        <label>Point à vérifier<select data-area-review-category><option value="all">Tous les points (${catalog.pending.length})</option>${Object.entries(categories).map(([key, label]) => `<option value="${key}">${label} (${catalog.pending.filter(record => record.category === key).length})</option>`).join('')}</select></label>
      </div>
      <p class="hint" data-area-review-count role="status">${catalog.pending.length} dossiers affichés</p>
      <div class="area-review-list" data-area-review-list>${catalog.pending.map(renderCard).join('')}</div>
      <details class="area-review-confirmed">
        <summary>Voir les ${catalog.confirmed.length} dossiers déjà retenus — rien à refaire</summary>
        <p>Ces dossiers correspondent à la liste de référence de l’application, pas à une mesure de la version installée sur chaque téléphone. Aucune nouvelle validation n’est effectuée ici.</p>
        <ul>${catalog.confirmed.map(record => `<li><span class="area-road">${escapeHtml(record.road)}</span> ${escapeHtml(record.name)}</li>`).join('')}</ul>
      </details>
      <p class="hint area-review-scope"><strong>Périmètre :</strong> ${escapeHtml(catalog.profile)} Cette page est un suivi documentaire en lecture seule. Elle n’active aucun accès et ne remplace pas les informations déjà confirmées.</p>
    </div>`;
  }

  function mount(container) {
    container.innerHTML = render();
    const search = container.querySelector('[data-area-review-search]');
    const category = container.querySelector('[data-area-review-category]');
    if (!search || !category) return;
    const update = () => {
      const records = catalog.pending.filter(record => matches(record, search.value, category.value));
      container.querySelector('[data-area-review-list]').innerHTML = records.length
        ? records.map(renderCard).join('')
        : '<div class="empty">Aucun dossier pour cette recherche. Efface la recherche ou choisis « Tous les points ».</div>';
      container.querySelector('[data-area-review-count]').textContent = `${records.length} dossier${records.length === 1 ? '' : 's'} affiché${records.length === 1 ? '' : 's'} sur ${catalog.pending.length}`;
    };
    search.addEventListener('input', update);
    category.addEventListener('change', update);
  }

  window.RouteStopAreaReview = { render, mount, matches };
})();
