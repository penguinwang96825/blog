(function () {
  var storageKey = "theme";
  var root = document.documentElement;
  var body = document.getElementById("dayNighttoggle");
  var toggleContainer = document.getElementById("toggleContainer");
  var toggleDot = document.getElementById("toggleDot");
  var sunRadiant = document.getElementById("sunRadiant");
  var moonRadiant = document.getElementById("moonRadiant");
  var clouds = document.getElementsByClassName("cloud");
  var stars = document.getElementById("stars");
  var toggleCrater = document.getElementsByClassName("toggle-crater");

  function toggleClassList(items, className, isActive) {
    for (var i = 0; i < items.length; i += 1) {
      items[i].classList.toggle(className, isActive);
    }
  }

  function setTheme(theme) {
    var isDark = theme === "dark";
    root.classList.toggle("theme-dark", isDark);

    body.classList.toggle("night", isDark);
    toggleContainer.classList.toggle("toggle-container--night", isDark);
    toggleDot.classList.toggle("toggle-dot--night", isDark);
    sunRadiant.classList.toggle("sun-radiant--night", isDark);
    moonRadiant.classList.toggle("moon-radiant--night", isDark);
    stars.classList.toggle("stars--night", isDark);
    toggleClassList(clouds, "cloud--night", isDark);
    toggleClassList(toggleCrater, "toggle-crater--night", isDark);

    body.setAttribute("aria-pressed", isDark ? "true" : "false");
    body.setAttribute("aria-label", isDark ? "Enable light mode" : "Enable dark mode");

    try {
      localStorage.setItem(storageKey, theme);
    } catch (e) {}
  }

  if (!body || !toggleContainer || !toggleDot || !sunRadiant || !moonRadiant || !stars) {
    return;
  }

  toggleContainer.addEventListener("click", function () {
    setTheme(root.classList.contains("theme-dark") ? "light" : "dark");
  });

  body.addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setTheme(root.classList.contains("theme-dark") ? "light" : "dark");
    }
  });

  setTheme(root.classList.contains("theme-dark") ? "dark" : "light");
})();
