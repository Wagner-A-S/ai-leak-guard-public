# Privacy notice draft — AI Leak Guard Public

This is publication copy describing version 0.1.0. Before hosting or submitting it, identify the actual publisher, privacy/support contact and publication date. A public hosted privacy-policy URL remains a browser-store release requirement. Security reports use GitHub private vulnerability reporting, linked in `SECURITY.md`.

## Local processing

The extension checks text locally. Original drafts, detected values and placeholder maps are not sent to a scanning service or maintainer. The restoration vault exists only in memory and is erased by session clear or loss of the private workspace session. Prompt/vault content is not persisted to extension settings or synchronized through browser sync.

Personal detection settings and custom literal terms are stored in browser extension settings. Provider access is limited to the curated exact hosts. Installed company-managed policy is unsupported and causes activation to block. The HTTP development preview uses its own separate local settings store and cannot send to provider tabs. Literal custom terms may themselves be sensitive; treat access to that browser profile and its settings appropriately.

## Provider sends

When the user chooses a reviewed send, the selected provider receives the sanitized prompt. It handles that content under its own privacy policy and terms. Text already entered directly into a provider document can be read by that page before sending; begin with the private workspace. Restored originals are displayed only in the extension's private view.

## Diagnostics and external services

A user can explicitly save safe support details locally: extension version, connection/protection state, policy mode and editor/action readiness. The export excludes drafts, restored responses, detected values, placeholders, term lists, conversation URLs, tab references and transfer identifiers. The application does not automatically upload it.

This edition has no licensing/activation service, billing system, account backend, analytics SDK, advertising tracker, remote font/CDN or remote scanning endpoint. Updates are rebuilt browser packages; no remote executable code is downloaded by the extension. Browser/store update mechanisms and providers remain governed by their own services.

The saved detection corpus uses synthetic, reserved and sandbox fixtures with recorded provenance. No personal records are harvested for it. Detection limitations and verification scope are in `docs/VALIDATION.md`; this draft makes no compliance or certification claim.

Contributors and maintainers must not add real private records or credentials to public issues, fixtures or screenshots. Use the private security-reporting route in `SECURITY.md`.
