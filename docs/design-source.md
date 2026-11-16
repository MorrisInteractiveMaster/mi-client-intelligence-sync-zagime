# Approved design source and adaptation

DashboardUploadNov13.zip SHA-256: ce87da2b42ddc084c56f94685d48fdb28bfb3b8d9573324380fa2106a7e60bc6. User explicitly approved reuse, Nordic Minimal, and Dots.

Source archived verbatim under docs/design-source/prototype; synthetic fixtures copied without changing source values. Fonts retain their supplied licenses; existing app fonts remain locally bundled. Nordic tokens, typography, spacing, cards and hierarchy were adapted into React; charts/shell/model were inspected as references, not adopted as authoritative domain contracts. The selected canvas engine, Dots renderer and sound synthesis are reused under public/recap, with decimal formatting, synthetic labeling and cache identity corrections. The original review UI is replaced by React's accessible dialog/control shell; sound defaults off.

The snapshot data passed to the Dots renderer is derived from the same project(state) projection as the dashboard, using stable internal agreement IDs as display grouping keys. No work-order or people names are parsed at runtime. The renderer is limited to delivered-hour summaries; manual progress is independent. Source statuses are not inferred from consumption.

Supplied fixture discrepancy: the handoff says 23 quarter-hour entries; actual timeActivity.json has 11, each preserved as 900 seconds. All other tested published fixture totals match, including 593 entries, 1,054 hours, monthly 72/129/178/195/216/264, CDC 1,056.5 and variants 110/4041/961/940.
