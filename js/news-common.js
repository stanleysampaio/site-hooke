/*
 * news-common.js — utilitários compartilhados pelas páginas de notícias
 * (news.html, noticia.html, painel da home). Carregar antes de news-feed.js /
 * news-article.js / news-mini.js.
 */
(function () {
  var i18n = window.HookeI18n || { t: function (s) { return s; }, lang: "pt-BR", localize: function (it) { return it; } };

  // Cor do "chapéu" de cada editoria (como nos portais: cada seção tem a sua).
  var SECTOR_COLORS = {
    "Mineração": "#b45309",
    "Cimento": "#57534e",
    "Petróleo e Gás": "#0f766e",
    "Fertilizantes": "#15803d",
    "Metalurgia": "#475569",
    "Refrigeração": "#0369a1",
    "Alimentícia": "#be123c",
    "Siderurgia": "#9a3412",
    "Indústria BA e MG": "#6d28d9",
    "Infraestrutura": "#1d4ed8",
  };

  function escapeHtml(str) {
    return String(str || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function formatDate(iso, withTime) {
    if (!iso) return "";
    try {
      var opts = { day: "2-digit", month: "long", year: "numeric" };
      if (withTime) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
      return new Date(iso).toLocaleString(i18n.lang || "pt-BR", opts);
    } catch (e) {
      return "";
    }
  }

  // "há 2 horas", "ontem", "há 3 dias"; depois de uma semana, a data.
  function relativeTime(iso) {
    if (!iso) return "";
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    try {
      var rtf = new Intl.RelativeTimeFormat(i18n.lang || "pt-BR", { numeric: "auto" });
      if (diff < 3600) return rtf.format(-Math.max(1, Math.round(diff / 60)), "minute");
      if (diff < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
      if (diff < 7 * 86400) return rtf.format(-Math.round(diff / 86400), "day");
    } catch (e) { /* navegador sem Intl.RelativeTimeFormat */ }
    return formatDate(iso);
  }

  function readingMinutes(item) {
    var words = (item.body || []).join(" ").replace(/\*\*|\[\[|\]\]|\|[0-9a-f-]{36}/g, "").split(/\s+/).length;
    return Math.max(1, Math.round(words / 200));
  }

  // Editorias criadas no painel ganham uma cor fixa escolhida pelo nome.
  var EXTRA_COLORS = ["#0e7490", "#7c2d12", "#4d7c0f", "#9d174d", "#1e40af", "#a16207", "#5b21b6", "#065f46"];

  function sectorColor(sector) {
    if (SECTOR_COLORS[sector]) return SECTOR_COLORS[sector];
    var h = 0;
    String(sector || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return sector ? EXTRA_COLORS[h % EXTRA_COLORS.length] : "#14171a";
  }

  // Aceita a notícia (usa o nome original para a cor) ou só o nome da editoria.
  function colorOf(x) {
    return sectorColor(typeof x === "string" ? x : x.sectorPt || x.sector);
  }

  // Chapéu: nome da editoria em caixa alta, na cor dela.
  function kicker(x) {
    var name = typeof x === "string" ? x : x.sector;
    return '<span class="m-kicker" style="--k:' + colorOf(x) + '">' + escapeHtml(name) + "</span>";
  }

  var SITE_URL = "https://www.hookengenharia.com.br";

  // As imagens das notícias ficam só no bucket (img/noticias/): com o endereço
  // completo elas aparecem também fora do domínio (testes locais, prévias).
  function resolveImage(path) {
    if (!path) return "img/atuacao.jpg";
    if (/^https?:\/\//.test(path)) return path;
    if (/^\/?img\/noticias\//.test(path)) return SITE_URL + "/" + path.replace(/^\//, "");
    return path.replace(/^\//, "");
  }

  window.HookeNews = {
    API_BASE: "https://hooke-news.yelnalts1993.workers.dev",
    resolveImage: resolveImage,
    i18n: i18n,
    escapeHtml: escapeHtml,
    formatDate: formatDate,
    relativeTime: relativeTime,
    readingMinutes: readingMinutes,
    sectorColor: sectorColor,
    colorOf: colorOf,
    kicker: kicker,
    excerptOf: function (item) { return String(item.excerpt || item.summary || "").replace(/\*\*/g, ""); },
    href: function (item) { return "noticia.html?id=" + encodeURIComponent(item.id); },
  };
})();
