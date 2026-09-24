/**
 * main.js (versão moderna) — sem jQuery/WOW/Owl. Reveal-on-scroll nativo,
 * botão voltar ao topo, botão WhatsApp flutuante, vídeo do hero e slider
 * de notícias em vanilla JS.
 */
(function () {
  'use strict';

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll('.m-reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- Floating utilities: WhatsApp + back-to-top ---------- */
  var wa = document.createElement('a');
  wa.href = 'https://wa.me/5571999524838?text=' + encodeURIComponent('Olá! Gostaria de solicitar um orçamento com a Hooke.');
  wa.target = '_blank';
  wa.rel = 'noopener noreferrer';
  wa.className = 'm-float-btn m-whatsapp';
  wa.setAttribute('aria-label', 'Falar no WhatsApp');
  wa.innerHTML = '<i class="fab fa-whatsapp"></i>';
  document.body.appendChild(wa);

  var top = document.createElement('button');
  top.type = 'button';
  top.className = 'm-float-btn m-back-to-top';
  top.setAttribute('aria-label', 'Voltar ao topo');
  top.innerHTML = '<i class="bi bi-arrow-up"></i>';
  top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.body.appendChild(top);

  window.addEventListener('scroll', function () {
    top.classList.toggle('show', window.scrollY > 400);
  });

  /* ---------- Hero video (play/pause/sound) ---------- */
  var video = document.querySelector('.m-hero-video');
  var playBtn = document.getElementById('mHeroPlay');
  var soundBtn = document.getElementById('mHeroSound');

  if (video) {
    video.muted = true;
    var userPlayed = false;

    if (playBtn) {
      playBtn.addEventListener('click', function () {
        userPlayed = true;
        var p = video.play();
        if (p !== undefined) {
          p.then(function () { playBtn.style.display = 'none'; }).catch(function () { userPlayed = false; });
        } else {
          playBtn.style.display = 'none';
        }
      });
    }

    var wrap = video.closest('.m-hero-video-wrap');
    if (wrap) {
      wrap.addEventListener('click', function (e) {
        if (e.target.closest('#mHeroPlay') || e.target.closest('#mHeroSound')) return;
        if (video.paused) { userPlayed = true; video.play().catch(function () { userPlayed = false; }); }
        else { video.pause(); }
      });
    }

    video.addEventListener('pause', function () { if (playBtn) playBtn.style.display = ''; });
    video.addEventListener('play', function () { if (playBtn) playBtn.style.display = 'none'; });

    if (soundBtn) {
      soundBtn.addEventListener('click', function () {
        video.muted = !video.muted;
        soundBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
      });
    }
  }

  /* ---------- Mini news slider (hero panel) ---------- */
  var slides = document.querySelectorAll('.m-news-slide');
  var dotsWrap = document.getElementById('mNewsDots');
  if (slides.length) {
    var current = 0;
    var dots = [];

    if (dotsWrap) {
      slides.forEach(function (_, i) {
        var d = document.createElement('button');
        d.type = 'button';
        d.className = i === 0 ? 'active' : '';
        d.setAttribute('aria-label', 'Notícia ' + (i + 1));
        d.addEventListener('click', function () { show(i); restart(); });
        dotsWrap.appendChild(d);
        dots.push(d);
      });
    }

    function show(i) {
      slides[current].classList.remove('active');
      if (dots[current]) dots[current].classList.remove('active');
      current = i;
      slides[current].classList.add('active');
      if (dots[current]) dots[current].classList.add('active');
    }

    var timer;
    function restart() {
      clearInterval(timer);
      timer = setInterval(function () { show((current + 1) % slides.length); }, 5500);
    }
    restart();
  }

  /* ---------- Footer year ---------- */
  var yearEl = document.getElementById('mYear');
  if (yearEl) { yearEl.textContent = new Date().getFullYear(); }

  /* ---------- Formulário de contato/orçamento (envia por e-mail) ---------- */
  // Site 100% estático, sem backend: o envio abre o cliente de e-mail do
  // visitante com os dados preenchidos, endereçado a comercial@hookengenharia.com.br.
  var contactForm = document.getElementById('mContactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = contactForm.elements;
      var subject = 'Solicitação de orçamento — ' + (f['sector'].value || 'Site Hooke');
      var body = [
        'Nome: ' + f['name'].value.trim(),
        'E-mail: ' + f['email'].value.trim(),
        'Telefone/WhatsApp: ' + (f['phone'].value.trim() || 'não informado'),
        'Setor de interesse: ' + f['sector'].value,
        '',
        'Mensagem:',
        f['message'].value.trim(),
      ].join('\n');

      window.location.href = 'mailto:comercial@hookengenharia.com.br'
        + '?subject=' + encodeURIComponent(subject)
        + '&body=' + encodeURIComponent(body);
    });
  }
})();
