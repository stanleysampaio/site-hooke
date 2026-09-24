/**
 * nav.js (versão moderna) — injeta topstrip, navbar fixa e offcanvas mobile.
 * Mesma fonte de links que a versão clássica (js/nav.js) — se o menu mudar,
 * atualize os dois arquivos.
 */
(function () {
  'use strict';

  var page = (window.location.pathname.split('/').pop() || 'index.html').replace(/[?#].*$/, '');

  var links = [
    { href: 'index.html', label: 'Início' },
    { href: 'about.html', label: 'A Hooke' },
    { href: 'service.html', label: 'Soluções' },
    { href: 'location.html', label: 'Onde Atuamos' },
    { href: 'contact.html', label: 'Contato' },
  ];

  function navLink(l) {
    var cls = page === l.href ? ' class="active"' : '';
    return '<a href="' + l.href + '"' + cls + '>' + l.label + '</a>';
  }

  var desktopLinks = links.map(navLink).join('');
  var mobileLinks = links.map(navLink).join('');

  var html = [
    '<div class="m-topstrip">',
    '  <div class="container">',
    '    <div><i class="fa fa-map-marker-alt"></i>R. Monte Alto, 59 - Dias d\'Ávila - BA, 42850-000</div>',
    '    <div><a href="tel:+5571999524838"><i class="fa fa-phone-alt"></i>71 99952-4838</a>',
    '      &nbsp;·&nbsp;',
    '      <a href="mailto:comercial@hookengenharia.com.br"><i class="fa fa-envelope"></i>comercial@hookengenharia.com.br</a>',
    '    </div>',
    '  </div>',
    '</div>',

    '<header class="m-navbar" id="mNavbar">',
    '  <div class="m-nav-inner">',
    '    <a class="m-brand" href="index.html">',
    '      <img src="img/logo_amarela.png" alt="Hooke" />',
    '    </a>',
    '    <nav class="m-nav-links">' + desktopLinks + '</nav>',
    '    <div class="m-nav-actions">',
    '      <a class="m-nav-phone" href="tel:+5571999524838"><i class="fa fa-phone-alt"></i><span>71 99952-4838</span></a>',
    '      <a class="m-btn m-btn-yellow m-btn-sm d-none d-lg-inline-flex" href="contact.html">Orçamento</a>',
    '      <button class="m-nav-toggle" type="button" id="mNavToggle" aria-label="Abrir menu"><i class="fa fa-bars"></i></button>',
    '    </div>',
    '  </div>',
    '</header>',

    '<div class="m-offcanvas" id="mOffcanvas">',
    '  <div class="m-offcanvas-backdrop" data-close></div>',
    '  <div class="m-offcanvas-panel">',
    '    <button class="m-offcanvas-close" type="button" data-close aria-label="Fechar menu"><i class="fa fa-times"></i></button>',
    '    ' + mobileLinks,
    '    <a class="m-btn m-btn-yellow m-btn-block mt-2" href="contact.html">Solicitar Orçamento</a>',
    '  </div>',
    '</div>',
  ].join('\n');

  var mount = document.getElementById('site-nav');
  if (mount) { mount.outerHTML = html; }

  var navbar = document.getElementById('mNavbar');
  window.addEventListener('scroll', function () {
    if (!navbar) return;
    navbar.classList.toggle('is-scrolled', window.scrollY > 10);
  });

  var offcanvas = document.getElementById('mOffcanvas');
  var toggle = document.getElementById('mNavToggle');
  if (toggle && offcanvas) {
    toggle.addEventListener('click', function () { offcanvas.classList.add('open'); });
    offcanvas.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { offcanvas.classList.remove('open'); });
    });
    offcanvas.querySelectorAll('a').forEach(function (el) {
      el.addEventListener('click', function () { offcanvas.classList.remove('open'); });
    });
  }
})();
