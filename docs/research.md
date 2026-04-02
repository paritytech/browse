# Case Study: Apple App Store & Google Play

Research reference for the [App Store Protocol Specification](app-store-protocol.md).

---

## Apple App Store

Apple operates a single, centralized store where all app distribution flows through Apple's servers. Key characteristics:

- **Closed submission**: Developers submit apps for review. Apple's review team approves or rejects each submission before it becomes visible to users. Reviews can take hours to days.
- **Code signing**: Every app binary is signed by a developer certificate issued by Apple. Installing unsigned code is not permitted on iOS (outside of specific developer/enterprise modes). Apple can revoke certificates at any time, rendering previously-distributed apps unrunnable.
- **Centralized metadata**: App names, descriptions, screenshots, and ratings are all stored in Apple's databases, not on the app itself. Apple controls what is displayed and can modify or remove listings.
- **Ratings and reviews**: Users submit 1–5 star ratings and text reviews. These are moderated by Apple and stored centrally. Ratings can be reset by Apple (e.g., after a major app update). Developers cannot respond to reviews in a verifiable way.
- **Revenue**: Apple takes a 15–30% commission on all paid apps and in-app purchases.

### Publishing Lifecycle — Apple App Store

**From the developer's perspective:**

1. **Enroll** in the Apple Developer Program ($99/year). Legal entity verification required for organizations.
2. **Build and sign** the app locally using Xcode. The binary must be signed with a certificate issued by Apple through their provisioning portal. Debug and distribution certificates are separate; the wrong one will be rejected.
3. **Prepare metadata** in App Store Connect: app name, subtitle, description, keywords, screenshots (multiple sizes required per device class), privacy policy URL, age rating questionnaire, and pricing. Screenshots are not validated against the actual app at submission time but may be flagged in review.
4. **Submit for review** via App Store Connect or `altool`/Xcode Cloud. The app enters a review queue. Wait time ranges from 24 hours to several days, with no visibility into queue position.
5. **Respond to rejection** if Apple's reviewer finds a guideline violation. Rejections arrive as messages in App Store Connect. Common reasons: missing privacy policy, use of private APIs, misleading metadata, crashes during review, insufficient demo account credentials. Developers appeal via a Resolution Center; escalation to the App Review Board is possible but slow.
6. **Release** once approved: either immediately or at a scheduled date. Apple signs the final binary with their own certificate before it reaches end users.
7. **Update** by repeating steps 2–6. Minor updates go through the same review queue. Expedited review can be requested for critical bug fixes (not guaranteed).
8. **Accept takedowns** if Apple removes the app — for policy violations, government requests, or expiring certificates. Developers are notified by email. The app disappears from all devices' purchase history if Apple chooses. There is no appeal window for some removal categories.

**From Apple's perspective (the reviewer):**

1. An automated pre-screening pipeline runs on submission: binary analysis for private API usage, entitlement checks, basic crash detection on simulators, metadata text scanning.
2. A human reviewer is assigned from Apple's review team (distributed across time zones). They install the app on a device or simulator, exercise the main user flows, and verify compliance with the App Store Review Guidelines (~200 rules covering content, functionality, business model, and privacy).
3. The reviewer checks that metadata accurately represents the app's actual behavior, that required capabilities (e.g., location, camera) are justified by the app's stated purpose, and that in-app purchases use Apple's payment system where required.
4. If a violation is found, the reviewer writes a rejection note citing the specific guideline and optionally attaches a screenshot. The app is not approved until all cited issues are resolved.
5. Post-publication, Apple monitors for user reports, regulatory pressure, and automated signals. An app can be removed at any time without a separate review cycle.

---

## Google Play

Google Play is structurally similar to the App Store but with notably weaker enforcement at the edges:

- **Semi-open submission**: App submission is automated and faster (hours rather than days), with post-hoc review supplemented by automated scanning. Android also permits sideloading (installing APKs directly), giving users an escape hatch Apple does not.
- **Code signing**: Apps are signed by the developer's key. Google Play App Signing optionally lets Google manage the signing key, giving Google the ability to resign and re-distribute updated binaries.
- **Metadata ownership**: As with Apple, all metadata is in Google's systems. Google can remove apps, suppress search results, or modify listings.
- **Ratings and reviews**: User-submitted, moderated by Google, stored centrally. Not portable across stores.
- **Revenue**: 15–30% commission, same as Apple.

### Publishing Lifecycle — Google Play

**From the developer's perspective:**

1. **Register** a Google Play developer account ($25 one-time fee). Personal or organization. Identity verification required since 2023.
2. **Sign the APK or AAB** with your own private key. Since 2021, new apps must use Android App Bundle (AAB) format. Optionally enroll in Play App Signing, where Google re-signs the final APK with a key they manage (adds Google as a co-signer).
3. **Prepare the store listing** in the Play Console: app name, short/long description, screenshots, feature graphic, content rating questionnaire (IARC), privacy policy, and data safety form (declaring what data the app collects and how it's used — this is self-reported and publicly displayed).
4. **Submit for review** by publishing to a track: Internal (instant, up to 100 testers), Closed Testing, Open Testing, or Production. Production submissions enter a review queue, typically resolved within hours to a few days for new apps; faster for updates.
5. **Respond to rejection** via the Play Console inbox. Google's rejection messages tend to be less specific than Apple's. Common reasons: metadata misrepresentation, policy violations (especially financial/health apps), permissions abuse, SDK policy violations (e.g., ad SDKs violating children's policy).
6. **Release** by promoting from a track to Production, optionally using staged rollouts (e.g., 1% → 10% → 100%) to limit blast radius of regressions.
7. **Update** by uploading a new AAB to any track and promoting it. Incremental updates (diffs) are handled automatically by Play's delivery infrastructure.
8. **Accept takedowns** — Google can remove apps for policy violations, government requests, or automated malware detection. Unlike Apple, sideloading means users can still install the APK directly if they have a copy, though Play Protect may warn against it.

**From Google's perspective (the reviewer):**

1. Automated pipelines dominate: static analysis, permission audits, APK scanning for known malware signatures, policy text matching against app metadata. Google's scale means most of the review burden is automated.
2. Human review is triggered for flagged submissions: financial services, apps targeting children (COPPA), VPN apps, apps requesting sensitive permissions, and new developer accounts. High-risk categories (health, finance, government) require additional verification.
3. The data safety section is self-reported; Google does not technically verify it against the APK at submission time, but mismatches found later can result in removal.
4. Post-publication, Play Protect scans installed apps on Android devices in real time and can remotely disable or remove apps flagged as harmful — even outside of Play.
5. Reviewer actions (warnings, suspensions, terminations) are communicated via the Play Console and appeal tickets. Account-level bans are harder to appeal than individual app removals.

---

## Comparison

| Property | Apple App Store | Google Play |
|----------|----------------|-------------|
| Submission approval | Required, human review | Required, mostly automated |
| Review time | 24h – several days | Hours – few days |
| Who controls metadata | Apple | Google |
| Code signing | Apple-issued certificate | Developer key (optionally Google-managed) |
| Ratings storage | Apple's servers | Google's servers |
| Ratings portability | None | None |
| Platform commission | 15–30% | 15–30% |
| Sideloading | Not permitted (iOS) | Permitted (Android) |
| Remote disable/revoke | Yes (certificate revocation) | Yes (Play Protect) |
| Takedown appeal | Resolution Center / App Review Board | Play Console tickets |
| Rejection transparency | Private message to developer | Private message to developer |
