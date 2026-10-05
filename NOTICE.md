# AI Leak Guard Public — notices

Version 0.1.0 is open-source software under the MIT license in `LICENSE`. The requested repository/package spelling `ai-leak-guard-public` is preserved. Source is maintained at https://github.com/Wagner-A-S/ai-leak-guard-public. Browser-store listing and signed distribution are separate release steps.

The local scanner and memory-only restoration vault do not use a remote scanning backend or telemetry. Reviewed sanitized text is sent only through a separately authorized handoff. The detector can miss sensitive content. Use the private workspace for originals and review every preview; provider scripts can read text entered into their page before any send action.

The saved regression samples are synthetic, regulator-reserved or official sandbox values. Their count and successful test matches do not establish accuracy for real personal data. See `data/SOURCES.md` and `src/core/detectors/SOURCES.md` for provenance and limitations.

Phone detection includes libphonenumber-js 1.13.14 by Nikolay Kuchumov under MIT, with numbering metadata derived from Google libphonenumber under Apache-2.0. The full third-party licenses and attribution are preserved in `vendor/libphonenumber.LICENSE`, `vendor/libphonenumber-google.LICENSE` and `vendor/NOTICE.md`. Those components retain their respective notices and license terms.

Development dependencies, including the ProseMirror editor fixtures, retain their upstream licenses and are recorded in `package-lock.json`. They are not distributed as runtime editor dependencies. The MIT license for this project does not replace third-party licenses.

The 30 provider entries identify exact configured hosts and source links; they are not a ranking, endorsement or a promise of authenticated live-provider compatibility. No directory-derived provider snapshots are included in these editions. Current edition-specific checks and their scope are recorded in `docs/VALIDATION.md`.
