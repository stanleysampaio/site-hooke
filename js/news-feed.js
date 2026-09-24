/*
 * Busca as notícias publicadas (curadas por IA + aprovadas por um admin) no
 * worker do Cloudflare e renderiza destaque + últimas notícias em #news-feed.
 * Funciona tanto na versão clássica quanto na moderna do site — o template
 * muda conforme a presença da classe "m-body" no <body>. Cada card leva para
 * noticia.html, a matéria completa escrita pela Hooke (não pro site fonte).
 */
(function () {
  var API_BASE = "https://hooke-news.yelnalts1993.workers.dev";
  var DEFAULT_IMAGE = "img/atuacao.jpg";

  var container = document.getElementById("news-feed");
  if (!container) return;

  var isModerno = document.body.classList.contains("m-body");

  function resolveImage(path) {
    return (path || DEFAULT_IMAGE).replace(/^\//, "");
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

  function excerptOf(item) {
    return item.excerpt || item.summary || "";
  }

  function detailHref(item) {
    return "noticia.html?id=" + encodeURIComponent(item.id);
  }

  function featuredCard(item) {
    var badgeClass = isModerno ? "m-badge" : "badge bg-primary";
    var cardClass = isModerno ? "m-news-featured" : "bg-light rounded shadow-sm";
    return (
      '<div class="col-12 mb-4">' +
      '<a href="' + detailHref(item) + '" class="text-decoration-none">' +
      '<div class="' + cardClass + ' overflow-hidden">' +
      '<div class="row g-0 align-items-stretch">' +
      '<div class="col-md-6">' +
      '<div class="news-featured-img" style="background-image:url(\'' + escapeHtml(resolveImage(item.image)) + "');\"></div>" +
      "</div>" +
      '<div class="col-md-6 p-4 p-lg-5 d-flex flex-column justify-content-center">' +
      '<span class="' + badgeClass + '" style="width:fit-content">' + escapeHtml(item.sector) + "</span>" +
      '<h3 class="mt-3 mb-2' + (isModerno ? " m-text-dark" : "") + '">' + escapeHtml(item.title) + "</h3>" +
      '<p class="small ' + (isModerno ? "m-text-muted" : "text-muted") + ' mb-2"><i class="fa fa-calendar-alt me-1"></i>' + formatDate(item.publishedAt) + "</p>" +
      '<p class="mb-0">' + escapeHtml(excerptOf(item)) + "</p>" +
      "</div></div></div></a></div>"
    );
  }

  function classicCard(item) {
    return (
      '<div class="col-md-4 col-lg-3">' +
      '<a href="' + detailHref(item) + '" class="text-decoration-none text-reset">' +
      '<div class="bg-light rounded h-100 news-card">' +
      '<div class="news-card-img" style="background-image:url(\'' + escapeHtml(resolveImage(item.image)) + "');\"></div>" +
      '<div class="p-3">' +
      '<span class="badge bg-primary mb-2">' + escapeHtml(item.sector) + "</span>" +
      '<h6 class="mb-2">' + escapeHtml(item.title) + "</h6>" +
      '<p class="text-muted small mb-2"><i class="fa fa-calendar-alt me-1"></i>' + formatDate(item.publishedAt) + "</p>" +
      '<p class="small mb-0">' + escapeHtml(excerptOf(item)) + "</p>" +
      "</div></div></a></div>"
    );
  }

  function modernoCard(item) {
    return (
      '<div class="col-md-4 col-lg-3">' +
      '<a href="' + detailHref(item) + '" class="text-decoration-none">' +
      '<div class="m-news-card h-100">' +
      '<div class="news-card-img" style="background-image:url(\'' + escapeHtml(resolveImage(item.image)) + "');\"></div>" +
      '<div class="p-3">' +
      '<span class="m-badge">' + escapeHtml(item.sector) + "</span>" +
      '<h6 class="mb-2 mt-2">' + escapeHtml(item.title) + "</h6>" +
      '<p class="m-text-muted small mb-2"><i class="fa fa-calendar-alt me-1"></i>' + formatDate(item.publishedAt) + "</p>" +
      '<p class="small mb-0">' + escapeHtml(excerptOf(item)) + "</p>" +
      "</div></div></a></div>"
    );
  }

  function render(items) {
    if (!items.length) {
      container.innerHTML =
        '<div class="col-12"><p class="text-center text-muted">Nenhuma notícia publicada ainda.</p></div>';
      return;
    }

    var sorted = items.slice().sort(function (a, b) {
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    });

    var featured = sorted[0];
    var rest = sorted.slice(1);
    var cardFn = isModerno ? modernoCard : classicCard;

    var html = featuredCard(featured);
    if (rest.length) {
      html +=
        '<div class="col-12 mt-2 mb-3"><h4>Últimas notícias</h4></div>' +
        rest.map(cardFn).join("");
    }
    container.innerHTML = html;
  }

  fetch(API_BASE + "/api/news")
    .then(function (res) {
      if (!res.ok) throw new Error("Falha ao buscar notícias");
      return res.json();
    })
    .then(render)
    .catch(function () {
      container.innerHTML =
        '<div class="col-12"><p class="text-center text-muted">Não foi possível carregar as notícias agora. Tente novamente mais tarde.</p></div>';
    });
})();
