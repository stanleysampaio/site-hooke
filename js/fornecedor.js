/**
 * fornecedor.js — envio do formulário de Cadastro de Fornecedores para o ERP,
 * que guarda o cadastro, avisa a Hooke e confirma por e-mail ao fornecedor.
 *
 * Fluxo em até 2 etapas, como o Trabalhe Conosco (js/curriculo.js):
 *   1. POST /fornecedores-cadastro/arquivo (multipart, campo "file"; só se houver PDF) -> { filename }
 *   2. POST /fornecedores-cadastro         (JSON com os dados + filename)
 */
(function () {
  'use strict';

  var API_BASE = 'https://app.hookengenharia.com.br/api/fornecedores-cadastro';
  var MAX_BYTES = 10 * 1024 * 1024;

  var i18n = window.HookeI18n || { t: function (s) { return s; } };
  var form = document.getElementById('mSupplierForm');
  if (!form) return;

  var statusEl = document.getElementById('supStatus');
  var submitBtn = document.getElementById('supSubmit');
  var successEl = document.getElementById('supSuccess');
  var submitHtml = submitBtn.innerHTML;

  function showStatus(message) {
    statusEl.textContent = i18n.t(message);
    statusEl.className = 'm-form-status is-error';
    statusEl.hidden = false;
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? '<i class="fa fa-spinner fa-spin"></i> ' + i18n.t('Enviando...')
      : submitHtml;
  }

  function readError(res) {
    return res.json().then(
      function (body) {
        if (body && body.error && !body.validation) return body.error;
        if (res.status === 429 && body && body.message) return body.message;
        return 'Não foi possível enviar seus dados. Confira os campos e tente novamente.';
      },
      function () { return 'Não foi possível enviar seus dados. Tente novamente mais tarde.'; }
    );
  }

  function failOnError(res) {
    if (res.ok) return res;
    return readError(res).then(function (msg) { throw new Error(msg); });
  }

  function validate() {
    var data = new FormData(form);
    var required = ['razao_social', 'cnpj', 'responsavel', 'email', 'telefone', 'cidade_uf', 'produtos_servicos'];
    for (var i = 0; i < required.length; i++) {
      var el = form.elements[required[i]];
      if (!String(data.get(required[i]) || '').trim() || !el.checkValidity()) {
        el.focus();
        return required[i] === 'email' ? 'Informe um e-mail válido.' : 'Preencha todos os campos obrigatórios.';
      }
    }
    if (String(data.get('cnpj')).replace(/\D/g, '').length !== 14) {
      form.elements.cnpj.focus();
      return 'Informe um CNPJ com 14 dígitos.';
    }
    var file = form.elements.file.files[0];
    if (file) {
      if (!/\.pdf$/i.test(file.name) || (file.type && file.type !== 'application/pdf')) {
        return 'A apresentação deve estar em formato PDF.';
      }
      if (file.size > MAX_BYTES) return 'A apresentação deve ter no máximo 10 MB.';
    }
    if (!form.elements.consentimento.checked) {
      return 'É necessário autorizar o uso dos dados para enviar o cadastro.';
    }
    return null;
  }

  function uploadFile() {
    var file = form.elements.file.files[0];
    if (!file) return Promise.resolve(null);
    var upload = new FormData();
    upload.append('file', file);
    return fetch(API_BASE + '/arquivo', { method: 'POST', body: upload })
      .then(failOnError)
      .then(function (res) { return res.json(); })
      .then(function (body) { return body.filename; });
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
    setLoading(true);

    uploadFile()
      .then(function (filename) {
        return fetch(API_BASE, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razao_social: String(data.get('razao_social')).trim(),
            cnpj: String(data.get('cnpj')).replace(/\D/g, ''),
            responsavel: String(data.get('responsavel')).trim(),
            email: String(data.get('email')).trim(),
            telefone: String(data.get('telefone')).trim(),
            cidade_uf: String(data.get('cidade_uf')).trim(),
            produtos_servicos: String(data.get('produtos_servicos')).trim(),
            filename: filename,
            consentimento_lgpd: true,
            consentimento_em: new Date().toISOString(),
          }),
        });
      })
      .then(failOnError)
      .then(function () {
        form.hidden = true;
        successEl.hidden = false;
        successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (window.dataLayer) window.dataLayer.push({ event: 'fornecedor_cadastrado' });
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
