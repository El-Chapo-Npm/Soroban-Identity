# Mobile-first responsive layout

The frontend's page layout, header, navigation and touch-target rules live in `frontend/src/styles/` and are written mobile-first (#882). The base rules describe a phone in portrait, and each `min-width` breakpoint adds what wider screens need. `frontend/src/index.css` keeps the colour tokens and component styles and is loaded first.

| File | Contents |
|---|---|
| `styles/index.css` | Entry point and breakpoint reference |
| `styles/layout.css` | Container and safe-area padding, header, cards, form font sizes, wrapping of long IDs, short-landscape trims |
| `styles/navigation.css` | Menu button, slide-in drawer, scroll lock, network status pill, sticky section tabs |
| `styles/touch.css` | 44 × 44 px minimum touch targets |

## Breakpoints

| Range | Devices | Layout |
|---|---|---|
| < 600px | Phones | Compact one-row header. Controls in a drawer. Tabs pinned to the top and scrolled sideways when they don't fit. |
| ≥ 600px | Large phones in landscape, small tablets | More padding, larger title |
| ≥ 768px | Tablets | Drawer and menu button go away. Controls wrap in a row under the title, and tabs are static. |
| ≥ 1024px | Laptops, desktops | Title and controls share one row |
| landscape and height ≤ 500px | Phones on their side | Subtitle hidden, tighter header, tab bar and cards |

CSS media queries can't read custom properties, so these values are repeated in each file. Change them together.

## Rules for new UI

- **Put layout in CSS, not in inline `style` props.** An inline style beats every media query, which is why the header controls used to overlap the title and why the drawer needed `!important`. Inline styles are fine for values that never change with screen size.
- **Touch targets are at least 44 × 44 px.** `styles/touch.css` gives every `button`, `select`, text input, `role="button"` and `role="tab"` a 44px minimum height, so a new control is compliant unless it sets an explicit `height`. For checkboxes and radios, wrap the input in its `<label>`, and the label becomes the target.
- **Inputs are 16px on phones.** Anything smaller makes iOS Safari zoom in when the field gains focus.
- **Long values wrap.** Addresses, IDs and hashes in `code`, `pre` and `.result` use `overflow-wrap: anywhere`, so they never widen the page.
- **Respect safe areas.** `index.html` sets `viewport-fit=cover`, and padding uses `max(…, env(safe-area-inset-*))` so content clears notches and rounded corners.

## Mobile navigation

The drawer (below 768px):

- slides in from the right, is full height, and can scroll on its own;
- while closed, has `visibility: hidden`, so the keyboard and screen readers can't reach controls that are off screen;
- when opened, moves focus to its first control and keeps `Tab` / `Shift+Tab` inside the drawer (the menu button doubles as its close button);
- locks page scrolling (`html.nav-open`);
- closes on `Escape` or a tap on the backdrop, returning focus to the menu button.

The section tabs stick to the top of the screen on phones, so you can switch sections from anywhere in a long page.

## Audit

The UI was measured in Chrome's device emulation at 320×568, 375×667 and 667×375 (iPhone SE), 412×915 and 915×412 (Pixel), 768×1024 and 1024×768 (tablet), and 1280×800 (desktop). Touch emulation was on for everything except desktop.

| Check | Before | After |
|---|---|---|
| Header and tab controls under 44px | 3 on phones, 7 on wider screens | 0 |
| Issuer Analytics controls under 44px | range buttons, export and chart toggles sized by inline padding only (not measured in the baseline run) | 0 |
| Header controls overlap the title | yes, at ≥ 769px | no |
| Closed drawer controls reachable by keyboard | 4 | 0 |
| Drawer top edge | 16px gap (inline `top: 1rem` beat the CSS) | flush |
| Page scrolls behind the open drawer | yes | no |
| Focus moves into the drawer / back to the menu button | no / only by accident | yes / yes |
| Tabs visible after scrolling on phones | no | yes (sticky) |
| Header height at 375px | 81px | 69px (61px in landscape) |
| Issuer Analytics width at 375px | ~300px of 375 | 351px |
| Horizontal overflow | none | none |

These checks ran in emulation. They still need confirming on physical iOS and Android devices, in portrait and landscape. The Credentials tab couldn't be exercised: it throws at runtime on `main` (`jsonImportRef is not defined`), independently of this change. The global touch-target and wrapping rules apply to it once it renders.
