# BNG Blaster UI Style Guide

This UI can be rebranded quickly by changing a small set of design tokens.

## Scope and Principles

- Keep structure and spacing unchanged, change only visual tokens first.
- Use CSS variables as the primary customization point.
- Avoid hardcoded colors in page components whenever possible.
- Keep contrast high enough for readable tables, forms, and badges.

## Primary Theme Tokens

All color tokens are centralized in the `:root` block in [static/theme.css](static/theme.css). The practical mapping is generic:

```css
:root {
  --color-brand: #e20074;
  --color-brand-soft: rgba(226, 0, 116, 0.1);
  --color-brand-hover: #bf0063;
  --color-bg: #f3f5f7;
  --color-surface: #ffffff;
  --color-surface-alt: #f8f9fb;
  --color-border: #d8dde3;
  --color-border-hover: #b8c0c8;
  --color-text: #1e2a36;
  --color-muted: #5f6b76;
  --color-text-on-brand: #ffffff;

  --color-brand-ring: rgba(40, 212, 172, 0.4);
  --color-brand-border-soft: rgba(226, 0, 116, 0.32);
  --color-brand-border-strong: rgba(226, 0, 116, 0.62);
  --color-brand-badge-text: #8f0049;
  --color-brand-badge-border: rgba(226, 0, 116, 0.35);

  --color-surface-hover: #f5f7f9;
  --color-scrollbar-thumb: rgba(31, 45, 58, 0.2);

  --brand: var(--color-brand);
  --brand-dim: var(--color-brand-soft);
}
```

To switch brand colors, update these values first:

- --color-brand
- --color-brand-soft
- --color-brand-hover
- --color-bg
- --color-surface
- --color-surface-alt
- --color-border
- --color-border-hover
- --color-text
- --color-muted
- --color-text-on-brand
- --color-brand-ring
- --color-brand-border-soft
- --color-brand-border-strong
- --color-brand-badge-text
- --color-brand-badge-border
- --color-surface-hover
- --color-scrollbar-thumb

Derived aliases (normally unchanged):

- --brand
- --brand-dim

## Where Colors Are Applied

Most components are mapped through utility classes in [static/theme.css](static/theme.css):

- .brand-text, .brand-bg, .brand-border
- .brand-button-text
- .border-brand-soft, .border-brand-strong
- .nav-active
- overrides for DaisyUI classes like .bg-base-200, .bg-base-300, .text-base-content

This means that changing token values usually updates the whole app automatically.

## Rebranding Procedure

1. Edit tokens in [static/theme.css](static/theme.css).
2. Open the UI and verify pages:
   - [static/js/pages/instances.js](static/js/pages/instances.js)
   - [static/js/pages/templates.js](static/js/pages/templates.js)
   - [static/js/pages/explorer.js](static/js/pages/explorer.js)
   - [static/js/pages/metrics.js](static/js/pages/metrics.js)
3. Check active/hover states in sidebar and buttons.
4. Check badges and table headers for readability.
5. Confirm form controls still have visible borders in both normal and hover states.

## Remaining Hardcoded Colors

Most colors are now token-based. One notable inline hardcoded color remains:

- [static/js/pages/templates.js](static/js/pages/templates.js#L16): inline border color uses rgba(40,212,172,0.3)

For full portability, replace this with a token from [static/theme.css](static/theme.css).

## Example Alternative Palettes

Current active palette in this repository: Green Theme.

### Blue Theme

```css
:root {
  --color-brand: #0057b8;
  --color-brand-soft: rgba(0, 87, 184, 0.12);
  --color-brand-hover: #004796;
  --color-bg: #f4f7fb;
  --color-surface: #ffffff;
  --color-surface-alt: #eef3fa;
  --color-border: #cfdaea;
  --color-border-hover: #afc2dc;
  --color-text: #1d2a3a;
  --color-muted: #5e6f82;
  --color-text-on-brand: #ffffff;

  --color-brand-ring: rgba(0, 87, 184, 0.35);
  --color-brand-border-soft: rgba(0, 87, 184, 0.30);
  --color-brand-border-strong: rgba(0, 87, 184, 0.55);
  --color-brand-badge-text: #003e7f;
  --color-brand-badge-border: rgba(0, 87, 184, 0.32);

  --color-surface-hover: #eaf1fb;
  --color-scrollbar-thumb: rgba(29, 42, 58, 0.22);

  --brand: var(--color-brand);
  --brand-dim: var(--color-brand-soft);
}
```

### Green Theme

```css
:root {
  --color-brand: #0b8a57;
  --color-brand-soft: rgba(11, 138, 87, 0.12);
  --color-brand-hover: #086e45;
  --color-bg: #f2f8f5;
  --color-surface: #ffffff;
  --color-surface-alt: #ecf5ef;
  --color-border: #c9dfd1;
  --color-border-hover: #a8c7b4;
  --color-text: #1f2f27;
  --color-muted: #5b6e63;
  --color-text-on-brand: #ffffff;

  --color-brand-ring: rgba(11, 138, 87, 0.35);
  --color-brand-border-soft: rgba(11, 138, 87, 0.30);
  --color-brand-border-strong: rgba(11, 138, 87, 0.55);
  --color-brand-badge-text: #065536;
  --color-brand-badge-border: rgba(11, 138, 87, 0.32);

  --color-surface-hover: #e7f3ec;
  --color-scrollbar-thumb: rgba(31, 47, 39, 0.22);

  --brand: var(--color-brand);
  --brand-dim: var(--color-brand-soft);
}
```

### Magenta Theme

```css
:root {
  --color-brand: #e20074;
  --color-brand-soft: rgba(226, 0, 116, 0.1);
  --color-brand-hover: #bf0063;
  --color-bg: #f3f5f7;
  --color-surface: #ffffff;
  --color-surface-alt: #f8f9fb;
  --color-border: #d8dde3;
  --color-border-hover: #b8c0c8;
  --color-text: #1e2a36;
  --color-muted: #5f6b76;
  --color-text-on-brand: #ffffff;

  --color-brand-ring: rgba(40, 212, 172, 0.4);
  --color-brand-border-soft: rgba(226, 0, 116, 0.32);
  --color-brand-border-strong: rgba(226, 0, 116, 0.62);
  --color-brand-badge-text: #8f0049;
  --color-brand-badge-border: rgba(226, 0, 116, 0.35);

  --color-surface-hover: #f5f7f9;
  --color-scrollbar-thumb: rgba(31, 45, 58, 0.2);

  --brand: var(--color-brand);
  --brand-dim: var(--color-brand-soft);
}
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
