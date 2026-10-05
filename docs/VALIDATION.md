# Validation — AI Leak Guard Public 0.1.0

Executed 5 October 2026. These results come from this edition's current source and packages. The Node suite used official Node 24.21.0.

| Check                     | Result                          | Scope                                                                                                                                                                                   |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node tests                | 301 passed, no failures/skips   | Domain boundaries, detector/corpus integrity, restoration, edition policy scope, worker lifecycle, send races, guard/draft transfer, rich-editor acceptance and release-source checks   |
| Corpus                    | 24,517 records verified         | 20,521 positive cases matched expected spans; 3,996 negative controls unchanged; 43 categories                                                                                          |
| Chromium checks           | 23 passed                       | UI/worker checks plus seven installed-extension tests, including native Enter/click/form blocking, original draft import, real ProseMirror acceptance/rerenders and private restoration |
| WebKit checks             | 16 passed                       | Modal controls, local worker, policy capability, support export, layout and edition UI; enabled Safari extension runtime is separate                                                    |
| Provider catalog          | 30 services / 46 exact hosts    | Installed native-send guards checked on one controlled host fixture per service, not authenticated live service certification                                                           |
| Firefox package lint      | 0 errors, 0 notices, 0 warnings | Generated Manifest V3 package and bundled runtime                                                                                                                                       |
| Firefox runtime           | Not verified on this host       | Included Linux CI is configured to run Firefox UI tests; first remote run remains pending                                                                                               |
| Safari native project     | Build succeeded unsigned        | Generated distinct app/extension identity; macOS Debug compile with CODE_SIGNING_ALLOWED=NO                                                                                             |
| Browser/source ZIP checks | Passed                          | Edition names/versions, permission scope, MIT/Apache notices, source allowlist, matching generated files and SHA-256 checksums                                                          |

Browser checks were split into the UI group (Chromium and WebKit) and installed extension group (Chromium). 39 browser checks passed in total. Public-specific checks prove that advanced JSON controls are absent, curated provider choices persist, unsupported managed policy fails closed and stored/saved custom hosts or label hints are rejected. Generated host permissions match only the 46 curated hosts.

Corpus success measures agreement with saved synthetic/reserved/sandbox fixtures, not real-world detection accuracy. Phone metadata covers 245 regions; the fixture corpus exercises a subset of real numbering formats. No real employee/customer database is included.

Browser extension checks use controlled HTML pages under configured provider hostnames. Real, pinned ProseMirror exercises accepted editor model text and rerenders. These are not authenticated ChatGPT/Claude sessions. Actual uploads, account-specific interfaces, streaming/navigation and provider changes still require live acceptance checks. No signing, browser-store publication or enabled Safari runtime test was performed.

Support JSON tests exclude original values, placeholder tokens and transfer identifiers. Local scanning and restoration remain inside the extension; neither licensing nor a remote scanning component is present.

Repeat on a machine with working browser binaries:

```sh
npm ci
npm run verify
npm run release:check
npx playwright install chromium firefox webkit
npm run test:ui
```

On this host, UI and installed-extension groups ran separately:

```sh
npm run test:ui -- tests/browser/interface.spec.js tests/browser/choice-controls.spec.js tests/browser/workspace-connection.spec.js --project=chromium --project=webkit
npm run test:ui -- tests/browser/extension.spec.js tests/browser/rich-editors.spec.js --project=chromium
```

Use `npm run build:safari` on macOS with Xcode. Configure real bundle identities and signing before distribution. Source repository: [https://github.com/Wagner-A-S/ai-leak-guard-public](https://github.com/Wagner-A-S/ai-leak-guard-public). Local verification is recorded above; remote CI results are available through repository Actions. Signed store releases remain separate operator steps.
