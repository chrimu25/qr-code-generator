/**
 * app.js — state, UI wiring, QR rendering, scannability warnings,
 * export (PNG/SVG/PDF/clipboard) and localStorage templates.
 *
 * Architecture:
 *   state.type           currently selected QR type id
 *   state.data[typeId]   form values per type (kept when switching tabs)
 *   state.design         every visual option (colors, logo, frame, size…)
 *   render()             validate -> build payload -> rebuild QRCodeStyling
 *
 * The QRCodeStyling instance is recreated on every render instead of using
 * update(): update() deep-merges options, so "unset" values (e.g. a removed
 * logo or gradient) would silently stick around.
 */
(function () {
  'use strict';

  var Payloads = window.Payloads;
  var Presets = window.Presets;

  /* ================= state ================= */

  var DESIGN_DEFAULTS = {
    fg: '#111827',
    bg: '#ffffff',
    gradientOn: false,
    gradientType: 'linear',
    fg2: '#4f46e5',
    gradientRotation: 0,
    dotStyle: 'square',
    eyeFrameStyle: 'square',
    eyeFrameColor: '#111827',
    eyeDotStyle: 'square',
    eyeDotColor: '#111827',
    logo: null,            // data URL
    logoName: '',
    logoIsPreset: false,
    presetDismissed: false,
    logoSize: 22,          // % of QR width
    logoMargin: 6,         // px around the logo
    hideDots: true,
    frameOn: false,
    frameText: 'Scan me',
    frameColor: '#111827',
    frameTextColor: '#ffffff',
    size: 600,
    margin: 16,
    ecLevel: 'M'           // user choice; forced to H while a logo is set
  };

  // Which design keys each section's Reset button restores.
  var RESET_GROUPS = {
    colors: ['fg', 'bg', 'gradientOn', 'gradientType', 'fg2', 'gradientRotation'],
    style:  ['dotStyle', 'eyeFrameStyle', 'eyeFrameColor', 'eyeDotStyle', 'eyeDotColor'],
    logo:   ['logo', 'logoName', 'logoIsPreset', 'presetDismissed', 'logoSize', 'logoMargin', 'hideDots'],
    frame:  ['frameOn', 'frameText', 'frameColor', 'frameTextColor'],
    size:   ['size', 'margin', 'ecLevel']
  };

  var state = {
    type: 'url',
    data: {},
    design: JSON.parse(JSON.stringify(DESIGN_DEFAULTS))
  };

  var touched = {};          // fieldKey -> true once the user has left the field
  var showAllErrors = false; // set when an export is attempted with an invalid form
  var qr = null;             // current QRCodeStyling instance
  var lastValidPayload = ''; // for export guard + meta display
  var renderTimer = null;

  /* ================= tiny DOM helpers ================= */

  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }
  function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  /* ================= color math (WCAG) ================= */

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return { r: 0, g: 0, b: 0 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function luminance(hex) {
    var c = hexToRgb(hex);
    var f = function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrastRatio(a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* ================= type tabs ================= */

  // Minimal stroke icons (Feather-style) for tabs and form headers — crisper
  // than emoji and they inherit the current text color.
  var TYPE_ICONS = {
    url: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    vcard: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>',
    linkedin: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    whatsapp: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
    email: '<rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22,6 12,13 2,6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    text: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
    social: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'
  };

  var TYPE_DESC = {
    url: 'Opens a website when scanned.',
    vcard: 'Saves your contact details to the phone (vCard 3.0).',
    instagram: 'Opens your Instagram profile.',
    linkedin: 'Opens a LinkedIn profile or company page.',
    whatsapp: 'Starts a WhatsApp chat with a prefilled message.',
    email: 'Opens a prefilled email composer.',
    phone: 'Starts a call or a prefilled SMS.',
    wifi: 'Connects the phone to a Wi-Fi network.',
    text: 'Shows a piece of plain text.',
    social: 'Opens a Facebook, X, TikTok or YouTube profile.'
  };

  function typeIcon(id, cls) {
    return '<svg class="' + (cls || 'w-4 h-4') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (TYPE_ICONS[id] || '') + '</svg>';
  }

  function renderTabs() {
    var wrap = $('typeTabs');
    wrap.innerHTML = '';
    Payloads.TYPES.forEach(function (t) {
      var selected = t.id === state.type;
      var btn = el('button', {
        class: 'tab',
        role: 'tab',
        id: 'tab-' + t.id,
        'aria-selected': String(selected),
        'aria-controls': 'typeForm',
        tabindex: selected ? '0' : '-1',
        type: 'button'
      });
      btn.innerHTML = typeIcon(t.id) + '<span>' + t.label + '</span>';
      btn.addEventListener('click', function () { selectType(t.id); });
      wrap.appendChild(btn);
    });
    // Roving tabindex keyboard support for the tablist.
    wrap.onkeydown = function (e) {
      var ids = Payloads.TYPES.map(function (t) { return t.id; });
      var i = ids.indexOf(state.type);
      var next = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = ids[(i + 1) % ids.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = ids[(i - 1 + ids.length) % ids.length];
      else if (e.key === 'Home') next = ids[0];
      else if (e.key === 'End') next = ids[ids.length - 1];
      if (next) {
        e.preventDefault();
        selectType(next);
        $('tab-' + next).focus();
      }
    };
  }

  function selectType(id) {
    state.type = id;
    ensureTypeData(id);
    touched = {};
    showAllErrors = false;
    maybeApplyPreset();
    renderTabs();
    renderForm();
    scheduleRender();
  }

  function ensureTypeData(id) {
    if (state.data[id]) return;
    var values = {};
    Payloads.getType(id).fields.forEach(function (f) {
      values[f.key] = f.type === 'checkbox' ? false : (f.value || '');
    });
    state.data[id] = values;
  }

  /* ================= per-type form ================= */

  function renderForm() {
    var type = Payloads.getType(state.type);
    var values = state.data[type.id];
    var panel = $('typeForm');
    panel.innerHTML = '';
    panel.setAttribute('aria-labelledby', 'tab-' + type.id);

    var head = el('div', { class: 'flex items-center gap-3 pb-1' });
    head.innerHTML =
      '<span class="grid place-items-center w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400">' +
      typeIcon(type.id, 'w-5 h-5') + '</span>' +
      '<span><h2 class="text-[15px] font-bold leading-tight">' + type.label + '</h2>' +
      '<p class="text-xs text-gray-400 dark:text-gray-500 leading-tight mt-0.5">' + (TYPE_DESC[type.id] || '') + '</p></span>';
    panel.appendChild(head);

    var grid = el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' });
    Payloads.visibleFields(type, values).forEach(function (f) {
      grid.appendChild(buildField(type, f, values));
    });
    panel.appendChild(grid);
    updateFieldErrors();
  }

  function buildField(type, f, values) {
    var wrap = el('div', { class: f.half ? '' : 'sm:col-span-2' });
    var inputId = 'f-' + f.key;
    var errId = 'ferr-' + f.key;
    var input;

    if (f.type === 'checkbox') {
      input = el('input', { type: 'checkbox', id: inputId, class: 'accent-indigo-600' });
      input.checked = !!values[f.key];
      var cbLabel = el('label', { class: 'flex items-center gap-2 text-sm pt-1', for: inputId });
      cbLabel.appendChild(input);
      cbLabel.appendChild(document.createTextNode(f.label));
      wrap.appendChild(cbLabel);
    } else {
      wrap.appendChild(el('label', { class: 'lbl', for: inputId, text: f.label + (f.required ? ' *' : '') }));
      if (f.type === 'select') {
        input = el('select', { id: inputId, class: 'inp' });
        (f.options || []).forEach(function (o) {
          var opt = el('option', { value: o.value, text: o.label });
          input.appendChild(opt);
        });
        input.value = values[f.key] || f.value || '';
      } else if (f.type === 'textarea') {
        input = el('textarea', { id: inputId, class: 'inp', rows: '3', placeholder: f.placeholder || '' });
        input.value = values[f.key] || '';
      } else {
        input = el('input', { type: f.type || 'text', id: inputId, class: 'inp', placeholder: f.placeholder || '' });
        input.value = values[f.key] || '';
      }
      wrap.appendChild(input);
    }

    if (f.hint) wrap.appendChild(el('p', { class: 'hint', text: f.hint }));
    wrap.appendChild(el('p', { class: 'err-msg hidden', id: errId, role: 'alert' }));
    input.setAttribute('aria-describedby', errId);

    input.addEventListener('input', function () {
      values[f.key] = f.type === 'checkbox' ? input.checked : input.value;
      scheduleRender();
    });
    input.addEventListener('blur', function () {
      touched[f.key] = true;
      updateFieldErrors();
    });
    // Selects/checkboxes can change which fields are visible (showIf) or the
    // matching preset logo (social networks) — re-render the form on commit.
    if (f.type === 'select' || f.type === 'checkbox') {
      input.addEventListener('change', function () {
        values[f.key] = f.type === 'checkbox' ? input.checked : input.value;
        touched[f.key] = true;
        maybeApplyPreset();
        renderForm();
        scheduleRender();
      });
    }
    return wrap;
  }

  function currentErrors() {
    return Payloads.validate(state.type, state.data[state.type]);
  }

  function updateFieldErrors() {
    var errors = currentErrors();
    var type = Payloads.getType(state.type);
    type.fields.forEach(function (f) {
      var errEl = $('ferr-' + f.key);
      var input = $('f-' + f.key);
      if (!errEl || !input) return;
      var show = errors[f.key] && (touched[f.key] || showAllErrors);
      errEl.textContent = show ? errors[f.key] : '';
      errEl.classList.toggle('hidden', !show);
      input.classList.toggle('inp-err', !!show);
      input.setAttribute('aria-invalid', show ? 'true' : 'false');
    });
    return errors;
  }

  /* ================= design controls (data-bind) ================= */

  var NUMERIC_KEYS = { gradientRotation: 1, logoSize: 1, logoMargin: 1, size: 1, margin: 1 };
  var OUT_FORMAT = {
    gradientRotation: function (v) { return v + '°'; },
    logoSize: function (v) { return v + '%'; },
    logoMargin: function (v) { return v + 'px'; },
    size: function (v) { return v + 'px'; },
    margin: function (v) { return v + 'px'; }
  };

  function bindDesignControls() {
    document.querySelectorAll('[data-bind]').forEach(function (input) {
      var key = input.getAttribute('data-bind');
      var evt = (input.type === 'checkbox' || input.tagName === 'SELECT') ? 'change' : 'input';
      input.addEventListener(evt, function () {
        var v = input.type === 'checkbox' ? input.checked : input.value;
        if (NUMERIC_KEYS[key]) v = parseInt(v, 10) || 0;
        state.design[key] = v;
        updateOuts();
        updateDesignVisibility();
        scheduleRender();
      });
    });
    document.querySelectorAll('[data-reset]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation(); // don't toggle the <details> section
        (RESET_GROUPS[btn.getAttribute('data-reset')] || []).forEach(function (k) {
          state.design[k] = JSON.parse(JSON.stringify(DESIGN_DEFAULTS[k] === undefined ? null : DESIGN_DEFAULTS[k]));
        });
        syncControlsFromState();
        scheduleRender();
      });
    });
  }

  function syncControlsFromState() {
    document.querySelectorAll('[data-bind]').forEach(function (input) {
      var key = input.getAttribute('data-bind');
      var v = state.design[key];
      if (input.type === 'checkbox') input.checked = !!v;
      else input.value = v == null ? '' : v;
    });
    updateOuts();
    updateDesignVisibility();
    updateLogoUi();
  }

  function updateOuts() {
    document.querySelectorAll('[data-out]').forEach(function (out) {
      var key = out.getAttribute('data-out');
      var fmt = OUT_FORMAT[key] || String;
      out.textContent = fmt(state.design[key]);
    });
  }

  function updateDesignVisibility() {
    var d = state.design;
    $('gradControls').classList.toggle('hidden', !d.gradientOn);
    $('gradRotWrap').classList.toggle('hidden', d.gradientType === 'radial');
    $('frameControls').classList.toggle('hidden', !d.frameOn);
    // Error correction is forced to H while a logo is present (logos cover
    // modules; H can recover up to 30% damage).
    var ec = $('ecLevel');
    if (d.logo) {
      ec.value = 'H';
      ec.disabled = true;
      $('ecNote').classList.remove('hidden');
    } else {
      ec.disabled = false;
      ec.value = d.ecLevel;
      $('ecNote').classList.add('hidden');
    }
  }

  function effectiveEc() {
    return state.design.logo ? 'H' : state.design.ecLevel;
  }

  /* ================= logo upload + presets ================= */

  function setLogo(dataUrl, name, isPreset) {
    state.design.logo = dataUrl;
    state.design.logoName = name;
    state.design.logoIsPreset = !!isPreset;
    if (!isPreset || dataUrl) state.design.presetDismissed = false;
    updateLogoUi();
    updateDesignVisibility();
    scheduleRender();
  }

  function removeLogo() {
    // Remember the dismissal of an auto-applied preset so it doesn't come
    // straight back when the user switches tabs.
    if (state.design.logoIsPreset) state.design.presetDismissed = true;
    state.design.logo = null;
    state.design.logoName = '';
    state.design.logoIsPreset = false;
    updateLogoUi();
    updateDesignVisibility();
    scheduleRender();
  }

  function maybeApplyPreset() {
    var d = state.design;
    var pid = Presets.forType(state.type, state.data[state.type]);
    if (d.logo && !d.logoIsPreset) return; // never touch an uploaded logo
    if (pid && !d.presetDismissed) {
      d.logo = Presets.get(pid);
      d.logoName = pid + ' (preset)';
      d.logoIsPreset = true;
    } else if (!pid && d.logoIsPreset) {
      d.logo = null;
      d.logoName = '';
      d.logoIsPreset = false;
    }
    updateLogoUi();
    updateDesignVisibility();
  }

  function updateLogoUi() {
    var d = state.design;
    var wrap = $('logoThumbWrap');
    if (d.logo) {
      wrap.classList.remove('hidden');
      wrap.classList.add('flex');
      $('logoThumb').src = d.logo;
      $('logoName').textContent = d.logoName || 'logo';
    } else {
      wrap.classList.add('hidden');
      wrap.classList.remove('flex');
    }
    document.querySelectorAll('#presetRow button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(d.logo === Presets.get(b.dataset.preset)));
    });
  }

  function handleLogoFile(file) {
    if (!file) return;
    var okTypes = ['image/png', 'image/jpeg', 'image/svg+xml'];
    if (okTypes.indexOf(file.type) === -1) { toast('Please use a PNG, JPG or SVG file.'); return; }
    if (file.size > 2 * 1024 * 1024) { toast('Logo is too large (max 2 MB).'); return; }
    var reader = new FileReader();
    reader.onload = function () { setLogo(reader.result, file.name, false); };
    reader.readAsDataURL(file);
  }

  function initLogoControls() {
    var dz = $('dropzone');
    var fileInput = $('logoFile');
    dz.addEventListener('click', function () { fileInput.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    ['dragover', 'dragenter'].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        dz.classList.add('border-indigo-500');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      dz.addEventListener(evt, function (e) {
        e.preventDefault();
        dz.classList.remove('border-indigo-500');
      });
    });
    dz.addEventListener('drop', function (e) {
      handleLogoFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', function () {
      handleLogoFile(fileInput.files && fileInput.files[0]);
      fileInput.value = '';
    });
    $('logoRemove').addEventListener('click', removeLogo);

    var row = $('presetRow');
    Presets.LIST.forEach(function (p) {
      var btn = el('button', {
        type: 'button',
        class: 'w-10 h-10 rounded-xl border border-gray-200 dark:border-gray-700 p-1.5 bg-white shadow-sm hover:ring-2 hover:ring-indigo-400 hover:border-transparent active:scale-95 transition',
        title: p.label,
        'aria-label': 'Use ' + p.label + ' logo',
        'data-preset': p.id
      });
      var img = el('img', { src: Presets.get(p.id), alt: '', class: 'w-full h-full object-contain' });
      btn.appendChild(img);
      btn.addEventListener('click', function () { setLogo(Presets.get(p.id), p.label + ' (preset)', true); });
      row.appendChild(btn);
    });
  }

  /* ================= QR rendering ================= */

  function buildQrOptions(payload) {
    var d = state.design;
    var dots = { type: d.dotStyle };
    if (d.gradientOn) {
      dots.gradient = {
        type: d.gradientType,
        rotation: (d.gradientRotation * Math.PI) / 180, // qr-code-styling wants radians
        colorStops: [
          { offset: 0, color: d.fg },
          { offset: 1, color: d.fg2 }
        ]
      };
    } else {
      dots.color = d.fg;
    }
    var opts = {
      width: d.size,
      height: d.size,
      type: 'canvas',
      data: payload,
      margin: d.margin,
      qrOptions: { errorCorrectionLevel: effectiveEc() },
      dotsOptions: dots,
      backgroundOptions: { color: d.bg },
      cornersSquareOptions: { type: d.eyeFrameStyle, color: d.eyeFrameColor },
      cornersDotOptions: { type: d.eyeDotStyle, color: d.eyeDotColor }
    };
    if (d.logo) {
      opts.image = d.logo;
      opts.imageOptions = {
        crossOrigin: 'anonymous',
        hideBackgroundDots: d.hideDots,
        imageSize: d.logoSize / 100,
        margin: d.logoMargin
      };
    }
    return opts;
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 180);
  }

  function render() {
    var errors = updateFieldErrors();
    var hasErrors = Object.keys(errors).length > 0;
    var overlay = $('previewOverlay');
    var exportBtns = ['btnPng', 'btnSvg', 'btnPdf', 'btnCopy'].map($);

    updateFramePreview();

    if (hasErrors) {
      lastValidPayload = '';
      var type = Payloads.getType(state.type);
      overlay.textContent = 'Fill in the ' + type.label + ' form to generate your QR code.';
      overlay.classList.remove('hidden');
      overlay.classList.add('flex');
      exportBtns.forEach(function (b) { b.disabled = true; });
      $('payloadMeta').textContent = '';
      renderWarnings('');
      return;
    }

    var payload = Payloads.build(state.type, state.data[state.type]);
    lastValidPayload = payload;
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
    exportBtns.forEach(function (b) { b.disabled = false; });

    var box = $('qrBox');
    box.innerHTML = '';
    qr = new QRCodeStyling(buildQrOptions(payload));
    qr.append(box);

    $('payloadMeta').textContent = payload.length + ' characters encoded';
    renderWarnings(payload);
  }

  function updateFramePreview() {
    var d = state.design;
    var wrap = $('frameWrap');
    var label = $('frameLabel');
    if (d.frameOn) {
      wrap.style.background = d.frameColor;
      wrap.style.padding = '14px';
      wrap.style.borderRadius = '18px';
      label.textContent = d.frameText || 'Scan me';
      label.style.color = d.frameTextColor;
      label.classList.remove('hidden');
    } else {
      wrap.style.background = '';
      wrap.style.padding = '0';
      wrap.style.borderRadius = '0';
      label.classList.add('hidden');
    }
  }

  /* ================= scannability warnings ================= */

  // Fraction of codewords each error-correction level can recover.
  var EC_CAPACITY = { L: 0.07, M: 0.15, Q: 0.25, H: 0.3 };

  function renderWarnings(payload) {
    var d = state.design;
    var items = [];

    // 1. Contrast between dots and background (worst gradient stop counts).
    var ratio = d.gradientOn
      ? Math.min(contrastRatio(d.fg, d.bg), contrastRatio(d.fg2, d.bg))
      : contrastRatio(d.fg, d.bg);
    if (payload && ratio < 4) {
      items.push('Low contrast (' + ratio.toFixed(1) + ':1) between dots and background. Many scanners need at least ~4:1 — darken the dots or lighten the background.');
    }

    // 2. Inverted colors: light dots on a dark background confuse some scanners.
    var fgLum = d.gradientOn ? Math.max(luminance(d.fg), luminance(d.fg2)) : luminance(d.fg);
    if (payload && fgLum > luminance(d.bg)) {
      items.push('Inverted colors: the dots are lighter than the background. Some scanners can’t read inverted codes — consider swapping the two colors.');
    }

    // 3. Logo coverage vs. what the current error-correction level can absorb.
    //    The logo hides (logoSize%)² of the code area; keep that well under
    //    half of the EC recovery capacity to leave headroom for print damage.
    if (d.logo) {
      var coverage = Math.pow(d.logoSize / 100, 2);
      var safe = EC_CAPACITY[effectiveEc()] * 0.5;
      if (coverage > safe) {
        items.push('The logo covers ~' + Math.round(coverage * 100) + '% of the code — more than is safe for error-correction level ' + effectiveEc() + '. Reduce the logo size.');
      } else if (d.logoSize > 25) {
        items.push('Logo size above 25% leaves little error-correction headroom. Test a scan before printing.');
      }
    }

    // 4. Dense payloads make small/printed codes hard to scan.
    if (payload && payload.length > 300) {
      var tip = state.type === 'vcard'
        ? ' Try removing optional vCard fields (photo URL, address, second phone).'
        : ' Shorter content scans more reliably at small sizes.';
      items.push('Long payload (' + payload.length + ' characters) makes a dense, harder-to-scan code.' + tip);
    }

    var ul = $('warnings');
    ul.innerHTML = '';
    items.forEach(function (msg) {
      var li = el('li', {
        class: 'flex gap-2.5 items-start rounded-xl bg-amber-50 dark:bg-amber-900/25 border border-amber-200/80 dark:border-amber-800/60 px-3.5 py-2.5 text-xs font-medium text-amber-800 dark:text-amber-200'
      });
      li.innerHTML = '<span aria-hidden="true">⚠️</span><span>' + msg + '</span>';
      ul.appendChild(li);
    });
  }

  /* ================= export ================= */

  function filename(ext) {
    var date = new Date().toISOString().slice(0, 10);
    return 'qr-' + state.type + '-' + date + '.' + ext;
  }

  function guardExport() {
    if (lastValidPayload && qr) return true;
    showAllErrors = true;
    updateFieldErrors();
    toast('Fix the form errors first.');
    return false;
  }

  function downloadBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function blobToImage(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
      img.src = url;
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function frameGeometry() {
    var s = state.design.size;
    var pad = Math.round(s * 0.05);
    var band = Math.round(s * 0.16);
    return { s: s, pad: pad, band: band, w: s + pad * 2, h: s + pad * 2 + band };
  }

  /** PNG blob at full export size, with the frame composited in if enabled. */
  function exportPngBlob() {
    return qr.getRawData('png').then(function (blob) {
      if (!state.design.frameOn) return blob;
      return blobToImage(blob).then(function (img) {
        var d = state.design;
        var g = frameGeometry();
        var canvas = document.createElement('canvas');
        canvas.width = g.w;
        canvas.height = g.h;
        var ctx = canvas.getContext('2d');
        roundRectPath(ctx, 0, 0, g.w, g.h, Math.round(g.s * 0.04));
        ctx.fillStyle = d.frameColor;
        ctx.fill();
        ctx.drawImage(img, g.pad, g.pad, g.s, g.s);
        ctx.fillStyle = d.frameTextColor;
        ctx.font = '600 ' + Math.round(g.band * 0.5) + 'px -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.frameText || 'Scan me', g.w / 2, g.pad + g.s + g.pad / 2 + g.band / 2);
        return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
      });
    });
  }

  /** SVG string with the frame wrapped around the raw QR SVG if enabled. */
  function exportSvgText() {
    return qr.getRawData('svg').then(function (blob) { return blob.text(); }).then(function (svgText) {
      var d = state.design;
      if (!d.frameOn) return svgText;
      var g = frameGeometry();
      // Re-position the inner QR svg inside the frame: strip its own size
      // attributes and give it explicit x/y/width/height (viewBox keeps scale).
      var inner = svgText.replace(/<svg([^>]*)>/, function (_, attrs) {
        var cleaned = attrs
          .replace(/\s(width|height|x|y)="[^"]*"/g, '');
        if (!/viewBox=/.test(cleaned)) cleaned += ' viewBox="0 0 ' + g.s + ' ' + g.s + '"';
        return '<svg' + cleaned + ' x="' + g.pad + '" y="' + g.pad + '" width="' + g.s + '" height="' + g.s + '">';
      });
      var fontSize = Math.round(g.band * 0.5);
      var textY = g.pad + g.s + g.pad / 2 + g.band / 2;
      return '<svg xmlns="http://www.w3.org/2000/svg" width="' + g.w + '" height="' + g.h + '" viewBox="0 0 ' + g.w + ' ' + g.h + '">' +
        '<rect width="' + g.w + '" height="' + g.h + '" rx="' + Math.round(g.s * 0.04) + '" fill="' + d.frameColor + '"/>' +
        inner +
        '<text x="' + g.w / 2 + '" y="' + textY + '" text-anchor="middle" dominant-baseline="central" ' +
        'font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-weight="600" font-size="' + fontSize + '" fill="' + d.frameTextColor + '">' +
        escapeXml(d.frameText || 'Scan me') + '</text></svg>';
    });
  }

  function initExport() {
    $('btnPng').addEventListener('click', function () {
      if (!guardExport()) return;
      exportPngBlob()
        .then(function (blob) { downloadBlob(blob, filename('png')); })
        .catch(function () { toast('PNG export failed.'); });
    });

    $('btnSvg').addEventListener('click', function () {
      if (!guardExport()) return;
      exportSvgText()
        .then(function (text) { downloadBlob(new Blob([text], { type: 'image/svg+xml' }), filename('svg')); })
        .catch(function () { toast('SVG export failed.'); });
    });

    $('btnPdf').addEventListener('click', function () {
      if (!guardExport()) return;
      exportPngBlob().then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve(reader.result); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }).then(function (dataUrl) {
        var g = state.design.frameOn ? frameGeometry() : { w: state.design.size, h: state.design.size };
        var doc = new window.jspdf.jsPDF({
          orientation: g.w >= g.h ? 'landscape' : 'portrait',
          unit: 'px',
          format: [g.w, g.h],
          hotfixes: ['px_scaling']
        });
        doc.addImage(dataUrl, 'PNG', 0, 0, g.w, g.h);
        doc.save(filename('pdf'));
      }).catch(function () { toast('PDF export failed.'); });
    });

    $('btnCopy').addEventListener('click', function () {
      if (!guardExport()) return;
      if (!navigator.clipboard || !window.ClipboardItem) {
        toast('Clipboard images aren’t supported in this browser.');
        return;
      }
      // Safari requires the ClipboardItem to be created synchronously with a
      // promise for the blob, inside the user gesture.
      var item = new ClipboardItem({ 'image/png': exportPngBlob() });
      navigator.clipboard.write([item])
        .then(function () { toast('Image copied to clipboard ✔'); })
        .catch(function () { toast('Couldn’t copy — your browser may block clipboard images.'); });
    });
  }

  /* ================= templates (localStorage) ================= */

  var TPL_KEY = 'qrstudio.templates';

  function loadTemplates() {
    try { return JSON.parse(localStorage.getItem(TPL_KEY)) || []; }
    catch (e) { return []; }
  }
  function saveTemplates(list) {
    try { localStorage.setItem(TPL_KEY, JSON.stringify(list)); }
    catch (e) { toast('Couldn’t save — browser storage is full (large logos count against the quota).'); }
  }

  function renderTemplateList() {
    var list = loadTemplates();
    var ul = $('tplList');
    ul.innerHTML = '';
    if (!list.length) {
      ul.appendChild(el('li', { class: 'text-xs text-gray-400', text: 'No saved templates yet.' }));
      return;
    }
    list.forEach(function (tpl) {
      var li = el('li', { class: 'flex items-center gap-2 rounded-xl border border-gray-100 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-800/40 px-3.5 py-2.5' });
      li.appendChild(el('span', { class: 'text-sm flex-1 truncate', text: tpl.name }));
      var loadBtn = el('button', { class: 'btn !py-1 !px-2 text-xs', type: 'button', text: 'Load' });
      loadBtn.addEventListener('click', function () {
        // Merge over defaults so templates saved by older versions stay valid.
        state.design = Object.assign(JSON.parse(JSON.stringify(DESIGN_DEFAULTS)), tpl.design);
        syncControlsFromState();
        scheduleRender();
        toast('Template “' + tpl.name + '” applied.');
      });
      var delBtn = el('button', { class: 'btn !py-1 !px-2 text-xs', type: 'button', text: '✕', 'aria-label': 'Delete template ' + tpl.name });
      delBtn.addEventListener('click', function () {
        saveTemplates(loadTemplates().filter(function (t) { return t.id !== tpl.id; }));
        renderTemplateList();
      });
      li.appendChild(loadBtn);
      li.appendChild(delBtn);
      ul.appendChild(li);
    });
  }

  function initTemplates() {
    $('tplSave').addEventListener('click', function () {
      var list = loadTemplates();
      var name = $('tplName').value.trim() || 'Template ' + (list.length + 1);
      list.push({ id: String(Date.now()), name: name, design: state.design });
      saveTemplates(list);
      $('tplName').value = '';
      renderTemplateList();
      toast('Template “' + name + '” saved.');
    });
    renderTemplateList();
  }

  /* ================= theme ================= */

  function initTheme() {
    var KEY = 'qrstudio.theme';
    var stored = localStorage.getItem(KEY);
    var dark = stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', dark);
    $('themeToggle').addEventListener('click', function () {
      var nowDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem(KEY, nowDark ? 'dark' : 'light');
    });
  }

  /* ================= boot ================= */

  function init() {
    if (typeof QRCodeStyling === 'undefined') {
      document.body.insertAdjacentHTML('afterbegin',
        '<div class="bg-red-600 text-white text-sm px-4 py-2 text-center">Couldn’t load the QR engine (qr-code-styling). Check your internet connection and reload.</div>');
      return;
    }
    initTheme();
    ensureTypeData(state.type);
    renderTabs();
    renderForm();
    bindDesignControls();
    syncControlsFromState();
    initLogoControls();
    initExport();
    initTemplates();
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
