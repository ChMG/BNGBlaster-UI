# BNG Blaster UI Style Guide

This UI can be rebranded quickly by changing a small set of design tokens.

## Scope and Principles

- Keep structure and spacing unchanged, change only visual tokens first.
- Use CSS variables as the primary customization point.
- Avoid hardcoded colors in page components whenever possible.
- Keep contrast high enough for readable tables, forms, and badges.

## Primary Theme Tokens

Core tokens are defined in [static/index.html](static/index.html#L24). The current codebase still contains legacy variable names, but the practical mapping is generic:

```css
:root {
  --color-brand: #e20074;
  --color-brand-soft: rgba(226, 0, 116, 0.1);
  --color-bg: #f3f5f7;
  --color-surface: #ffffff;
  --color-surface-alt: #f8f9fb;
  --color-border: #d8dde3;
  --color-text: #1e2a36;
  --color-muted: #5f6b76;
}

:root {
  --brand: var(--color-brand);
  --brand-dim: var(--color-brand-soft);
}
```

To switch brand colors, update these values first:

- --color-brand
- --color-brand-soft
- --color-bg
- --color-surface
- --color-surface-alt
- --color-border
- --color-text
- --color-muted
- --brand (if you want a different mapping)
- --brand-dim (if you want a different mapping)

## Where Colors Are Applied

Most components are mapped through utility classes in [static/index.html](static/index.html#L47):

- .brand-text, .brand-bg, .brand-border
- .brand-button-text
- .border-brand-soft, .border-brand-strong
- .nav-active
- overrides for DaisyUI classes like .bg-base-200, .bg-base-300, .text-base-content

This means that changing token values usually updates the whole app automatically.

## Rebranding Procedure

1. Edit tokens in [static/index.html](static/index.html#L24).
2. Open the UI and verify pages:
   - [static/js/pages/instances.js](static/js/pages/instances.js)
   - [static/js/pages/templates.js](static/js/pages/templates.js)
   - [static/js/pages/explorer.js](static/js/pages/explorer.js)
   - [static/js/pages/metrics.js](static/js/pages/metrics.js)
3. Check active/hover states in sidebar and buttons.
4. Check badges and table headers for readability.
5. Confirm form controls still have visible borders in both normal and hover states.

## Hardcoded Color Cleanup (Recommended)

Some accents still contain fixed RGBA values and should be aligned to theme tokens when rebranding:

- [static/index.html](static/index.html#L44): .brand-ring uses rgba(40,212,172,0.4)
- [static/js/pages/templates.js](static/js/pages/templates.js#L16): inline border color uses rgba(40,212,172,0.3)

For clean theme portability, replace those with token-based values.

## Example Alternative Palettes

### Blue Theme

```css
--color-brand: #0057b8;
--color-brand-soft: rgba(0, 87, 184, 0.12);
--color-bg: #f4f7fb;
--color-surface: #ffffff;
--color-surface-alt: #eef3fa;
--color-border: #cfdaea;
--color-text: #1d2a3a;
--color-muted: #5e6f82;
```

### Green Theme

```css
--color-brand: #0b8a57;
--color-brand-soft: rgba(11, 138, 87, 0.12);
--color-bg: #f2f8f5;
--color-surface: #ffffff;
--color-surface-alt: #ecf5ef;
--color-border: #c9dfd1;
--color-text: #1f2f27;
--color-muted: #5b6e63;
```

## Accessibility Checklist

Before shipping a new color set:

- Check text contrast for normal body text and muted labels.
- Check contrast for active navigation state.
- Check button text on brand background.
- Check status badges in tables and explorer responses.
- Test on desktop and mobile widths.

## Optional Next Step

If frequent rebranding is expected, move theme tokens into separate theme files (for example static/themes/default.css, static/themes/blue.css) and load one based on an environment flag.
