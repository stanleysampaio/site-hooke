/*
 * Renderiza a matéria completa (escrita pela Hooke com base numa fonte real)
 * na página noticia.html / moderno/noticia.html, a partir do id na query
 * string (?id=...). Funciona nas duas versões do site via classe "m-body".
 */
(function () {
  var API_BASE = "https://hooke-news.yelnalts1993.workers.dev";
  var DEFAULT_IMAGE = "img/atuacao.jpg";

  var container = document.getElementById("news-article");
  if (!container) return;

  var isModerno = document.body.classList.contains("m-body");

  function resolveImage(path) {
    var p = (path || DEFAULT_IMAGE).replace(/^\//, "");
    return isModerno ? "../" + p : p;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function sourceHostname(link) {
    try {
      return new URL(link).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  function render(item) {
    document.title = item.title + " — Hooke Notícias";

    var badgeClass = isModerno ? "m-badge" : "badge bg-primary";
    var bodyHtml = (item.body && item.body.length ? item.body : [item.excerpt || item.summary || ""])
      .map(function (p) { return "<p>" + escapeHtml(p) + "</p>"; })
      .join("");

    container.innerHTML =
      '<div class="col-lg-8 mx-auto">' +
      '<span class="' + badgeClass + '" style="width:fit-content">' + escapeHtml(item.sector) + "</span>" +
      '<h1 class="mt-3 mb-2">' + escapeHtml(item.title) + "</h1>" +
      '<p class="text-muted small mb-4"><i class="fa fa-calendar-alt me-1"></i>' + formatDate(item.publishedAt) + "</p>" +
      '<div class="news-article-img mb-4" style="background-image:url(\'' + escapeHtml(resolveImage(item.image)) + "');\"></div>" +
      '<div class="news-article-body">' + bodyHtml + "</div>" +
      (item.link
        ? '<p class="small text-muted mt-4">Fonte: <a href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(sourceHostname(item.link)) + "</a></p>"
        : "") +
      '<a href="news.html" class="d-inline-block mt-3"><i class="fa fa-arrow-left me-1"></i>Voltar para notícias</a>' +
      "</div>";
  }

  function renderError() {
    container.innerHTML =
      '<div class="col-lg-8 mx-auto text-center">' +
      '<p class="text-muted">Não foi possível encontrar essa notícia.</p>' +
      '<a href="news.html"><i class="fa fa-arrow-left me-1"></i>Voltar para notícias</a>' +
      "</div>";
  }

  var id = new URLSearchParams(location.search).get("id");
  if (!id) {
    renderError();
    return;
  }

  fetch(API_BASE + "/api/news/" + encodeURIComponent(id))
    .then(function (res) {
      if (!res.ok) throw new Error("Notícia não encontrada");
      return res.json();
    })
    .then(render)
    .catch(renderError);
})();
