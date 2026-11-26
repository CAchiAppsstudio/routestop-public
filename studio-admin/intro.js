(() => {
  const key = "cachi-studio:ink-intro-seen";
  const root = document.documentElement;
  const navigation = window.performance.getEntriesByType("navigation")[0];
  let showIntro = navigation?.type === "reload";
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      const storage = window[name];
      if (!storage.getItem(key)) {
        storage.setItem(key, "1");
        showIntro = true;
      }
      break;
    } catch {
      // Try the next storage option if the browser blocks this one.
    }
  }
  if (showIntro) root.setAttribute("data-studio-intro", "");
  window.addEventListener("pageshow", event => {
    if (event.persisted) root.removeAttribute("data-studio-intro");
  });
})();
