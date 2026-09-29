(function () {
  var STORAGE_KEY = "utopia_legal_lang";
  var supportedLanguages = ["es", "en"];

  function setLanguage(language) {
    var selected = supportedLanguages.indexOf(language) >= 0 ? language : "es";
    document.documentElement.lang = selected;

    document.querySelectorAll("[data-lang-content]").forEach(function (section) {
      section.hidden = section.getAttribute("data-lang-content") !== selected;
    });

    document.querySelectorAll("[data-lang-button]").forEach(function (button) {
      var active = button.getAttribute("data-lang-button") === selected;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });

    var title = document.body.getAttribute("data-title-" + selected);
    if (title) document.title = title;

    try {
      localStorage.setItem(STORAGE_KEY, selected);
    } catch (_error) {
      // The switch still works when browser storage is unavailable.
    }
  }

  var savedLanguage = null;
  try {
    savedLanguage = localStorage.getItem(STORAGE_KEY);
  } catch (_error) {
    // Spanish remains the default when browser storage is unavailable.
  }

  document.querySelectorAll("[data-lang-button]").forEach(function (button) {
    button.addEventListener("click", function () {
      setLanguage(button.getAttribute("data-lang-button"));
    });
  });

  setLanguage(savedLanguage || "es");
})();
