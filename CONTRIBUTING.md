# Contributing to AI Leak Guard Public

Use Node 24 LTS and install the lockfile dependencies with `npm ci`, which generates the offline positive corpus from the committed recipes. If installation scripts are disabled, run `npm run samples` before testing or building. Keep detection and redaction in `src/core/`; browser, DOM, storage and UI code belong in the adapters and views. Do not import saved samples or build tooling into the runtime scanner.

Before requesting review:

```sh
npm run format:check
npm test
npm run build
npm run lint:firefox
npm run release:check
npm run test:ui
```

Install the Playwright browsers first with `npx playwright install chromium firefox webkit`. Safari conversion and enabled-extension testing require macOS with Xcode. Record unavailable checks and the actual browser versions used instead of describing them as passing.

Detection changes need independent invented/reserved/sandbox positive examples and clean negative controls. Never add real employee, customer, subscriber, credential or production account details to fixtures, screenshots, logs or issues. Document the matching method and known gaps, regenerate samples with `npm run samples`, and review changed counts and hashes.

Provider changes must name exact hosts with source provenance and distinguish controlled fixtures from authenticated live acceptance. Cover native Enter, click/form sends, rich-editor updates, disabled controls and attachments. Keep DOM discovery based on semantic tags, accessible text and form relationships; do not introduce CSS selector adapters or native alert/confirm/prompt dialogs.

Preserve the reviewed-send boundary, private restoration, cancellation checks and failure behavior. Reducing configuration scope must not silently disable detection or reinterpret an installed policy. Include a concise explanation of the behavior changed and evidence that the outgoing text contains only the reviewed draft.

Do not commit signing credentials, private keys, personal records, databases, activation files or environment secrets. Follow `NOTICE.md` for third-party attribution. Source contributions should be submitted under the project's MIT license; no contribution agreement or automated public submission is configured here.
