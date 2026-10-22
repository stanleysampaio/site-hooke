/*
 * Página de notícias (news.html), no formato dos portais: cabeçalho com data e
 * abas de editoria, manchete + submanchetes, "Últimas notícias" em lista,
 * blocos por editoria, "Mais lidas" numerada e inscrição na newsletter.
 * As notícias vêm do worker da Cloudflare (geradas por IA, aprovadas no painel).
 * Depende de js/news-common.js.
 */
(function () {
  var N = window.HookeNews;
  var grid = document.getElementById("news-feed");
  if (!grid || !N) return;

  var t = N.i18n.t;
  // Nome exibido da editoria (pode estar traduzido) -> nome original, para a cor.
  var ptOf = {};
  var esc = N.escapeHtml;
  var HERO_COUNT = 3;
  var SIDE_COUNT = 3;
  var PAGE_SIZE = 8;
  var HERO_INTERVAL = 7000;

  function viewsHtml(views, id) {
    var n = views[id] || 0;
    return n ? '<span class="m-news-views" aria-label="' + n + " " + esc(t("visualizações")) + '"><i class="fa fa-eye"></i> ' + n + "</span>" : "";
  }

  function meta(item, views) {
    return '<div class="m-meta"><span>' + N.relativeTime(item.publishedAt) + "</span>" + viewsHtml(views, item.id) + "</div>";
  }

  /* ---------- Data do dia e relógio ao vivo (horário de Brasília) ---------- */
  var today = document.getElementById("newsToday");
  var clock = document.getElementById("newsClock");
  function tick() {
    var now = new Date();
    try {
      if (today) today.textContent = now.toLocaleDateString(N.i18n.lang || "pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "America/Sao_Paulo" });
      if (clock) {
        clock.textContent = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });
        clock.setAttribute("datetime", now.toISOString());
      }
    } catch (e) { /* sem Intl */ }
  }
  tick();
  setInterval(tick, 1000);

  /* ---------- Manchete (troca entre as principais) + submanchetes ---------- */
  function renderLead(main, side) {
    var lead = document.getElementById("newsLead");
    var track = document.getElementById("newsHeroTrack");
    var dotsWrap = document.getElementById("newsHeroDots");
    if (!lead || !main.length) return;

    track.innerHTML = main.map(function (item, i) {
      return (
        '<a class="m-lead-slide' + (i === 0 ? " active" : "") + '" href="' + N.href(item) + '" style="background-image:url(\'' + esc(N.resolveImage(item.image)) + "');\">" +
        '<div class="m-lead-overlay"></div>' +
        '<div class="m-lead-content">' + N.kicker(item) +
        "<h2>" + esc(item.title) + "</h2>" +
        "<p>" + esc(N.excerptOf(item)) + "</p>" +
        "</div></a>"
      );
    }).join("");

    document.getElementById("newsLeadSide").innerHTML = side.map(function (item) {
      return (
        '<a class="m-sub" href="' + N.href(item) + '">' +
        '<div class="m-sub-img news-card-img" style="background-image:url(\'' + esc(N.resolveImage(item.image)) + "');\"></div>" +
        N.kicker(item) +
        "<h3>" + esc(item.title) + "</h3>" +
        "</a>"
      );
    }).join("");
    lead.hidden = false;

    var slides = track.querySelectorAll(".m-lead-slide");
    if (slides.length < 2) return;
    var current = 0;
    var timer;
    var dots = Array.prototype.map.call(slides, function (_, i) {
      var d = document.createElement("button");
      d.type = "button";
      d.className = i === 0 ? "active" : "";
      d.setAttribute("aria-label", t("Destaque") + " " + (i + 1));
      d.addEventListener("click", function () { show(i); restart(); });
      dotsWrap.appendChild(d);
      return d;
    });
    function show(i) {
      slides[current].classList.remove("active");
      dots[current].classList.remove("active");
      current = (i + slides.length) % slides.length;
      slides[current].classList.add("active");
      dots[current].classList.add("active");
    }
    function restart() {
      clearInterval(timer);
      timer = setInterval(function () { show(current + 1); }, HERO_INTERVAL);
    }
    var hero = document.getElementById("newsHero");
    hero.addEventListener("mouseenter", function () { clearInterval(timer); });
    hero.addEventListener("mouseleave", restart);
    restart();
  }

  /* ---------- "Últimas notícias" em lista + abas de editoria ---------- */
  function feedItem(item, views) {
    return (
      '<a class="m-feed-item" href="' + N.href(item) + '">' +
      '<div class="m-feed-img news-card-img" style="background-image:url(\'' + esc(N.resolveImage(item.image)) + "');\"></div>" +
      '<div class="m-feed-body">' + N.kicker(item) +
      "<h3>" + esc(item.title) + "</h3>" +
      '<p class="m-feed-excerpt">' + esc(N.excerptOf(item)) + "</p>" +
      meta(item, views) +
      "</div></a>"
    );
  }

  function renderFeed(all, latest, views) {
    var tabs = document.getElementById("newsFilters");
    var moreBtn = document.getElementById("newsMore");
    var title = document.getElementById("newsFeedTitle");
    var lead = document.getElementById("newsLead");
    var sections = document.getElementById("newsSections");
    var sector = "";
    var shown = PAGE_SIZE;

    function list() {
      return sector ? all.filter(function (it) { return it.sector === sector; }) : latest;
    }

    function draw() {
      var items = list();
      grid.innerHTML = items.length
        ? items.slice(0, shown).map(function (it) { return feedItem(it, views); }).join("")
        : '<p class="m-text-muted">Nenhuma notícia neste setor ainda.</p>';
      moreBtn.hidden = items.length <= shown;
      title.textContent = sector || t("Últimas notícias");
      title.style.setProperty("--k", sector ? N.sectorColor(ptOf[sector]) : "");
      // Com uma editoria escolhida, a página vira a "capa" daquela editoria.
      if (lead) lead.hidden = !!sector || !lead.querySelector(".m-lead-slide");
      if (sections) sections.hidden = !!sector;
    }

    var sectors = [];
    all.forEach(function (it) { if (it.sector && sectors.indexOf(it.sector) === -1) sectors.push(it.sector); });
    if (tabs) {
      tabs.innerHTML =
        '<button type="button" class="m-tab active" data-sector="">' + esc("Todas") + "</button>" +
        sectors.map(function (s) {
          return '<button type="button" class="m-tab" data-sector="' + esc(s) + '" style="--k:' + N.sectorColor(ptOf[s]) + '">' + esc(s) + "</button>";
        }).join("");
      tabs.addEventListener("click", function (e) {
        var b = e.target.closest(".m-tab");
        if (!b) return;
        tabs.querySelectorAll(".m-tab").forEach(function (c) { c.classList.toggle("active", c === b); });
        sector = b.getAttribute("data-sector");
        shown = PAGE_SIZE;
        draw();
        window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
      });
    }
    moreBtn.addEventListener("click", function () { shown += PAGE_SIZE; draw(); });
    draw();
  }

  /* ---------- Blocos por editoria (as que têm 3+ notícias) ---------- */
  function renderSections(all, views) {
    var wrap = document.getElementById("newsSections");
    if (!wrap) return;
    var bySector = {};
    all.forEach(function (it) { (bySector[it.sector] = bySector[it.sector] || []).push(it); });
    wrap.innerHTML = Object.keys(bySector)
      .filter(function (s) { return bySector[s].length >= 3; })
      .map(function (s) {
        var items = bySector[s].slice(0, 4);
        var first = items[0];
        return (
          '<section class="m-sector-section" style="--k:' + N.sectorColor(ptOf[s]) + '">' +
          '<h2 class="m-sector-section-title"><button type="button" data-goto="' + esc(s) + '">' + esc(s) + ' <i class="fa fa-chevron-right"></i></button></h2>' +
          '<div class="m-sector-section-grid">' +
          '<a class="m-sub" href="' + N.href(first) + '">' +
          '<div class="m-sub-img news-card-img" style="background-image:url(\'' + esc(N.resolveImage(first.image)) + "');\"></div>" +
          "<h3>" + esc(first.title) + "</h3>" + meta(first, views) + "</a>" +
          '<ul class="m-sector-section-list">' +
          items.slice(1).map(function (it) {
            return '<li><a href="' + N.href(it) + '"><h4>' + esc(it.title) + "</h4>" + meta(it, views) + "</a></li>";
          }).join("") +
          "</ul></div></section>"
        );
      }).join("");
    wrap.addEventListener("click", function (e) {
      var b = e.target.closest("[data-goto]");
      if (!b) return;
      var tab = document.querySelector('.m-tab[data-sector="' + b.getAttribute("data-goto").replace(/"/g, '\\"') + '"]');
      if (tab) tab.click();
    });
  }

  /* ---------- Mais lidas ---------- */
  function renderPopular(items, views) {
    var list = document.getElementById("newsPopular");
    if (!list) return;
    var recent = function (a, b) { return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0); };
    var top = items.slice().sort(function (a, b) { return ((views[b.id] || 0) - (views[a.id] || 0)) || recent(a, b); }).slice(0, 5);
    list.innerHTML = top.map(function (it) {
      return (
        '<li><a href="' + N.href(it) + '">' +
        N.kicker(it) +
        '<span class="m-popular-title">' + esc(it.title) + "</span>" +
        "</a></li>"
      );
    }).join("");
  }

  /* ---------- Newsletter ---------- */
  function bindNewsletter() {
    var form = document.getElementById("newsletterForm");
    if (!form) return;
    var status = form.querySelector(".m-newsletter-status");
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.elements.email.value.trim();
      status.className = "m-newsletter-status";
      if (form.elements.site.value) { status.textContent = t("Inscrição confirmada!"); return; }
      if (!form.elements.email.checkValidity() || !email) { status.textContent = t("Informe um e-mail válido."); status.classList.add("is-error"); return; }
      if (!form.elements.consent.checked) { status.textContent = t("Marque a autorização para receber a newsletter."); status.classList.add("is-error"); return; }

      var btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      fetch(N.API_BASE + "/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, consent: true, lang: N.i18n.lang }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error();
          status.textContent = t("Inscrição confirmada!");
          status.classList.add("is-ok");
          form.reset();
          if (window.dataLayer) window.dataLayer.push({ event: "newsletter_inscricao" });
        })
        .catch(function () {
          status.textContent = t("Não foi possível concluir a inscrição. Tente novamente.");
          status.classList.add("is-error");
        })
        .then(function () { btn.disabled = false; });
    });
  }

  function render(items, views) {
    if (!items.length) {
      grid.innerHTML = '<p class="m-text-muted">Nenhuma notícia publicada ainda.</p>';
      return;
    }
    var sorted = items.map(N.i18n.localize).sort(function (a, b) {
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    });
    sorted.forEach(function (it) { ptOf[it.sector] = it.sectorPt || it.sector; });
    // Com poucas notícias, não repete na lista o que já está na manchete.
    var leadCount = sorted.length >= 7 ? HERO_COUNT + SIDE_COUNT : 0;
    if (leadCount) renderLead(sorted.slice(0, HERO_COUNT), sorted.slice(HERO_COUNT, leadCount));
    renderFeed(sorted, sorted.slice(leadCount), views);
    renderSections(sorted, views);
    renderPopular(sorted, views);
  }

  bindNewsletter();

  Promise.all([
    fetch(N.API_BASE + "/api/news").then(function (res) {
      if (!res.ok) throw new Error("Falha ao buscar notícias");
      return res.json();
    }),
    fetch(N.API_BASE + "/api/views").then(function (res) { return res.ok ? res.json() : {}; }).catch(function () { return {}; }),
  ])
    .then(function (r) { render(r[0], r[1] || {}); })
    .catch(function () {
      grid.innerHTML = '<p class="m-text-muted">Não foi possível carregar as notícias agora. Tente novamente mais tarde.</p>';
    });
})();
