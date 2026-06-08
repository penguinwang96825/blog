(function () {
  var storageKey = "theme";
  var root = document.documentElement;
  var toggle = document.querySelector(".theme-toggle");
  var label = toggle ? toggle.querySelector(".theme-toggle__text") : null;

  function setTheme(theme) {
    var isDark = theme === "dark";
    root.classList.toggle("theme-dark", isDark);

    if (toggle) {
      toggle.classList.toggle("is-active", isDark);
      toggle.setAttribute("aria-pressed", isDark ? "true" : "false");
      toggle.setAttribute("aria-label", isDark ? "Enable light mode" : "Enable dark mode");
    }

    if (label) {
      label.textContent = isDark ? "Light" : "Dark";
    }

    try {
      localStorage.setItem(storageKey, theme);
    } catch (e) {}
  }

  if (!toggle) {
    return;
  }

  toggle.addEventListener("click", function () {
    setTheme(root.classList.contains("theme-dark") ? "light" : "dark");
  });

  setTheme(root.classList.contains("theme-dark") ? "dark" : "light");
})();
