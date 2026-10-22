/**
 * i18n.js — seletor de idioma e tradução do site.
 *
 * O pt-BR é o idioma-fonte, escrito direto no HTML. Nos outros idiomas, ao
 * carregar o DOM cada nó de texto e atributo (alt, placeholder, aria-label,
 * title), o <title> e a meta description são trocados pela tradução em
 * js/i18n-dict.js, procurando pelo próprio texto em pt-BR. Elementos com
 * marcação no meio da frase usam data-i18n="chave" (DICT.html). Conteúdo
 * injetado depois (mensagens de formulário, feed de notícias) é traduzido
 * por um MutationObserver. Texto sem tradução continua em pt-BR.
 *
 * Carregue no <head>, depois do style.css e do i18n-dict.js e antes do
 * nav.js (que desenha o seletor com HookeI18n.switcherHtml()).
 * O idioma vem de ?lang=en (útil para links/campanhas) ou da última escolha
 * do visitante (localStorage); o padrão é pt-BR.
 */
(function () {
  'use strict';

  var LANGS = [
    { id: 'br', code: 'pt-BR', short: 'PT-BR', label: 'Português (Brasil)' },
    { id: 'pt', code: 'pt-PT', short: 'PT-PT', label: 'Português (Portugal)' },
    { id: 'en', code: 'en', short: 'EN', label: 'English' },
    { id: 'es', code: 'es', short: 'ES', label: 'Español' },
    { id: 'zh', code: 'zh-CN', short: '中文', label: '中文（简体）' },
  ];
  var STORAGE_KEY = 'hooke-lang';
  var ATTRS = ['placeholder', 'alt', 'aria-label', 'title'];
  var SKIP = 'script, style, noscript, textarea, [data-i18n], [data-i18n-skip]';
  var DICT = window.HOOKE_I18N_DICT || { text: {}, html: {} };

  function findLang(value) {
    value = String(value || '').toLowerCase();
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].id === value || LANGS[i].code.toLowerCase() === value) return LANGS[i];
    }
    return null;
  }

  function save(id) {
    try { localStorage.setItem(STORAGE_KEY, id); } catch (e) { /* modo privado */ }
  }

  function readLang() {
    var lang = null;
    try { lang = findLang(new URLSearchParams(location.search).get('lang')); } catch (e) { /* navegador antigo */ }
    if (lang) { save(lang.id); return lang; }
    try { lang = findLang(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* modo privado */ }
    return lang || LANGS[0];
  }

  var current = readLang();
  var isSource = current.id === 'br';
  var root = document.documentElement;
  root.lang = current.code;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ site_language: current.code });

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  // Tradução de um texto em pt-BR; devolve o original quando não há entrada.
  function t(text) {
    if (isSource) return text;
    var entry = DICT.text[norm(text)];
    return (entry && entry[current.id]) || text;
  }

  /* ---------- Aplicação no DOM ---------- */
  // Guardamos o último valor escrito por nós: se a mutação seguinte trouxer o
  // mesmo valor foi a nossa própria escrita; se for outro, o JS da página
  // trocou o texto e ele precisa ser traduzido de novo.
  var textOut = new WeakMap();
  var attrOut = new WeakMap();
  var htmlDone = new WeakSet();
  var untranslated = {};

  function translateText(node) {
    var value = node.nodeValue;
    if (textOut.get(node) === value) return;
    var parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    var key = norm(value);
    if (!key) return;
    var out = value;
    var tr = t(key);
    if (tr !== key) out = value.match(/^\s*/)[0] + tr + value.match(/\s*$/)[0];
    else if (/[A-Za-zÀ-ú]/.test(key)) untranslated[key] = true;
    textOut.set(node, out);
    if (out !== value) node.nodeValue = out;
  }

  function translateAttrs(el) {
    if (el.closest('[data-i18n-skip]')) return;
    var done = attrOut.get(el);
    ATTRS.forEach(function (name) {
      var value = el.getAttribute(name);
      if (!value || (done && done[name] === value)) return;
      var out = t(value);
      if (!done) { done = {}; attrOut.set(el, done); }
      done[name] = out;
      if (out !== value) el.setAttribute(name, out);
    });
  }

  function translateHtml(el) {
    if (htmlDone.has(el)) return;
    htmlDone.add(el);
    var entry = DICT.html[el.getAttribute('data-i18n')];
    if (entry && entry[current.id]) el.innerHTML = entry[current.id];
  }

  function translateTree(node) {
    if (node.nodeType === 3) { translateText(node); return; }
    if (node.nodeType !== 1) return;
    var els = [node].concat(Array.prototype.slice.call(node.querySelectorAll('*')));
    els.forEach(function (el) {
      if (el.hasAttribute('data-i18n')) translateHtml(el);
      translateAttrs(el);
    });
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    var texts = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach(translateText);
  }

  function translateHead() {
    document.title = t(document.title);
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t(meta.getAttribute('content')));
  }

  function start() {
    translateHead();
    translateTree(document.body);
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'characterData') translateText(m.target);
        else if (m.type === 'attributes') translateAttrs(m.target);
        else Array.prototype.forEach.call(m.addedNodes, translateTree);
      });
    }).observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ATTRS,
    });
    root.classList.remove('i18n-pending');
  }

  if (!isSource) {
    // Esconde a página até a troca para não piscar o texto em pt-BR.
    root.classList.add('i18n-pending');
    setTimeout(function () { root.classList.remove('i18n-pending'); }, 2500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  /* ---------- Seletor de idioma ---------- */
  function switcherHtml() {
    var items = LANGS.map(function (l) {
      var on = l.id === current.id;
      return '<li><button type="button" role="menuitemradio" aria-checked="' + on + '" lang="' + l.code + '"'
        + ' data-lang="' + l.id + '"' + (on ? ' class="active"' : '') + '>'
        + l.label + (on ? ' <i class="fa fa-check"></i>' : '') + '</button></li>';
    }).join('');
    return [
      '<div class="m-lang" data-lang-switcher>',
      '  <button class="m-lang-toggle" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Selecionar idioma">',
      '    <i class="fa fa-globe"></i><span data-i18n-skip>' + current.short + '</span><i class="fa fa-chevron-down m-lang-caret"></i>',
      '  </button>',
      '  <ul class="m-lang-menu" role="menu" data-i18n-skip hidden>' + items + '</ul>',
      '</div>',
    ].join('\n');
  }

  function setLang(id) {
    var lang = findLang(id);
    if (!lang || lang.id === current.id) return;
    save(lang.id);
    // Recarrega para todos os scripts da página rodarem já no novo idioma.
    var url = new URL(location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      location.href = url.toString();
    } else {
      location.reload();
    }
  }

  function closeMenus(except) {
    document.querySelectorAll('[data-lang-switcher]').forEach(function (sw) {
      if (sw === except) return;
      sw.querySelector('.m-lang-menu').hidden = true;
      sw.querySelector('.m-lang-toggle').setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', function (e) {
    var option = e.target.closest('[data-lang]');
    if (option) { setLang(option.getAttribute('data-lang')); return; }
    var toggle = e.target.closest('.m-lang-toggle');
    if (!toggle) { closeMenus(null); return; }
    var sw = toggle.closest('[data-lang-switcher]');
    var menu = sw.querySelector('.m-lang-menu');
    closeMenus(sw);
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) menu.querySelector('.active').focus();
  });

  document.addEventListener('keydown', function (e) {
    var menu = e.target.closest && e.target.closest('.m-lang-menu');
    if (e.key === 'Escape') {
      var sw = e.target.closest && e.target.closest('[data-lang-switcher]');
      closeMenus(null);
      if (sw) sw.querySelector('.m-lang-toggle').focus();
    } else if (menu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      var opts = Array.prototype.slice.call(menu.querySelectorAll('button'));
      var i = opts.indexOf(document.activeElement) + (e.key === 'ArrowDown' ? 1 : -1);
      opts[(i + opts.length) % opts.length].focus();
    }
  });

  /* ---------- API usada por nav.js, main.js e o feed de notícias ---------- */
  window.HookeI18n = {
    languages: LANGS,
    lang: current.code,
    t: t,
    // Notícias do feed: usa a versão traduzida (item.translations[código],
    // gerada pelo news-pipeline ao aprovar) quando existir; senão, a original.
    localize: function (item) {
      var tr = item && item.translations && item.translations[current.code];
      // sectorPt guarda o nome original da editoria (cor e filtros não mudam com o idioma).
      return tr ? Object.assign({}, item, tr, { sector: tr.sector || item.sector, sectorPt: item.sector }) : item;
    },
    set: setLang,
    switcherHtml: switcherHtml,
    // Diagnóstico: textos da página atual sem tradução no idioma ativo.
    // (nomes próprios, endereços e e-mails aparecem aqui e podem ficar assim).
    missing: function () { return Object.keys(untranslated); },
  };
})();
