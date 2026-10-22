/**
 * curriculo.js — envio do formulário "Trabalhe Conosco" para o módulo de
 * recrutamento do ERP (os currículos aparecem em Pessoas > Recrutamentos).
 *
 * Fluxo em 2 etapas, igual ao formulário público do próprio ERP:
 *   1. POST /recrutamento/recruitmentFile  (multipart, campo "file") -> { filename }
 *   2. POST /recrutamento                   (JSON com os dados + filename)
 */
(function () {
  'use strict';

  var API_BASE = 'https://app.hookengenharia.com.br/api';
  var MAX_BYTES = 3331276; // mesmo limite do multer no ERP (~3 MB)

  var form = document.getElementById('mCvForm');
  if (!form) return;

  var statusEl = document.getElementById('cvStatus');
  var submitBtn = document.getElementById('cvSubmit');
  var successEl = document.getElementById('cvSuccess');
  var submitHtml = submitBtn.innerHTML;

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'm-form-status is-' + (type || 'error');
    statusEl.hidden = false;
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? '<i class="fa fa-spinner fa-spin"></i> Enviando...'
      : submitHtml;
  }

  function readError(res) {
    return res.json().then(
      function (body) {
        // Upload devolve { error }, rate limit devolve { message } em pt-BR;
        // erros de validação do celebrate vêm em inglês, então usamos texto genérico.
        // (o celebrate responde { error: "Bad Request", validation } — não serve para o visitante).
        if (body && body.error && !body.validation) return body.error;
        if (res.status === 429 && body && body.message) return body.message;
        return 'Não foi possível enviar seus dados. Confira os campos e tente novamente.';
      },
      function () { return 'Não foi possível enviar seus dados. Tente novamente mais tarde.'; }
    );
  }

  function validate() {
    var data = new FormData(form);
    var funcoes = data.getAll('funcoes');
    var file = form.elements.file.files[0];

    var required = ['nome_completo', 'email', 'telefone', 'local_de_residencia'];
    for (var i = 0; i < required.length; i++) {
      var el = form.elements[required[i]];
      if (!String(data.get(required[i]) || '').trim() || !el.checkValidity()) {
        el.focus();
        return required[i] === 'email'
          ? 'Informe um e-mail válido.'
          : 'Preencha todos os campos obrigatórios.';
      }
    }
    if (!funcoes.length) return 'Marque ao menos uma função de interesse.';
    if (!file) return 'Anexe seu currículo em PDF.';
    if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
      return 'O currículo deve estar em formato PDF.';
    }
    if (file.size > MAX_BYTES) return 'O currículo deve ter no máximo 3 MB.';
    if (!form.elements.consentimento.checked) {
      return 'É necessário autorizar o uso dos dados para enviar o currículo.';
    }
    return null;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    statusEl.hidden = true;

    // Honeypot preenchido: finge sucesso sem enviar nada.
    if (form.elements.site.value) {
      form.hidden = true;
      successEl.hidden = false;
      return;
    }

    var error = validate();
    if (error) { showStatus(error); return; }

    var data = new FormData(form);
    var upload = new FormData();
    upload.append('file', form.elements.file.files[0]);

    setLoading(true);

    fetch(API_BASE + '/recrutamento/recruitmentFile', { method: 'POST', body: upload })
      .then(function (res) {
        if (!res.ok) return readError(res).then(function (msg) { throw new Error(msg); });
        return res.json();
      })
      .then(function (file) {
        return fetch(API_BASE + '/recrutamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nome_completo: String(data.get('nome_completo')).trim(),
            email: String(data.get('email')).trim(),
            telefone: String(data.get('telefone')).trim(),
            local_de_residencia: data.get('local_de_residencia'),
            funcoes: data.getAll('funcoes'),
            filename: file.filename,
          }),
        });
      })
      .then(function (res) {
        if (!res.ok) return readError(res).then(function (msg) { throw new Error(msg); });
        form.hidden = true;
        successEl.hidden = false;
        successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (window.dataLayer) window.dataLayer.push({ event: 'curriculo_enviado' });
      })
      .catch(function (err) {
        var msg = err && err.message && !/fetch|network/i.test(err.message)
          ? err.message
          : 'Falha de conexão. Verifique sua internet e tente novamente.';
        showStatus(msg);
      })
      .then(function () { setLoading(false); });
  });
})();
