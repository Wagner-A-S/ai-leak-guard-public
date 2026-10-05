# Security reporting

AI Leak Guard Public 0.1.0 is a development/pilot build. GitHub private vulnerability reporting is the security-reporting route for this repository; no support service-level commitment is made.

Report potential data leaks using [GitHub private vulnerability reporting](https://github.com/Wagner-A-S/ai-leak-guard-public/security/advisories/new). Do not post actual personal data, production credentials, conversations or restoration tokens in public issues.

A useful report describes the affected version/browser, exact host, the action that bypassed protection and a minimal reproduction using invented values. Include whether the extension was enabled, had site permission and reported an active guard. Safe connection-details exports can help; review any attached file yourself before sharing it.

The private workspace, local scanner and reviewed handoff are the security boundary supported by this design. Data entered directly into a provider document may be read by its scripts before sending. The extension cannot cover direct API/native-app traffic, every attachment type, arbitrary programmatic network requests or a disabled guard. Corpus success is not evidence of complete real-world detection.

Maintainers should reproduce reports with synthetic data, preserve users' drafts during recoverable errors, and test changed editor/send behavior before producing updated packages. Do not publish an exploit containing live private values. Follow the release checks in `docs/PRODUCTION.md`; no automatic signing or store publishing is configured.
