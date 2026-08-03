# Sprint 19 Design System

## Direction

Nailsoft uses a professional navy light theme: calm neutral surfaces, high-information-density operational layouts, navy primary actions and a restrained teal accent. Decorative gradients, glass effects and low-contrast pastel surfaces are not the primary language. Dark mode is outside Sprint 19.

## Token contract

- Semantic color roles: canvas, surface, surface-muted, surface-elevated, text-primary, text-secondary, text-disabled, border-default, border-strong, action-primary, action-secondary, focus, success, warning, danger, info and chart series.
- Typography: system sans for product UI; system monospace only for evidence, identifiers and technical values.
- Layout: 4px base spacing, responsive containers, standard and compact density, minimum 44px touch targets.
- Motion: 120-200ms purposeful transitions. `prefers-reduced-motion` disables non-essential motion.
- Web uses CSS variables and CSS Modules. Mobile uses token helpers and React Native StyleSheet. Tailwind is not introduced.
- Icons use semantic Feather-compatible names. Important actions always include text.
- Overlays use Radix primitives. Forms use React Hook Form and existing validation schemas. Tables use TanStack Table on Web and list/card structures on Mobile.
- Charts use a shared wrapper with lazy loading and an accessible text/table fallback.

## Component states

Every async surface must expose loading, ready, empty, error/retry and forbidden. Stale, offline and partial states are included where a cached or networked surface can encounter them. State is not communicated by color alone.

## Accessibility baseline

Target WCAG 2.2 AA: keyboard operation, visible focus, logical landmarks, accessible names, focus trap and restoration, Escape handling, 200 percent zoom, text resize, contrast, table headers and chart alternatives.
