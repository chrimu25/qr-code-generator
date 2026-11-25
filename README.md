# QR Studio — Customizable QR Code Generator

A fully client-side QR code generator. Ten content types, deep visual
customization (colors, gradients, dot/eye styles, logos, frames), live preview
with scannability warnings, and PNG / SVG / PDF / clipboard export. No backend,
no build step.

## Run it

Open `index.html` in any modern browser — that's it. An internet connection is
needed on first load for the three CDN dependencies:

- [Tailwind CSS (Play CDN)](https://cdn.tailwindcss.com) — styling
- [`qr-code-styling`](https://github.com/kozakdenys/qr-code-styling) — QR rendering
- [`jsPDF`](https://github.com/parallax/jsPDF) — PDF export

To serve it locally instead (avoids any `file://` quirks):

```sh
cd QRGenerator
python3 -m http.server 8080   # then open http://localhost:8080
```

## File structure

```
index.html        Layout, customization controls, CDN includes
js/payloads.js    TYPE REGISTRY: field schemas, validation, payload builders
js/presets.js     Built-in logo icons as inline SVG data URIs
js/app.js         State, form rendering, QR preview, warnings, export, templates
TESTING.md        One scannable sample per QR type
```

## How it works

- `js/payloads.js` exposes `Payloads.TYPES`, a declarative registry. Each entry
  describes a QR type's form fields, validation rules and a `build(values)`
  function that returns the encoded payload string (vCard, `WIFI:`, `mailto:`, …).
- `js/app.js` renders the tabs and form from that registry, keeps everything in
  a central `state` object (`state.type`, `state.data`, `state.design`), and
  re-renders the `qr-code-styling` instance on every (debounced) change.
- Error correction is forced to **H** whenever a logo is present; warnings cover
  low contrast, inverted colors, oversized logos and overly long payloads.
- Designs can be saved as named templates in `localStorage`.

## Adding a new QR type

Everything derives from the registry — add **one entry** to `TYPES` in
`js/payloads.js` and you're done:

```js
{
  id: 'telegram',             // unique id (used in state + filenames)
  label: 'Telegram',          // tab label
  icon: '✈️',                 // tab emoji
  preset: 'telegram',         // optional: auto-applied logo id from presets.js
  fields: [
    { key: 'username', label: 'Username', type: 'text', required: true,
      validate: function (v) { return v ? null : 'Username is required.'; } }
  ],
  build: function (v) { return 'https://t.me/' + v.username.replace(/^@/, ''); }
}
```

Field options: `type` (`text | url | tel | email | textarea | select |
checkbox`), `required`, `placeholder`, `hint`, `half` (half-width on desktop),
`options` (for selects), `showIf(values)` (conditional visibility) and
`validate(value, allValues)` returning an error string or `null`.

If the new type should auto-apply a logo, add a matching icon to
`ICONS`/`LIST` in `js/presets.js`.

## Notes & limits

- Uploaded logos are read as data URLs and never leave the browser.
- Logos are capped at 2 MB; large logos also count against the `localStorage`
  quota when saved inside templates.
- The clipboard button needs a browser with `ClipboardItem` support
  (Chrome/Edge/Safari; Firefox requires `dom.events.asyncClipboard.clipboardItem`).
- Phase 2 (dynamic QR redirects + scan analytics via a Laravel backend) is not
  part of this static build.
