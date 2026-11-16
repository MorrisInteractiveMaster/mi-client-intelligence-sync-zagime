# Milestone 2 QA

Chrome headless on local Vite, synthetic data only. Screenshots in this folder are actual captures, not generated mockups.

1440, 1366, 768 and 390 viewport widths: no document horizontal overflow; no browser errors. Project create without WO, 8h split into 5+3, unchanged source duration, over-allocation denial, Dots play/pause, Escape close and reduced-motion static presentation passed. browser-results.json records interaction checks. Desktop allocation and Dots screenshots included.

Not certified: full contrast audit, screen-reader walkthrough, production security, live integration, cloud residency or emulator behavior. Legacy presentation/screens use the retained model and have automated baseline regression coverage, not a new complete visual audit.

Final automated suite: 65/65 passing (45 unchanged baseline + 20 new). Typecheck and production build pass. Additional tests cover shared decimal projection, source-link identity, cap reserve revisions, invalid auxiliary references and normalized fixture input.
