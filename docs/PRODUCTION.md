# Release requirements

AI Leak Guard Public 0.1.1 is an open-source development/pilot edition. Locally preparing source and packages does not publish a repository, obtain browser-store approval or certify complete data-loss prevention.

## Evidence before distribution

| Area              | Implemented design                                                            | Remaining release evidence/setup                                                                             |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Prompt privacy    | Local scanner, memory-only vault, reviewed placeholders and guarded send flow | Realistic approved synthetic evaluation; documented false negatives; verify all advertised text import paths |
| Provider behavior | Native Enter/click/forms, bounded editor acceptance and rerender checks       | Authenticated live acceptance for each advertised provider/browser combination                               |
| Browser packages  | Separate Chromium, Firefox and Safari source builds                           | Current browser runtime tests, signed identities, store review and public install instructions               |
| Updates           | Reproducible scripts, source archive, checksums and standalone CI workflow    | Maintainer ownership, first remote CI run and tested signed-package update procedure                         |
| Deployment        | Personal settings and curated exact host permissions                          | Personal-site permissions and unsupported-managed-policy behavior on target browsers                         |
| Security/support  | Bounded adapters, safe local diagnostics and explicit failure paths           | Independent review, private reporting contact, incident/update process and support policy                    |

There is no licensing, billing, vendor activation endpoint or paid account system in this edition. Do not advertise those as available features. Third-party implementation/metadata licenses must accompany redistributed packages.

## Repeatable checks

Use Node 24 LTS on a clean checkout:

```sh
npm ci
npm run samples
npm run verify
npx playwright install --with-deps chromium firefox webkit
npm run test:ui
npm run release:check
```

On macOS with Xcode, also run `npm run build:safari`, compile the generated app and test the enabled extension. Select your own bundle identifiers and signing team before distribution. An unsigned compile does not prove runtime protection in Safari.

Test ordinary and rich editors, native Enter, click/form submission, attachments, disabled actions, composer rerenders, changed text, settings refresh, guard absence and navigation. A successful handoff must contain only the reviewed text and cause exactly one provider submission. Recoverable failures should preserve the draft.

## Deployment

For a personal pilot, grant access only to the curated sites you use, confirm the workspace reports the expected active host/version and review detection settings. This edition has no enterprise policy enforcement. If company-managed policy is installed, activation blocks rather than silently ignoring that policy; use the Corporate edition or remove the policy through the proper administrator process.

Original values should begin in the private workspace. DOM-event blocking cannot recall content already sent, prevent provider scripts reading their own page, or replace endpoint/network egress controls. Do not make a universal "leak-proof" claim from fixture success.

## Publication checklist

Publish the intended source repository and license, configure a private security-reporting contact, provide maintainer/support identity and a current privacy-policy URL, and submit the correct browser-specific package with matching source/rebuild instructions. Store/private-policy drafts are in [distribution documentation](distribution/STORE-LISTING.md).

Check [edition-specific validation](VALIDATION.md) and record unavailable browser checks explicitly. Configure signing/vendor accounts and perform actual runtime testing before public distribution; no store submission or hosting action is included in creating this source project.
