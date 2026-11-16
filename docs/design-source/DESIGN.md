# DESIGN.md: Zagimē Dashboard

Loose first draft. It holds only what we know for sure: logos, colours and fonts. Layout, chart style and how the colours get used are left open on purpose. We'll settle those after comparing four versions of the site, then tighten this file.

Internal only. All data in the designs is synthetic.

## Logos

| Logo | File | Notes |
| --- | --- | --- |
| Zagimē Anishinabēk, light-on-dark (main) | `zagime-main-logo.png` | 495 x 155 transparent PNG from zagime.ca. White wordmark with macrons, so use it on navy or other dark panels. Good for headers and sidebars, too small for a large hero. The thin black smoke lines nearly vanish on navy. |
| Zagimē Anishinabēk, on white (older) | `ZagimeGithub/public/branding/zagime/zagime.jpeg` | 833 x 368 JPEG on white. Missing the macrons. |
| Morris Interactive | `ZagimeGithub/public/branding/morris/MI Logo.png` | 2000 x 2000 PNG on white, no transparency. |

- Use the main logo on dark panels. Use the older JPEG and the MI logo on white or light areas, since both have white backgrounds.
- Rules for all Zagimē logos: use as one whole mark. Don't crop, recolour or pull out the pipe, feathers or sun as decoration.
- `ZagimeGithub/public/branding/morris/logo.png` is a different emblem. Dev's README says not to use it as the MI identity.
- Spelling is settled: **Zagimē Anishinabēk**, with macrons, as used on zagime.ca. The older logo file in the repo reads "Zagime Anishinabek" without them.
- Open: an SVG or larger PNG of the main logo would be nicer, but none is available for now.

## Colours

### Zagimē website (sampled from a zagime.ca screenshot, 10 November 2026)

The site uses navy and yellow as its main pair.

| Name | Hex | Where it appears |
| --- | --- | --- |
| Zagimē navy | `#01264F` | Wave band across the hero |
| Zagimē yellow | `#FFF33A` | Logo sun and the Members Portal button |
| Black | `#000000` | Text on the yellow button |

### Zagimē (sampled from the older logo file)

Approximate, because the source is a JPEG.

| Name | Hex | Where it appears in the logo |
| --- | --- | --- |
| Sun yellow | `#FEF102` | Sun |
| Maroon | `#721318` | "First Nations" text, pipe bowl |
| Pipe brown | `#7A5208` | Pipe stem |
| Near-black | `#1A1717` | "Zagime Anishinabek" text |

- Yellow text on white is unreadable. Use yellow as a fill with dark text on it.

### Morris Interactive (sampled from the logo file)

| Name | Hex |
| --- | --- |
| Teal | `#4FC3C1` |
| Blue | `#4388BD` |
| Pink | `#D26984` |

- Agreed direction: Zagimē branding with the MI logo. MI colours should stay secondary in the client view.

### Status colours (from Dev's prototype)

Status meaning should never depend on brand colour. These are the prototype's badge colours, kept as a starting point.

| Status | Background | Text |
| --- | --- | --- |
| On track | `#EDF5F0` | `#577D69` |
| Attention | `#FCF4E6` | `#AA8645` |
| Delayed | `#FBEFEB` | `#B27864` |
| Completed | `#EAF0F6` | `#657F9D` |
| Upcoming | `#F0EDF6` | `#8C7A9C` |

### Dev's prototype palette (reference only)

Dev's own colours, which his README calls illustrative: navy `#122E3B`, gold `#C1A365`, berry `#884466`, off-white background `#F5F5F0`.

## Fonts

| Use | Font | Source |
| --- | --- | --- |
| Headings and big numbers | Manrope Variable | `@fontsource-variable/manrope`, bundled locally |
| Body and labels | DM Sans Variable | `@fontsource-variable/dm-sans`, bundled locally |

- The prototype also uses Georgia for the Zagimē name in the sidebar.
- zagime.ca sets its hero title ("ZAGIMĒ ANISHINABĒK", "proud, united, resilient.") in a bold serif. The font name isn't confirmed.

## Known scope

- Client view is read-only. MI editing happens in a separate control panel.
- Screens to design: Overview, Projects, Team & contacts, and a short Presentation view.
- Works on phones as well as desktop.
- Reference: Dev's prototype source in `ZagimeGithub/` and screenshots in `ZagimeGithub/LiveScreens/`.

## Decide after the four versions

- How colour is used (dark or light structure, where yellow and maroon go)
- Layout and navigation
- Chart style
- Minimum text sizes and spacing
