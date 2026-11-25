/**
 * payloads.js — QR type registry: field schemas, validation and payload builders.
 *
 * Each entry in TYPES fully describes one QR type:
 *   id        unique key (also used for state storage and filenames)
 *   label     tab label
 *   icon      tab emoji
 *   preset    id of a preset logo (see presets.js) auto-applied when the type
 *             is selected. For "social" the preset is resolved per network.
 *   fields[]  form schema: {key, label, type, placeholder, required, hint,
 *             options, showIf(values), validate(value, values) -> error|null}
 *   build(values) -> payload string (only called after validation passes)
 *
 * To add a new QR type: add one entry here. The form, tab, validation and
 * preview all derive from this registry — no other file needs to change.
 */
window.Payloads = (function () {
  'use strict';

  /* ---------------- shared helpers ---------------- */

  // Keep digits and a single leading "+" (users paste numbers with spaces/dashes).
  function cleanPhone(raw) {
    var s = String(raw || '').replace(/[^\d+]/g, '');
    return s.indexOf('+') === 0 ? '+' + s.replace(/\+/g, '') : s.replace(/\+/g, '');
  }

  function phoneError(raw) {
    var v = cleanPhone(raw);
    if (!v) return 'Phone number is required.';
    if (!/^\+?\d{6,15}$/.test(v)) return 'Use international format, e.g. +250788123456';
    return null;
  }

  function emailError(raw) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw || '').trim())) {
      return 'Enter a valid email address.';
    }
    return null;
  }

  function normalizeUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    // Auto-add https:// when no scheme is given.
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) s = 'https://' + s;
    return s;
  }

  function urlError(raw) {
    var s = normalizeUrl(raw);
    if (!s) return 'URL is required.';
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http(s) links are supported.';
      if (!/^[^\s]+\.[^\s]{2,}$/.test(u.hostname)) return 'Enter a valid domain, e.g. example.com';
      return null;
    } catch (e) {
      return 'Enter a valid URL, e.g. https://example.com';
    }
  }

  /**
   * Accept "@handle", "handle" or a full profile URL and return the bare handle.
   * For URLs the last non-empty path segment is used.
   */
  function extractHandle(raw) {
    var s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return '';
    if (/^(https?:\/\/)?[^\/]*\.[a-z]{2,}\//i.test(s)) {
      var path = s.replace(/^https?:\/\//i, '').split(/[?#]/)[0];
      var parts = path.split('/').filter(Boolean);
      if (parts.length > 1) s = parts[parts.length - 1];
    }
    return s.replace(/^@+/, '');
  }

  /**
   * vCard 3.0 escaping (RFC 2426): backslash first, then comma and semicolon;
   * literal newlines become "\n". Order matters — escaping "\" last would
   * double-escape the characters we just escaped.
   */
  function vEsc(s) {
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/([,;])/g, '\\$1')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  /**
   * WIFI: payload escaping — the special characters \ ; , : " must be
   * backslash-escaped or scanners will misparse the SSID/password.
   */
  function wifiEsc(s) {
    return String(s || '').replace(/([\\;,:"])/g, '\\$1');
  }

  function required(label) {
    return function (v) {
      return String(v || '').trim() ? null : (label || 'This field') + ' is required.';
    };
  }

  /* ---------------- type registry ---------------- */

  var TYPES = [
    {
      id: 'url',
      label: 'Link',
      icon: '🔗',
      fields: [
        { key: 'url', label: 'Website URL', type: 'url', required: true,
          placeholder: 'example.com', hint: 'https:// is added automatically.',
          validate: urlError }
      ],
      build: function (v) { return normalizeUrl(v.url); }
    },

    {
      id: 'vcard',
      label: 'Business card',
      icon: '👤',
      fields: [
        { key: 'firstName', label: 'First name', type: 'text', required: true, half: true, validate: required('First name') },
        { key: 'lastName',  label: 'Last name',  type: 'text', half: true },
        { key: 'title',     label: 'Job title',  type: 'text', half: true, placeholder: 'Product Manager' },
        { key: 'company',   label: 'Company',    type: 'text', half: true },
        { key: 'phoneCell', label: 'Mobile phone', type: 'tel', half: true, placeholder: '+250788123456',
          validate: function (v) { return v ? phoneError(v) : null; } },
        { key: 'phoneWork', label: 'Work phone', type: 'tel', half: true,
          validate: function (v) { return v ? phoneError(v) : null; } },
        { key: 'email',     label: 'Email', type: 'email',
          validate: function (v) { return v ? emailError(v) : null; } },
        { key: 'website',   label: 'Website', type: 'url',
          validate: function (v) { return v ? urlError(v) : null; } },
        { key: 'street',    label: 'Street address', type: 'text' },
        { key: 'city',      label: 'City', type: 'text', half: true },
        { key: 'country',   label: 'Country', type: 'text', half: true },
        { key: 'photoUrl',  label: 'Photo URL (optional)', type: 'url',
          hint: 'Public image URL. Adds a lot of data — leave empty for an easier-to-scan code.',
          validate: function (v) { return v ? urlError(v) : null; } }
      ],
      build: function (v) {
        var lines = ['BEGIN:VCARD', 'VERSION:3.0'];
        lines.push('N:' + vEsc(v.lastName) + ';' + vEsc(v.firstName) + ';;;');
        lines.push('FN:' + vEsc((v.firstName + ' ' + (v.lastName || '')).trim()));
        if (v.title)     lines.push('TITLE:' + vEsc(v.title));
        if (v.company)   lines.push('ORG:' + vEsc(v.company));
        if (v.phoneCell) lines.push('TEL;TYPE=CELL:' + cleanPhone(v.phoneCell));
        if (v.phoneWork) lines.push('TEL;TYPE=WORK:' + cleanPhone(v.phoneWork));
        if (v.email)     lines.push('EMAIL;TYPE=INTERNET:' + vEsc(v.email.trim()));
        if (v.website)   lines.push('URL:' + vEsc(normalizeUrl(v.website)));
        if (v.street || v.city || v.country) {
          // ADR fields: PO box;extended;street;city;region;postal code;country
          lines.push('ADR;TYPE=WORK:;;' + vEsc(v.street) + ';' + vEsc(v.city) + ';;;' + vEsc(v.country));
        }
        if (v.photoUrl)  lines.push('PHOTO;VALUE=URI:' + normalizeUrl(v.photoUrl));
        lines.push('END:VCARD');
        return lines.join('\r\n'); // vCard spec requires CRLF line endings
      }
    },

    {
      id: 'instagram',
      label: 'Instagram',
      icon: '📸',
      preset: 'instagram',
      fields: [
        { key: 'username', label: 'Instagram username', type: 'text', required: true,
          placeholder: '@yourname', validate: function (v) {
            var h = extractHandle(v);
            if (!h) return 'Username is required.';
            if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) return 'Only letters, numbers, dots and underscores.';
            return null;
          } }
      ],
      build: function (v) { return 'https://instagram.com/' + extractHandle(v.username); }
    },

    {
      id: 'linkedin',
      label: 'LinkedIn',
      icon: '💼',
      preset: 'linkedin',
      fields: [
        { key: 'kind', label: 'Link to', type: 'select', value: 'profile',
          options: [{ value: 'profile', label: 'Personal profile' }, { value: 'company', label: 'Company page' }] },
        { key: 'handle', label: 'Username or full URL', type: 'text', required: true,
          placeholder: 'jane-doe or https://linkedin.com/in/jane-doe',
          validate: function (v) {
            var h = extractHandle(v);
            if (!h) return 'Username or URL is required.';
            if (!/^[A-Za-z0-9\-_.%]{1,100}$/.test(h)) return 'That doesn’t look like a valid LinkedIn name.';
            return null;
          } }
      ],
      build: function (v) {
        var h = extractHandle(v.handle);
        return v.kind === 'company'
          ? 'https://www.linkedin.com/company/' + h
          : 'https://www.linkedin.com/in/' + h;
      }
    },

    {
      id: 'whatsapp',
      label: 'WhatsApp',
      icon: '💬',
      preset: 'whatsapp',
      fields: [
        { key: 'phone', label: 'Phone (international format)', type: 'tel', required: true,
          placeholder: '+250788123456', validate: phoneError },
        { key: 'message', label: 'Prefilled message (optional)', type: 'textarea',
          placeholder: 'Hi! I scanned your QR code…' }
      ],
      build: function (v) {
        // wa.me wants digits only (no "+", spaces or dashes)
        var num = cleanPhone(v.phone).replace(/^\+/, '');
        var url = 'https://wa.me/' + num;
        if (v.message && v.message.trim()) url += '?text=' + encodeURIComponent(v.message.trim());
        return url;
      }
    },

    {
      id: 'email',
      label: 'Email',
      icon: '✉️',
      preset: 'email',
      fields: [
        { key: 'to', label: 'To', type: 'email', required: true,
          placeholder: 'hello@example.com', validate: emailError },
        { key: 'subject', label: 'Subject', type: 'text' },
        { key: 'body', label: 'Message', type: 'textarea' }
      ],
      build: function (v) {
        var params = [];
        if (v.subject) params.push('subject=' + encodeURIComponent(v.subject));
        if (v.body) params.push('body=' + encodeURIComponent(v.body));
        return 'mailto:' + v.to.trim() + (params.length ? '?' + params.join('&') : '');
      }
    },

    {
      id: 'phone',
      label: 'Phone / SMS',
      icon: '📞',
      preset: 'phone',
      fields: [
        { key: 'mode', label: 'Action when scanned', type: 'select', value: 'call',
          options: [{ value: 'call', label: 'Start a call (tel:)' }, { value: 'sms', label: 'Compose an SMS' }] },
        { key: 'phone', label: 'Phone (international format)', type: 'tel', required: true,
          placeholder: '+250788123456', validate: phoneError },
        { key: 'message', label: 'Prefilled SMS text', type: 'textarea',
          showIf: function (v) { return v.mode === 'sms'; } }
      ],
      build: function (v) {
        var num = cleanPhone(v.phone);
        if (v.mode === 'sms') return 'SMSTO:' + num + ':' + (v.message || '');
        return 'tel:' + num;
      }
    },

    {
      id: 'wifi',
      label: 'Wi-Fi',
      icon: '📶',
      preset: 'wifi',
      fields: [
        { key: 'ssid', label: 'Network name (SSID)', type: 'text', required: true, validate: required('SSID') },
        { key: 'encryption', label: 'Security', type: 'select', value: 'WPA',
          options: [{ value: 'WPA', label: 'WPA / WPA2 / WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: 'Open (no password)' }] },
        { key: 'password', label: 'Password', type: 'text',
          showIf: function (v) { return v.encryption !== 'nopass'; },
          validate: function (v, all) {
            if (all.encryption !== 'nopass' && !String(v || '').length) return 'Password is required for secured networks.';
            return null;
          } },
        { key: 'hidden', label: 'Hidden network', type: 'checkbox' }
      ],
      build: function (v) {
        var pass = v.encryption === 'nopass' ? '' : v.password;
        return 'WIFI:T:' + v.encryption + ';S:' + wifiEsc(v.ssid) + ';P:' + wifiEsc(pass) +
               ';H:' + (v.hidden ? 'true' : 'false') + ';;';
      }
    },

    {
      id: 'text',
      label: 'Text',
      icon: '📝',
      fields: [
        { key: 'text', label: 'Text', type: 'textarea', required: true,
          placeholder: 'Any plain text…', validate: required('Text') }
      ],
      build: function (v) { return v.text; }
    },

    {
      id: 'social',
      label: 'Other socials',
      icon: '🌐',
      // preset resolved per network in app.js
      fields: [
        { key: 'network', label: 'Network', type: 'select', value: 'facebook',
          options: [
            { value: 'facebook', label: 'Facebook' },
            { value: 'x', label: 'X (Twitter)' },
            { value: 'tiktok', label: 'TikTok' },
            { value: 'youtube', label: 'YouTube' }
          ] },
        { key: 'username', label: 'Username or full URL', type: 'text', required: true,
          placeholder: '@yourname', validate: function (v) {
            return extractHandle(v) ? null : 'Username is required.';
          } }
      ],
      build: function (v) {
        var h = extractHandle(v.username);
        switch (v.network) {
          case 'x':       return 'https://x.com/' + h;
          case 'tiktok':  return 'https://www.tiktok.com/@' + h;
          case 'youtube': return 'https://www.youtube.com/@' + h;
          default:        return 'https://www.facebook.com/' + h;
        }
      }
    }
  ];

  /* ---------------- public API ---------------- */

  function getType(id) {
    for (var i = 0; i < TYPES.length; i++) if (TYPES[i].id === id) return TYPES[i];
    return TYPES[0];
  }

  function visibleFields(type, values) {
    return type.fields.filter(function (f) { return !f.showIf || f.showIf(values); });
  }

  /**
   * Validate the current values for a type.
   * Returns a map of {fieldKey: errorMessage} — empty map means valid.
   */
  function validate(typeId, values) {
    var type = getType(typeId);
    var errors = {};
    visibleFields(type, values).forEach(function (f) {
      var val = values[f.key];
      if (f.required && !String(val == null ? '' : val).trim() && f.type !== 'checkbox') {
        errors[f.key] = f.label + ' is required.';
      } else if (f.validate) {
        var err = f.validate(val, values);
        if (err) errors[f.key] = err;
      }
    });
    return errors;
  }

  /** Build the payload string. Call only after validate() returns no errors. */
  function build(typeId, values) {
    return getType(typeId).build(values);
  }

  return {
    TYPES: TYPES,
    getType: getType,
    visibleFields: visibleFields,
    validate: validate,
    build: build,
    helpers: { normalizeUrl: normalizeUrl, cleanPhone: cleanPhone, extractHandle: extractHandle }
  };
})();
