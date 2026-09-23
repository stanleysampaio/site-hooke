(function ($) {
    "use strict";

    // Spinner
    var spinner = function () {
        setTimeout(function () {
            if ($('#spinner').length > 0) {
                $('#spinner').removeClass('show');
            }
        }, 1);
    };
    spinner();
    
    
    // Initiate the wowjs
    new WOW().init();


    // Sticky Navbar
    $(window).scroll(function () {
        if ($(this).scrollTop() > 300) {
            $('.sticky-top').addClass('shadow-sm').css('top', '0px');
        } else {
            $('.sticky-top').removeClass('shadow-sm').css('top', '-100px');
        }
    });
    
    
    // Back to top button
    $(window).scroll(function () {
        if ($(this).scrollTop() > 300) {
            $('.back-to-top').fadeIn('slow');
        } else {
            $('.back-to-top').fadeOut('slow');
        }
    });
    $('.back-to-top').click(function () {
        $('html, body').animate({scrollTop: 0}, 1500, 'easeInOutExpo');
        return false;
    });


    // Facts counter
    $('[data-toggle="counter-up"]').counterUp({
        delay: 10,
        time: 2000
    });


    // Date and time picker
    $('.date').datetimepicker({
        format: 'L'
    });
    $('.time').datetimepicker({
        format: 'LT'
    });


    // Header carousel
    $(".header-carousel").owlCarousel({
        autoplay: true,
        animateOut: 'fadeOutLeft',
        items: 1,
        dots: true,
        loop: true,
        nav : true,
        navText : [
            '<i class="bi bi-chevron-left"></i>',
            '<i class="bi bi-chevron-right"></i>'
        ]
    });

    // Alterar background da div externa conforme o item do carrossel ativo
    var owl = $('.header-carousel');
    owl.on('changed.owl.carousel', function(event) {
        // Pega o índice do item ativo
        var currentItemIndex = event.item.index;
        
        // Seleciona o item ativo e pega o valor do atributo 'data-bg'
        var currentItem = $(event.target).find('.owl-carousel-item').eq(currentItemIndex);
        var backgroundUrl = currentItem.data('bg');

        // Troca o background da div externa
        $('#carousel-wrapper').css('background-image', backgroundUrl);
    });

    // Dispara o evento ao carregar a página para ajustar o background inicial
    owl.trigger('changed.owl.carousel', { item: { index: 1 } });


    // Testimonials carousel
    $(".testimonial-carousel").owlCarousel({
        autoplay: true,
        smartSpeed: 1000,
        center: true,
        dots: false,
        loop: true,
        nav : true,
        navText : [
            '<i class="bi bi-arrow-left"></i>',
            '<i class="bi bi-arrow-right"></i>'
        ],
        responsive: {
            0:{
                items:1
            },
            768:{
                items:2
            }
        }
    });

     // Show/hide date and time fields based on subject selection
     $(document).ready(function () {
        const assuntoSelect = $('#assunto');
        const dateField = $('#date-field');
        const timeField = $('#time-field');

        assuntoSelect.on('change', function () {
            if (assuntoSelect.val() === 'Agendamento') {
                dateField.show();
                timeField.show();
            } else {
                dateField.hide();
                timeField.hide();
            }
        });
    });



    // Formulário de contato: site 100% estático, sem backend — o envio abre
    // o cliente de e-mail do visitante com os dados preenchidos, endereçado
    // a comercial@hookengenharia.com.br.
    document.addEventListener('DOMContentLoaded', function () {
        var contactForm = document.getElementById('contactForm');
        if (contactForm) {
            contactForm.addEventListener('submit', function (e) {
                e.preventDefault();
                var name = document.getElementById('name').value.trim();
                var email = document.getElementById('email').value.trim();
                var subjectField = document.getElementById('subject').value.trim();
                var message = document.getElementById('message').value.trim();

                var subject = 'Contato pelo site — ' + (subjectField || 'Hooke');
                var body = [
                    'Nome: ' + name,
                    'E-mail: ' + email,
                    'Assunto: ' + (subjectField || 'não informado'),
                    '',
                    'Mensagem:',
                    message
                ].join('\n');

                window.location.href = 'mailto:comercial@hookengenharia.com.br'
                    + '?subject=' + encodeURIComponent(subject)
                    + '&body=' + encodeURIComponent(body);
            });
        }
    });

    document.addEventListener('DOMContentLoaded', function () {
    const video = document.querySelector('.hero-video');
    const btn = document.getElementById('hero-sound-toggle');
    const playBtn = document.getElementById('hero-play-button');

    if (!video) return;

    let userRequestedPlay = false;

    // Garantir que não inicia tocando (inclui retorno via BFCache / voltar do navegador)
    const forcePaused = () => {
        userRequestedPlay = false;

        // Defesa extra caso alguma versão antiga tenha `autoplay` no HTML
        video.autoplay = false;
        video.removeAttribute('autoplay');

        video.pause();
        try { video.currentTime = 0; } catch (e) {}

        if (playBtn) playBtn.style.display = '';
    };

    forcePaused();
    window.addEventListener('pageshow', function (event) {
        // Evita interromper o play no carregamento normal.
        // Só força pausa quando a página volta do BFCache (voltar/avançar do navegador).
        if (event && event.persisted) {
            forcePaused();
        }
    });

    // Não iniciar autoplay: manter mudo por padrão
    video.muted = true;
    video.volume = 1;

    // Atualiza estado do botão de som
    if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        btn.addEventListener('click', function () {
            if (video.muted) {
                video.muted = false;
                btn.classList.add('active');
                btn.innerHTML = '<i class="fas fa-volume-up"></i>';
            } else {
                video.muted = true;
                btn.classList.remove('active');
                btn.innerHTML = '<i class="fas fa-volume-mute"></i>';
            }
        });
    }

    // Clique no wrapper do vídeo (exceto nos botões) → toggle play/pause
    const videoWrapper = video.closest('.hero-video-wrapper');
    if (videoWrapper) {
        videoWrapper.addEventListener('click', function (e) {
            if (e.target.closest('#hero-play-button') || e.target.closest('#hero-sound-toggle')) return;

            if (video.paused) {
                userRequestedPlay = true;
                video.play().catch(() => { userRequestedPlay = false; });
            } else {
                video.pause();
            }
        });
    }

    // Play button overlay: inicia o vídeo quando clicado
    if (playBtn) {
        playBtn.addEventListener('click', function () {
            userRequestedPlay = true;

            const p = video.play();
            if (p !== undefined) {
                p.then(() => {
                    playBtn.style.display = 'none';
                }).catch(() => {
                    userRequestedPlay = false;
                    playBtn.style.display = '';
                });
            } else {
                playBtn.style.display = 'none';
            }
        });

        // Se algo tentar dar autoplay sem clique do usuário, pausar imediatamente
        video.addEventListener('play', function () {
            if (!userRequestedPlay) {
                video.pause();
                return;
            }
            playBtn.style.display = 'none';
        });

        // Quando pausa/termina, mostrar botão novamente
        video.addEventListener('pause', function () {
            playBtn.style.display = '';
        });
        video.addEventListener('ended', function () {
            userRequestedPlay = false;
            playBtn.style.display = '';
        });
    }
});


    
})(jQuery);
  