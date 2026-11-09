# Airhead UI

How Airhead looks and which pieces to use. The aim: calm, legible and consistent, like Apple Reminders, Calendar or Things. The iPhone Home Screen app comes first; iPad and desktop Chrome follow the same rules with more room.

See every component live in **Settings → About → Design kit** (route `/ui`), in light and dark side by side.

## Principles

- **One look everywhere.** Use the components in `src/ui/`. Do not write new button, input or card class strings on a page.
- **Phone first.** Every tap target is at least 44 px high. Pages work at 390 px wide. Respect the safe areas (notch, Home indicator).
- **Calm.** Grey canvas, white surfaces, one accent colour (indigo). Colour means something: red is destructive or failed, green is done or on, amber is waiting.
- **Few words, plain words.** Short labels in sentence case. Section titles are nouns ("Sync", "Devices").
- **Accessible by default.** Every control has an accessible name. Keyboard works everywhere (Tab, arrows in groups, Esc closes). Focus is always visible.
- **Light and dark.** The app follows the system setting (`prefers-color-scheme`). Use the colour roles below and dark mode comes for free.

## Tokens

Defined in `src/index.css` with Tailwind v4 `@theme`. Each is a CSS variable (`--color-surface`) and a utility (`bg-surface`, `text-fg-muted`, `border-border`).

### Colour roles

| Role | Use | Utilities |
| --- | --- | --- |
| `canvas` | Page background behind groups | `bg-canvas` |
| `surface` | Cards, grouped lists, inputs | `bg-surface` |
| `surface-raised` | Sheets and dialogs | `bg-surface-raised` |
| `fill` | Secondary buttons, segmented track, pressed rows | `bg-fill` |
| `border` | Hairlines and outlines | `border-border`, `divide-border` |
| `fg` / `fg-muted` / `fg-subtle` | Text: main, secondary, hints and chevrons | `text-fg`, `text-fg-muted`, `text-fg-subtle` |
| `accent` (+ `accent-hover`, `accent-soft`, `accent-fg`, `on-accent-soft`) | Primary actions, links, selection (indigo) | `bg-accent text-accent-fg`, `text-accent`, `bg-accent-soft text-on-accent-soft` |
| `danger` (+ `-soft`) | Delete, sign out, errors | `text-danger`, `bg-danger-soft` |
| `success` (+ `-soft`) | Done, switched on | `text-success`, `bg-success` |
| `warning` (+ `-soft`) | Waiting, needs attention | `text-warning`, `bg-warning-soft` |

Calendar source colours stay as they are (they are data, not roles). A typed note's writing surface is `.ah-note-page` (paper on the canvas); `.ah-note` styles the note's prose.

Dark values are set under `@media (prefers-color-scheme: dark)`. A subtree can force a scheme with `data-theme="dark"` or `data-theme="light"` (the design kit does this). Older `dark:` utilities still follow the system setting.

### Type scale

System font: SF Pro on Apple devices (`-apple-system`), Segoe UI on Windows.

| Token | Size | Use |
| --- | --- | --- |
| `text-title` | 30 px bold | Page titles (PageHeader) |
| `text-headline` | 17 px semibold | Sheet titles, empty-state titles, emphasised rows |
| `text-body` | 16 px | Rows, fields, reading text |
| `text-footnote` | 13 px | Subtitles, section titles, small buttons |
| `text-caption` | 12 px | Chips, hints, error text |

### Radius and spacing

- `rounded-control` (10 px) for buttons and fields, `rounded-card` (14 px) for cards and grouped lists, `rounded-sheet` (20 px) for sheets.
- Spacing follows Tailwind's 4 px grid. Page gutters: `p-gutter` (16 px, phone) and `p-gutter-wide` (32 px, desktop). `size-touch` / `min-h-touch` is the 44 px touch target.

## App shell

- **Phone** (< 768 px): top bar with the brand (or the page title once scrolled), sync status, Calendar and Settings; bottom tab bar Capture, Today, Inbox, Library, Insights with an Inbox count badge.
- **iPad** (768–1279 px): sidebar plus one pane. **Desktop** (≥ 1280 px): sidebar, pane and the Today side panel.
- Every page is a `Page` (from `src/app/Page.tsx`): a 768 px reading column (`wide` for the calendar) topped by a `PageHeader`. Page gutters come from the shell's `<main>`; pages add no outer padding.

## Components (`src/ui/`)

| Component | Use it for | Notes |
| --- | --- | --- |
| `PageHeader` | The top of every page: large title, optional back link, actions on the right | On the phone the title moves into the top bar once scrolled away (`CompactTitleContext`) |
| `Section` | A titled block of a page ("Account") | Holds a `GroupedList`, a `Card` or free content |
| `GroupedList` + `ListRow` | Settings, menus, lists of things to open | Row: leading icon, title, subtitle, trailing value or control, chevron. `to` = link, `onClick` = button. `GroupedListItem` holds free content (a form) |
| `Card` | Free-form content on a surface | `flush` removes padding |
| `Button` | Every text button | `primary` (one main action per view), `secondary`, `plain`, `destructive`; sizes `sm` (32 px with a mouse, 44 px on touch screens), `md`, `lg` (full width); `loading`. `buttonClasses()` gives a `Link` or a file-input label the same look |
| `IconButton` | Icon-only actions (close, more, back) | `label` is required and becomes the accessible name |
| `Chip` / `Badge` | Status labels, filter toggles; count bubbles | A chip with `onClick` is a toggle with `aria-pressed`. Badges are hidden from screen readers |
| `SegmentedControl` | Two to five exclusive choices (Day / Week / Month) | A radio group; arrows, Home, End |
| `Sheet` | Forms and details over the page | Bottom sheet on the phone, centred dialog from iPad width; focus trap, Esc, backdrop and Close button close it, focus returns |
| `EmptyState` | A list or page with nothing in it | Title, one sentence, optional action |
| `Toast` | Short confirmation with one action (Undo) | `role="status"`, dismisses itself after 8 s |
| `TextField`, `TextArea`, `Select` | Labelled form fields | `hint` and `error` are wired to `aria-describedby`; error sets `aria-invalid` |
| `Toggle` | On/off settings | `role="switch"`, label on the left |
| `ToolButton` | Editing toolbars (note formatting, ink tools) | Quiet until pressed (`pressed` sets `aria-pressed`); 32 px with a mouse, 44 px on touch |

### When to use which

- A list of things to tap → `GroupedList` + `ListRow`, not a stack of cards.
- A setting that is on or off → `Toggle` in a `GroupedListItem`.
- A choice between views → `SegmentedControl`; a choice from a long list → `Select`.
- Something to fill in without leaving the page → `Sheet`.
- Confirmation after an action → `Toast`; an error the person must read → inline text with `role="alert"`.
- Nothing to show → `EmptyState`, never a blank page.
- A list of things to act on (captures, suggestions, tasks) → one `GroupedList` under a `Section`, each row with its title, a footnote line and a row of `sm` buttons; not a stack of tinted cards.
