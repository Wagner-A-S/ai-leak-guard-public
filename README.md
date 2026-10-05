# AI Leak Guard Public

An MIT-licensed desktop browser extension for checking AI prompts locally. Compose in the private workspace, review the sanitized text, send placeholders to a configured AI page, and restore known placeholders only in the extension's private response view.

This repository is `ai-leak-guard-public`, version **0.1.0**. It is a smaller open-source edition of AI Leak Guard. Source repository: [https://github.com/Wagner-A-S/ai-leak-guard-public](https://github.com/Wagner-A-S/ai-leak-guard-public). Browser-store publication and signed distribution remain separate steps.

## Editions

| Capability                                                    | Public      | Corporate   | Original commercial project                             |
| ------------------------------------------------------------- | ----------- | ----------- | ------------------------------------------------------- |
| Local rules, private redaction/restoration, synthetic samples | Yes         | Yes         | Yes                                                     |
| Curated provider configuration                                | 30 services | 30 services | 30 curated plus directory entries                       |
| Personal detection controls and custom terms                  | Yes         | Yes         | Yes                                                     |
| Administrator-managed policy and custom exact hosts           | No          | Yes         | Yes                                                     |
| Advanced policy JSON and literal accessibility hints          | No          | Yes         | Yes                                                     |
| Vendor licensing service and entitlement SDK                  | No          | No          | Separate foundation; browser onboarding/billing pending |

The two open-source editions intentionally reduce integration and administration scope while preserving the same local detector and guarded send checks. The original `ai-leak-guard` project is retained separately. No activation key, paid service, account or subscription is required to use these editions.

Public provides personal detection settings, a searchable phone-region modal, custom redaction/block terms and the curated provider catalog. Arbitrary provider hosts, advanced policy JSON and company-managed configuration are outside this edition. An installed managed policy is rejected rather than silently downgraded to personal settings.

## Use the private workspace

1. Open a configured provider page and click the extension icon.
2. Type the original message in the private workspace, or import TXT, CSV, Markdown or JSON text up to 1 MB.
3. Select **Check & redact** and review the preview, including private details that the detector may have missed.
4. Select **Send sanitized message**. Only the reviewed text is placed in the current provider composer.
5. Read the provider response in the private response view, where known placeholders are restored. Keep the workspace open for the conversation.

A guarded native Enter, Send click or form submission opens **Review before sending**. Choosing **Open private workspace** imports the blocked draft, preserving line breaks. It requires a new local check and a separate sanitized send. The rich-editor adapter preserves paragraphs and verifies placeholder identity; a changed draft, ambiguous controls, unsupported attachments or an unavailable guard keep the handoff blocked.

Original text already pasted into an AI website can be read by that website before sending. Start with the private workspace. Restored originals are never inserted into the provider page. The restoration map lives only in worker memory; closing, refreshing or clearing the workspace loses it. Response refresh runs automatically for three minutes after a send and can also be requested manually.

## Build and install

Use Node 24 LTS. The lockfile pins dependencies. From this project directory:

```sh
npm ci
npm run samples
npm run verify
npm run release:check
npm run preview
```

The preview opens at `http://127.0.0.1:8767/admin.html`. It uses a separate local settings store and cannot send to provider tabs. `npm run build` produces browser folders under `dist/`, browser/source ZIPs under `releases/` and SHA-256 checksums. Regenerating samples is offline and deterministic. `npm ci` automatically creates `data/positives.json` from the reviewed recipes. The generated file stays local and is included in browser/source packages; its manifest and hashes remain in Git.

| Browser                                          | Development package                       | Installation                                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome, Edge and other Chromium desktop browsers | `ai-leak-guard-public-chromium-0.1.0.zip` | Extract; enable developer mode in the extension manager; load the folder containing `manifest.json` as unpacked. A source build uses `dist/chromium`. |
| Firefox desktop                                  | `ai-leak-guard-public-firefox-0.1.0.zip`  | Open `about:debugging#/runtime/this-firefox`, choose Load Temporary Add-on and select `dist/firefox/manifest.json`.                                   |
| Safari on macOS                                  | `ai-leak-guard-public-safari-0.1.0.zip`   | Web Extension source. Run the Safari conversion script on macOS with Xcode, then build and enable the app extension.                                  |

Install one AI Leak Guard edition per browser profile. Disable or remove an earlier edition before testing this package; separate profiles can be used to compare editions.

These are desktop development builds. Firefox's temporary installation is not an ordinary signed release. Safari requires Apple's wrapper and distribution signing. Browser-store submission, publisher identities and authenticated live-provider testing have not been completed by creating this repository.

For browser checks:

```sh
npx playwright install chromium firefox webkit
npm run test:ui
```

For Safari conversion on macOS with Xcode:

```sh
npm run build:safari
```

The generated project is under `safari/`. Choose the generated app scheme in Xcode, configure your own bundle identifiers and signing team, build the app and explicitly enable its Safari extension. An unsigned compile validates buildability, not Safari runtime behavior.

## Local detection and saved samples

The shared detector has **46 local rules**, including phone numbers, email, names and addresses, payment/banking data, contextual identity numbers, birth dates and credential shapes. Phone parsing uses pinned offline metadata covering **245 regions**. Russia/CIS fixtures include RU, BY, KZ, UA, MD, AM, AZ, GE, KG, TJ, TM and UZ, with Cyrillic and selected local-language labels.

The saved corpus contains **24,517 synthetic, reserved or sandbox fixtures** across **43 categories**: 20,521 positive cases and 3,996 clean controls. It includes 9,757 phone cases. These are regression examples, not a database of real people's details or a measured real-world false-negative rate. The detector recognizes supported patterns and validators rather than searching the sample values for exact matches. Names, address layouts and national identifiers have documented heuristic/context limits.

Browse the local sample inspector and consult [sample provenance](data/SOURCES.md), [detector sources](src/core/detectors/SOURCES.md) and [validation scope](docs/VALIDATION.md). The scanner rejects invalid settings, oversized inputs and excessive findings instead of silently omitting checks.

## Settings and protection scope

Detection categories, local phone region and literal custom terms are configurable. Country and sample choices use searchable modals. Native dropdowns and browser alerts are absent. **Always redact** masks matching terms; **Never send** blocks a prompt containing configured terms.

Host access is limited to the exact curated HTTPS provider hosts in the generated manifest. A provider that moves to another hostname needs a reviewed code/catalog update. Personal settings cannot expand site access to arbitrary hosts.

Thirty curated services are configured, including ChatGPT, Claude, Gemini, DeepSeek, Grok, Perplexity, Copilot, GigaChat and Алиса AI. Exact host entries are configuration rather than a claim that thirty live services are leak-proof. See [provider coverage](docs/PROVIDERS.md).

The workspace reports an active guard only after checking its version, host and policy readiness. Sending stays disabled when protection is missing. Its explicit support-details download contains safe connection/version fields and excludes drafts, restored responses, custom terms, placeholders and transfer identifiers. There is no automatic support upload, telemetry, remote font/CDN or scanning service.

This extension does not cover every network transmission, unsupported document/image/audio formats, native apps, direct API calls, unconfigured sites, provider-script requests or inaccessible custom controls. Review the preview and test the real provider/browser combinations used in your deployment. Complete enterprise egress protection requires controls beyond a DOM extension.

## Maintain and contribute

See [architecture](docs/ARCHITECTURE.md), [release requirements](docs/PRODUCTION.md), [contribution instructions](CONTRIBUTING.md), [security reporting](SECURITY.md) and [third-party notices](NOTICE.md). The maintained workflow is prepared for a standalone repository; its existence does not establish a successful remote CI run. Updates are rebuilt extension packages, with no remote executable code loaded at runtime.

The project is licensed under [MIT](LICENSE). Third-party phone implementation/metadata notices remain in `vendor/`.
