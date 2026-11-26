(() => {
  const key = "cachi-studio:ink-intro-seen";
  const root = document.documentElement;
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      const storage = window[name];
      if (!storage.getItem(key)) {
        storage.setItem(key, "1");
        root.setAttribute("data-studio-intro", "");
      }
      break;
    } catch {
      // Try the next storage option if the browser blocks this one.
    }
  }
  window.addEventListener("pageshow", event => {
    if (event.persisted) root.removeAttribute("data-studio-intro");
  });
})();
