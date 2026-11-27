(function (root) {
  'use strict';
  function digest(link) {
    const match = /^https:\/\/routestop\.fr\/admin\/#widget-iphone=([0-9a-f]{64})$/.exec(String(link || '').trim());
    return match ? match[1] : null;
  }

  function controls({ element, client, currentUser }) {
    const open = element('iphone-open'), panel = element('iphone-pair'), input = element('iphone-input');
    const approve = element('iphone-approve'), close = element('iphone-close'), status = element('iphone-status');
    let busy = false;
    function show(visible) {
      panel.classList.toggle('hidden', !visible);
      open.classList.toggle('hidden', visible);
      open.setAttribute('aria-expanded', String(visible));
    }
    function changed() {
      const value = digest(input.value);
      element('iphone-match').textContent = value ? 'Repère à comparer : ' + value.slice(0, 12).toUpperCase()
        : input.value ? 'Ce lien n’est pas une demande RouteStop valide.' : '';
      status.textContent = '';
      approve.disabled = busy || !value;
    }
    function reset() {
      input.value = '';
      input.readOnly = false;
      input.hidden = false;
      element('iphone-input-label').hidden = false;
      changed();
      show(false);
    }
    function receive(url) {
      if (!digest(url)) return false;
      input.value = url;
      input.hidden = true;
      element('iphone-input-label').hidden = true;
      changed();
      show(true);
      return true;
    }
    input.addEventListener('input', changed);
    open.addEventListener('click', () => { show(true); input.focus(); });
    close.addEventListener('click', reset);
    approve.addEventListener('click', async () => {
      const value = digest(input.value), owner = currentUser();
      if (!value || !owner || busy) return;
      busy = true;
      approve.disabled = close.disabled = input.readOnly = true;
      status.textContent = 'Autorisation en cours…';
      try {
        const api = client();
        const { data: levels, error } = await api.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error || levels?.currentLevel !== 'aal2') throw Error('mfa');
        const factors = await api.auth.mfa.listFactors();
        const verified = (factors.data?.totp || []).filter(f => f.status === 'verified');
        const chosen = verified.find(f => f.id === element('mfa-factor').value)
          || verified.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
        if (factors.error || !chosen || currentUser() !== owner) throw Error('mfa');
        const result = await api.rpc('authorize_download_widget_v1', {
          p_kind: 'ios', p_digest: value, p_factor: chosen.id
        });
        if (result.error || result.data !== true) throw Error('denied');
        if (currentUser() !== owner) return;
        reset();
        element('admin-feedback').textContent = 'iPhone autorisé. RouteStop Stats peut maintenant lire les téléchargements.';
      } catch (error) {
        if (currentUser() === owner) status.textContent = error.message === 'mfa'
          ? 'Valide d’abord la double identification de l’admin sur le Mac.'
          : 'Autorisation non confirmée. Vérifie ta connexion à l’admin et réessaie.';
      } finally {
        busy = false;
        close.disabled = input.readOnly = false;
        approve.disabled = !digest(input.value);
      }
    });
    return { receive, reset };
  }

  const api = { digest, controls };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RouteStopIPhoneWidget = api;
})(globalThis);
