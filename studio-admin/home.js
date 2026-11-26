(() => {
  const route = document.querySelector("[data-route]");
  const pod = document.querySelector("[data-pod]");
  const body = document.body;
  const seenKey = "cachi-studio:apps-entered";
  let seen = false;
  try {
    seen = sessionStorage.getItem(seenKey) === "1";
  } catch {}

  if (window.location.origin === "https://routestop.fr") route.href = "/admin/";

  window.StudioAdmin.mount({
    home: true,
    onAccess(access) {
      route.hidden = !access?.routeStop;
      pod.hidden = !access?.podLegacy;
      body.classList.toggle("studio-signed-in", Boolean(access));
      if (!access) {
        body.classList.remove("studio-projects-enter");
        return;
      }
      if (seen) return;
      seen = true;
      body.classList.add("studio-projects-enter");
      try {
        sessionStorage.setItem(seenKey, "1");
      } catch {}
    },
  });
})();
