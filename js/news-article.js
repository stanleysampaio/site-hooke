/*
 * Renderiza a matéria completa (escrita pela Hooke com base numa fonte real)
 * na página noticia.html, a partir do id na query string (?id=...).
 */
(function () {
  var API_BASE = "https://hooke-news.yelnalts1993.workers.dev";
  var DEFAULT_IMAGE = "img/atuacao.jpg";

  var container = document.getElementById("news-article");
  if (!container) return;

  var isModerno = document.body.classList.contains("m-body");
  // Versão traduzida da notícia no idioma escolhido no site, quando existir.
  var localize = (window.HookeI18n && window.HookeI18n.localize) || function (it) { return it; };

  function resolveImage(path) {
    if (window.HookeNews) return window.HookeNews.resolveImage(path);
    return (path || DEFAULT_IMAGE).replace(/^\//, "");
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

  // Fontes consultadas (modo pesquisa) ou, nas notícias antigas, só o link de origem.
  // "Título da matéria — Portal, por Autor" (autor só quando o site informa).
  function sourceLi(s) {
    var site = s.site || sourceHostname(s.url);
    var title = s.title && s.title !== site ? s.title : "";
    return (
      "<li>" +
      '<a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(title || site) + "</a>" +
      (title ? ' <span class="m-src-site">— ' + escapeHtml(site) + "</span>" : "") +
      (s.author ? '<span class="m-src-author">, <span>por</span> ' + escapeHtml(s.author) + "</span>" : "") +
      "</li>"
    );
  }

  // Fonte principal (a reportagem original) e fontes complementares.
  function sourcesHtml(item) {
    var list = Array.isArray(item.sources) && item.sources.length
      ? item.sources
      : item.link ? [{ url: item.link }] : [];
    if (!list.length) return "";
    var main = list[0];
    var extra = list.slice(1);
    return (
      '<div class="m-news-sources">' +
      "<h6>Fonte principal:</h6><ul>" + sourceLi(main) + "</ul>" +
      (extra.length ? "<h6>Fontes complementares:</h6><ul>" + extra.map(sourceLi).join("") + "</ul>" : "") +
      "</div>"
    );
  }

  // Créditos no topo, como nos portais ("Com informações de ..."): jornalista e
  // veículo de cada fonte, quem tem autor primeiro. Máximo de 3.
  function creditsHtml(item) {
    var list = Array.isArray(item.sources) ? item.sources : [];
    var seen = {};
    var credits = list
      .slice()
      .sort(function (a, b) { return (b.author ? 1 : 0) - (a.author ? 1 : 0); })
      .map(function (s) {
        var site = s.site || sourceHostname(s.url);
        return s.author ? escapeHtml(s.author) + " (" + escapeHtml(site) + ")" : escapeHtml(site);
      })
      .filter(function (c) { if (!c || seen[c]) return false; seen[c] = true; return true; })
      .slice(0, 3);
    if (!credits.length) return "";
    return '<span class="m-article-credits"><span>Com informações de:</span> ' + credits.join(", ") + "</span>";
  }

  // O link compartilhado passa pela rota /share/:id do worker, que entrega as
  // tags de prévia (título, resumo e imagem) para WhatsApp, LinkedIn etc. e
  // redireciona o visitante para esta página.
  function shareHtml(item) {
    var url = encodeURIComponent(API_BASE + "/share/" + encodeURIComponent(item.id));
    var text = encodeURIComponent(item.title);
    var btn = function (cls, href, icon, label) {
      return '<a class="m-share-btn ' + cls + '" href="' + href + '" target="_blank" rel="noopener noreferrer" aria-label="' + label + '" title="' + label + '"><i class="' + icon + '"></i></a>';
    };
    return (
      '<div class="m-share">' +
      '<span class="m-share-label">Compartilhar</span>' +
      (navigator.share ? '<button type="button" class="m-share-btn" data-share-native aria-label="Compartilhar" title="Compartilhar"><i class="fa fa-share-alt"></i></button>' : "") +
      btn("is-whatsapp", "https://wa.me/?text=" + text + "%20" + url, "fab fa-whatsapp", "WhatsApp") +
      btn("is-linkedin", "https://www.linkedin.com/sharing/share-offsite/?url=" + url, "fab fa-linkedin-in", "LinkedIn") +
      btn("is-facebook", "https://www.facebook.com/sharer/sharer.php?u=" + url, "fab fa-facebook-f", "Facebook") +
      btn("is-x", "https://twitter.com/intent/tweet?text=" + text + "&url=" + url, "fab fa-twitter", "X (Twitter)") +
      '<button type="button" class="m-share-btn" data-share-copy aria-label="Copiar link" title="Copiar link"><i class="fa fa-link"></i></button>' +
      '<span class="m-share-feedback" role="status" aria-live="polite"></span>' +
      "</div>"
    );
  }

  function bindShare(item) {
    var shareUrl = API_BASE + "/share/" + encodeURIComponent(item.id);
    var feedback = container.querySelector(".m-share-feedback");
    var t = (window.HookeI18n && window.HookeI18n.t) || function (s) { return s; };
    container.querySelectorAll("[data-share-native]").forEach(function (b) {
      b.addEventListener("click", function () {
        navigator.share({ title: item.title, text: item.excerpt || item.title, url: shareUrl }).catch(function () {});
      });
    });
    container.querySelectorAll("[data-share-copy]").forEach(function (b) {
      b.addEventListener("click", function () {
        var done = function () { feedback.textContent = t("Link copiado!"); setTimeout(function () { feedback.textContent = ""; }, 2500); };
        if (navigator.clipboard) navigator.clipboard.writeText(shareUrl).then(done, function () { window.prompt(t("Copiar link"), shareUrl); });
        else window.prompt(t("Copiar link"), shareUrl);
      });
    });
  }

  // Conta a leitura (uma vez por sessão do navegador, para F5 não inflar).
  function countView(id) {
    var key = "hooke_viewed_" + id;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch (e) { /* sem storage: conta mesmo assim */ }
    fetch(API_BASE + "/api/views/" + encodeURIComponent(id), { method: "POST", keepalive: true }).catch(function () {});
  }

  // Bloco "Mais lidas": 3 outras notícias, pelas leituras; completa com as do
  // mesmo setor e depois as mais recentes enquanto houver poucas leituras.
  function renderMoreNews(current) {
    Promise.all([
      fetch(API_BASE + "/api/news").then(function (r) { return r.ok ? r.json() : []; }),
      fetch(API_BASE + "/api/views").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ]).then(function (res) {
      var views = res[1] || {};
      var others = (res[0] || []).filter(function (it) { return it.id !== current.id; });
      if (!others.length) return;
      var recent = function (a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0); };
      var popular = others.filter(function (it) { return views[it.id] > 0; })
        .sort(function (a, b) { return (views[b.id] - views[a.id]) || recent(a, b); });
      var sameSector = others.filter(function (it) { return it.sector === current.sector; }).sort(recent);
      var picks = [];
      popular.concat(sameSector, others.slice().sort(recent)).forEach(function (it) {
        if (picks.length < 3 && picks.indexOf(it) === -1) picks.push(it);
      });

      var block = document.createElement("section");
      block.className = "m-more-news";
      block.innerHTML =
        "<h4>Mais lidas</h4>" +
        '<div class="m-more-grid">' +
        picks.map(localize).map(function (it) {
          return (
            '<a class="m-more-card" href="noticia.html?id=' + encodeURIComponent(it.id) + '">' +
            '<div class="m-more-img" style="background-image:url(\'' + escapeHtml(resolveImage(it.image)) + "');\"></div>" +
            '<div class="m-more-body">' +
            (window.HookeNews ? window.HookeNews.kicker(it) : '<span class="m-badge">' + escapeHtml(it.sector) + "</span>") +
            "<h6>" + escapeHtml(it.title) + "</h6>" +
            '<p class="m-text-muted small mb-0">' + formatDate(it.publishedAt) + "</p>" +
            "</div></a>"
          );
        }).join("") +
        "</div>";
      var col = container.querySelector(".col-lg-8");
      if (col) col.appendChild(block);
    }).catch(function () { /* sem sugestões */ });
  }

  function render(item) {
    countView(item.id);
    renderMoreNews(item);
    item = localize(item);
    document.title = item.title + " — Hooke Notícias";

    var badgeClass = isModerno ? "m-badge" : "badge bg-primary";
    // Formatação mínima vinda da IA: "## " = intertítulo, **trecho** = negrito.
    // O texto é escapado antes, então nada além disso vira HTML.
    var firstParagraph = true;
    var bodyHtml = (item.body && item.body.length ? item.body : [item.excerpt || item.summary || ""])
      .map(function (p) {
        p = String(p);
        if (p.indexOf("## ") === 0) return '<h2 class="m-news-subhead">' + escapeHtml(p.slice(3)) + "</h2>";
        var html = escapeHtml(p)
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*\*/g, "")
          // Link interno para notícia relacionada: [[trecho|id]]
          .replace(/\[\[([^|\]]+)\|([0-9a-f-]{36})\]\]/g, '<a class="m-news-inlink" href="noticia.html?id=$2">$1</a>')
          .replace(/\[\[([^|\]]+)\|[^\]]*\]\]/g, "$1");
        var cls = firstParagraph ? ' class="m-news-lead"' : "";
        firstParagraph = false;
        return "<p" + cls + ">" + html + "</p>";
      })
      .join("");

    // Cabeçalho no formato de portal: caminho + chapéu, título, linha fina e
    // a linha de assinatura (edição, data e hora, tempo de leitura, compartilhar).
    var N = window.HookeNews;
    var kicker = N ? N.kicker(item) : '<span class="' + badgeClass + '">' + escapeHtml(item.sector) + "</span>";
    var when = N ? N.formatDate(item.publishedAt, true) : formatDate(item.publishedAt);
    var minutes = N ? N.readingMinutes(item) : 0;
    var deck = String(item.excerpt || item.summary || "").replace(/\*\*/g, "");

    container.innerHTML =
      '<div class="col-lg-8 mx-auto">' +
      '<nav class="m-crumbs"><a href="news.html">Notícias</a><i class="fa fa-chevron-right"></i>' + kicker + "</nav>" +
      '<h1 class="m-article-title">' + escapeHtml(item.title) + "</h1>" +
      (deck ? '<p class="m-article-deck">' + escapeHtml(deck) + "</p>" : "") +
      '<div class="m-article-byline">' +
      '<div class="m-article-byline-text">' +
      creditsHtml(item) +
      (item.reviewedBy ? '<span class="m-article-author"><strong>Edição:</strong> <span>' + escapeHtml(item.reviewedBy) + "</span></span>" : "") +
      "<span>" + when + "</span>" +
      (minutes ? '<span><i class="fa fa-clock"></i> ' + minutes + " <span>min de leitura</span></span>" : "") +
      "</div>" +
      shareHtml(item) +
      "</div>" +
      '<figure class="mb-4">' +
      '<div class="news-article-img" role="img" aria-label="' + escapeHtml(item.imageAlt || item.title) + '" style="background-image:url(\'' + escapeHtml(resolveImage(item.image)) + "');\"></div>" +
      "</figure>" +
      '<div class="news-article-body">' + bodyHtml + "</div>" +
      sourcesHtml(item) +
      shareHtml(item) +
      '<a href="news.html" class="d-inline-block mt-4"><i class="fa fa-arrow-left me-1"></i>Voltar para notícias</a>' +
      "</div>";
    bindShare(item);
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
