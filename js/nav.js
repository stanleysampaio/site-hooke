/**
 * nav.js — Componente de navegação global do site Hooke.
 * Injeta mobile header, desktop header e offcanvas em todas as páginas.
 * Marca automaticamente o link ativo com base na URL atual.
 */
(function () {
  'use strict';

  var page = (window.location.pathname.split('/').pop() || 'index.html').replace(/[?#].*$/, '');

  var links = [
    { href: 'index.html',    label: 'INÍCIO' },
    { href: 'about.html',    label: 'A HOOKE' },
    { href: 'service.html',  label: 'SOLUÇÕES' },
    { href: 'location.html', label: 'ONDE ATUAMOS' },
    { href: 'contact.html',  label: 'CONTATO' },
  ];

  function li(href, label) {
    var cls = 'nav-link' + (page === href ? ' active' : '');
    return '<li class="nav-item"><a class="' + cls + '" href="' + href + '">' + label + '</a></li>';
  }

  var desktopLinks = links.map(function (l) { return li(l.href, l.label); }).join('\n              ');

  var sideLinks = links.map(function (l) { return li(l.href, l.label); }).join('\n      ');

  var html = [
    '<!-- Mobile Header -->',
    '<div class="d-flex d-lg-none justify-content-between align-items-center bg-primary mobile-header px-3">',
    '  <a class="navbar-brand d-flex align-items-center" href="index.html">',
    '    <img src="./img/logo_amarela.png" alt="Hooke" class="logo-img" />',
    '  </a>',
    '  <div class="d-flex align-items-center gap-2">',
    '    <a href="tel:+5571999524838" class="btn btn-warning btn-phone text-dark" aria-label="Ligar">',
    '      <i class="fa fa-phone"></i>',
    '    </a>',
    '    <a class="btn btn-sm-square rounded-circle btn-color"',
    '      href="https://www.linkedin.com/company/hooke-solu%C3%A7%C3%B5es-de-engenharia/"',
    '      target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">',
    '      <i class="fab fa-linkedin-in"></i>',
    '    </a>',
    '    <button class="border-0 bg-transparent p-1" type="button"',
    '      data-bs-toggle="offcanvas" data-bs-target="#mobileOffcanvas"',
    '      aria-controls="mobileOffcanvas" aria-label="Abrir menu">',
    '      <i class="fa fa-bars" style="color:white;font-size:22px"></i>',
    '    </button>',
    '  </div>',
    '</div>',
    '',
    '<!-- Desktop Header -->',
    '<div class="container-fluid bg-primary d-none d-lg-block">',
    '  <div class="row align-items-center">',
    '    <div class="col-lg-2">',
    '      <a class="navbar-brand d-flex align-items-center" style="padding-left:150px" href="index.html">',
    '        <img src="./img/logo_amarela.png" alt="Hooke" class="logo-img" />',
    '      </a>',
    '    </div>',
    '    <div class="col-lg-8 mx-auto" style="padding-top:20px">',
    '      <div class="container-fluid topbar bg-primary">',
    '        <div class="row align-items-center">',
    '          <div class="col-lg-12 px-5 text-end">',
    '            <div class="topbar-nav" style="margin-right:25px">',
    '              <div class="h-100 d-inline-flex align-items-center py-3 me-4">',
    '                <small class="fa fa-phone-alt text-yellow me-2"></small>',
    '                <small>71 99952-4838</small>',
    '              </div>',
    '              <div class="h-100 d-inline-flex align-items-center py-3 me-4">',
    '                <small class="fa fa-map-marker-alt text-yellow me-2"></small>',
    "                <small>R. Monte Alto, 59 - Dias d'Ávila - BA, 42850-000</small>",
    '              </div>',
    '              <div class="h-100 d-inline-flex align-items-center">',
    '                <a class="btn btn-sm-square rounded-circle btn-color me-1"',
    '                  href="https://www.linkedin.com/company/hooke-solu%C3%A7%C3%B5es-de-engenharia/"',
    '                  target="_blank" rel="noopener noreferrer">',
    '                  <i class="fab fa-linkedin-in"></i>',
    '                </a>',
    '              </div>',
    '            </div>',
    '          </div>',
    '        </div>',
    '      </div>',
    '      <nav class="navbar navbar-expand-lg sticky-top bg-primary">',
    '        <div class="container">',
    '          <div class="collapse navbar-collapse justify-content-end" id="navbarCollapse">',
    '            <ul class="navbar-nav" style="margin-right:25px">',
    '              ' + desktopLinks,
    '            </ul>',
    '            <a href="#" class="btn btn-primary rounded-10 py-3 px-lg-5 d-none d-lg-block"',
    '              style="max-height:55px;margin-top:-15px;max-width:200px;color:#202425">',
    '              <i class="fa fa-user" style="margin-left:-10px"></i> <b>LOGIN</b>',
    '            </a>',
    '          </div>',
    '        </div>',
    '      </nav>',
    '    </div>',
    '  </div>',
    '</div>',
    '',
    '<!-- Offcanvas Mobile Menu -->',
    '<div class="offcanvas offcanvas-start" tabindex="-1" id="mobileOffcanvas" aria-labelledby="mobileOffcanvasLabel">',
    '  <div class="offcanvas-header bg-primary text-white">',
    '    <h5 class="offcanvas-title" id="mobileOffcanvasLabel">Menu</h5>',
    '    <button type="button" class="btn-close btn-close-white" data-bs-dismiss="offcanvas" aria-label="Fechar"></button>',
    '  </div>',
    '  <div class="offcanvas-body">',
    '    <ul class="navbar-nav">',
    '      ' + sideLinks,
    '    </ul>',
    '    <a href="contact.html" class="btn btn-primary rounded-10 py-3 w-100 mt-3 text-dark">',
    '      Falar com a Hooke',
    '    </a>',
    '  </div>',
    '</div>',
  ].join('\n');

  var el = document.getElementById('site-nav');
  if (el) { el.outerHTML = html; }
})();
