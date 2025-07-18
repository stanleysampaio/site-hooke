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

    
})(jQuery);
