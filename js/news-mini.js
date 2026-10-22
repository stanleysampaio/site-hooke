/*
 * Painel "Notícias & Destaques" da home: troca os destaques fixos do HTML pelas
 * 4 últimas notícias publicadas no worker. Se a API falhar ou ainda não houver
 * notícia publicada, os destaques fixos continuam no lugar.
 * Carregar depois de js/main.js (usa window.HookeNewsSlider).
 */
(function () {
  var API_BASE = "https://hooke-news.yelnalts1993.workers.dev";
  var MAX_ITEMS = 4;
  // Versão traduzida da notícia no idioma escolhido no site, quando existir.
  var localize = (window.HookeI18n && window.HookeI18n.localize) || function (it) { return it; };

  var panel = document.querySelector(".m-news-mini");
  var dots = document.getElementById("mNewsDots");
  if (!panel || !dots) return;

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString((window.HookeI18n && window.HookeI18n.lang) || "pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  function slide(item) {
    return (
      '<div class="m-news-slide">' +
      '<span class="m-news-tag">' + escapeHtml(item.sector) + "</span>" +
      '<h3 class="m-news-title">' + escapeHtml(item.title) + "</h3>" +
      '<p class="m-news-date"><i class="fa fa-calendar-alt me-1"></i>' + formatDate(item.publishedAt) + "</p>" +
      '<p class="m-news-excerpt">' + escapeHtml(item.excerpt || item.summary) + "</p>" +
      '<a href="noticia.html?id=' + encodeURIComponent(item.id) + '" class="m-news-link">Leia mais <i class="fa fa-arrow-right"></i></a>' +
      "</div>"
    );
  }

  fetch(API_BASE + "/api/news")
    .then(function (res) { return res.ok ? res.json() : []; })
    .then(function (items) {
      if (!Array.isArray(items) || !items.length) return;
      var latest = items
        .slice()
        .sort(function (a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0); })
        .slice(0, MAX_ITEMS)
        .map(localize);

      panel.querySelectorAll(".m-news-slide").forEach(function (el) { el.remove(); });
      dots.insertAdjacentHTML("beforebegin", latest.map(slide).join(""));
      if (window.HookeNewsSlider) window.HookeNewsSlider();
    })
    .catch(function () { /* mantém os destaques fixos */ });
})();
