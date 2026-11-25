(() => {
  const route = document.querySelector("[data-route]");
  const pod = document.querySelector("[data-pod]");
  window.StudioAdmin.mount({
    home: true,
    onAccess(access) {
      route.hidden = !access?.routeStop;
      pod.hidden = !access?.podLegacy;
    },
  });
})();
