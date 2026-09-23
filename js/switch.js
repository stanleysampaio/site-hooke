/**
 * switch.js — Botão flutuante para alternar entre a versão clássica (raiz)
 * e a versão moderna (/moderno/) do site, mantendo a página equivalente.
 * Incluído em ambas as árvores (raiz e /moderno/js/switch.js aponta pra cá
 * via caminho relativo, ou é a mesma cópia — ver comentário no fim).
 */
(function () {
  'use strict';

  var path = window.location.pathname.replace(/\\/g, '/');
  var segments = path.split('/').filter(Boolean);
  var file = segments[segments.length - 1] || 'index.html';
  if (!/\.html?$/i.test(file)) { file = 'index.html'; }

  var inModerno = segments.indexOf('moderno') !== -1;
  var targetHref = inModerno ? ('../' + file) : ('moderno/' + file);
  var label = inModerno ? 'Versão clássica' : 'Versão moderna';
  var icon = inModerno ? 'fa-arrow-left' : 'fa-wand-magic-sparkles';

  try {
    localStorage.setItem('hooke-version', inModerno ? 'moderno' : 'classica');
  } catch (e) { /* localStorage indisponível (modo privado) — segue sem persistir */ }

  var a = document.createElement('a');
  a.href = targetHref;
  a.className = inModerno ? 'm-version-switch' : 'btn2 version-switch-classic';
  a.setAttribute('aria-label', 'Alternar para ' + label);
  a.innerHTML = '<i class="fa ' + icon + '"></i> <span class="m-switch-label">' + label + '</span>';

  if (!inModerno) {
    a.style.position = 'fixed';
    a.style.left = '24px';
    a.style.bottom = '30px';
    a.style.zIndex = '950';
    a.style.borderRadius = '999px';
    a.style.padding = '13px 20px';
    a.style.display = 'inline-flex';
    a.style.alignItems = 'center';
    a.style.gap = '8px';
    a.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
    a.style.fontWeight = '700';
  }

  document.body.appendChild(a);
})();
