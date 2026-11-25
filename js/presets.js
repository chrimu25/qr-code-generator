/**
 * presets.js — built-in brand/category logos as inline SVG data URIs.
 * Self-contained (no network fetches) so logos work offline and never taint
 * the export canvas. Icons are simplified marks, not official brand assets.
 */
window.Presets = (function () {
  'use strict';

  function svgData(inner) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' + inner + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  var ICONS = {
    instagram: svgData(
      '<defs><radialGradient id="ig" cx="30%" cy="110%" r="150%">' +
      '<stop offset="0%" stop-color="#fdf497"/><stop offset="30%" stop-color="#fd5949"/>' +
      '<stop offset="60%" stop-color="#d6249f"/><stop offset="100%" stop-color="#285AEB"/>' +
      '</radialGradient></defs>' +
      '<rect width="80" height="80" rx="18" fill="url(#ig)"/>' +
      '<rect x="19" y="19" width="42" height="42" rx="12" fill="none" stroke="#fff" stroke-width="5"/>' +
      '<circle cx="40" cy="40" r="10" fill="none" stroke="#fff" stroke-width="5"/>' +
      '<circle cx="53.5" cy="26.5" r="3.5" fill="#fff"/>'
    ),
    linkedin: svgData(
      '<rect width="80" height="80" rx="18" fill="#0A66C2"/>' +
      '<text x="40" y="55" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="bold" fill="#fff" text-anchor="middle">in</text>'
    ),
    whatsapp: svgData(
      '<rect width="80" height="80" rx="18" fill="#25D366"/>' +
      '<path d="M40 15a25 25 0 0 0-21.6 37.6L15 65l12.8-3.3A25 25 0 1 0 40 15z" fill="#fff"/>' +
      '<path d="M31.5 28.5l4.5-1.5 3.5 7-3.5 3c1.8 4 5.5 7.7 9.5 9.5l3-3.5 7 3.5-1.5 4.5c-.8 2.4-3.3 3.8-5.8 3.2-10.3-2.6-18.3-10.6-20.9-20.9-.6-2.5.8-5 3.2-5.8z" fill="#25D366"/>'
    ),
    facebook: svgData(
      '<rect width="80" height="80" rx="18" fill="#1877F2"/>' +
      '<text x="42" y="62" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="bold" fill="#fff" text-anchor="middle">f</text>'
    ),
    x: svgData(
      '<rect width="80" height="80" rx="18" fill="#000"/>' +
      '<text x="40" y="56" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="bold" fill="#fff" text-anchor="middle">X</text>'
    ),
    tiktok: svgData(
      '<rect width="80" height="80" rx="18" fill="#010101"/>' +
      '<path d="M44 18v30a9 9 0 1 1-9-9h2v-8h-2a17 17 0 1 0 17 17V32c3 2.2 6.5 3.5 10 3.8v-8c-5.5-.6-10-4.3-11.5-9.8z" fill="#fff"/>' +
      '<path d="M46 18v30a9 9 0 0 1-2 5.7" fill="none" stroke="#25F4EE" stroke-width="2"/>'
    ),
    youtube: svgData(
      '<rect width="80" height="80" rx="18" fill="#FF0000"/>' +
      '<path d="M33 28l22 12-22 12z" fill="#fff"/>'
    ),
    email: svgData(
      '<rect width="80" height="80" rx="18" fill="#475569"/>' +
      '<rect x="16" y="25" width="48" height="30" rx="5" fill="#fff"/>' +
      '<path d="M19 29l21 15 21-15" fill="none" stroke="#475569" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
    ),
    wifi: svgData(
      '<rect width="80" height="80" rx="18" fill="#0EA5E9"/>' +
      '<path d="M17 42a33 33 0 0 1 46 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M25 50a22 22 0 0 1 30 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M32.5 57a11 11 0 0 1 15 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>' +
      '<circle cx="40" cy="63" r="4" fill="#fff"/>'
    ),
    phone: svgData(
      '<rect width="80" height="80" rx="18" fill="#22C55E"/>' +
      '<path d="M27 19l9-3 6.5 13-6 5c2.8 6 7.5 10.7 13.5 13.5l5-6 13 6.5-3 9c-1.3 3.8-5.3 6-9.2 5-16.5-4.2-29.6-17.3-33.8-33.8-1-3.9 1.2-7.9 5-9.2z" fill="#fff"/>'
    )
  };

  // Display order + labels for the one-click preset row in the logo section.
  var LIST = [
    { id: 'instagram', label: 'Instagram' },
    { id: 'linkedin',  label: 'LinkedIn' },
    { id: 'whatsapp',  label: 'WhatsApp' },
    { id: 'facebook',  label: 'Facebook' },
    { id: 'x',         label: 'X' },
    { id: 'tiktok',    label: 'TikTok' },
    { id: 'youtube',   label: 'YouTube' },
    { id: 'email',     label: 'Email' },
    { id: 'wifi',      label: 'Wi-Fi' },
    { id: 'phone',     label: 'Phone' }
  ];

  /** Preset id for a QR type (handles the per-network "social" case). */
  function forType(typeId, values) {
    if (typeId === 'social') return (values && values.network) || 'facebook';
    var t = window.Payloads.getType(typeId);
    return t.preset || null;
  }

  return {
    ICONS: ICONS,
    LIST: LIST,
    forType: forType,
    get: function (id) { return ICONS[id] || null; }
  };
})();
