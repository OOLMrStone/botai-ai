# Independent frontend dependency security review

2026-10-05. Bounded review of the authorized frontend dependency update; product code and Git were not changed. Existing integration/security/persistence/UI findings were not reopened. Scope: local/private isolated mock staging, not public production approval.

**Repository and isolated-runtime dependency gate: PASS.** Independent final `npm audit --omit=dev --package-lock-only --json` returned exit 0 and **0 advisories**. The actual rebuilt local ARM and private-stage x86 inventories below confirm the patched runtime. Final rendered browser acceptance remains a separate pending gate.

## Reviewed source and primary advisories

- `next` and `eslint-config-next`: 16.2.10 → **16.3.8**, with matching Next platform packages. Primary Vercel advisories confirm [AVIF optimizer RCE patched in 16.3.3](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4) and [Node next/og ImageResponse RCE patched in 16.3.6](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j). The [16.3.8 release](https://github.com/vercel/next.js/releases/tag/v16.3.8), published September 30, also includes newer SSRF/cache fixes. This is range/registry validation, not an exploit reproduction.
- Resolved runtime-related transitives now include sharp **0.35.5**, PostCSS **8.5.23**, nanoid **3.3.19**, and an exact baseline-browser-mapping **2.11.0** override. Independent audit of the intermediate lock found the remaining baseline moderate advisory; the final override closes it.
- `shadcn` stays at **4.13.0** and moves to devDependencies. Source search found its only application import is `@import 'shadcn/tailwind.css'` in globals.css. CSS is consumed at build time; the Docker build installs dev dependencies before creating standalone output. This classification change alone is not proof of image exclusion: the physical inventory gate below owns that proof.
- No direct dependency addition, major downgrade, `audit --force`, or stack replacement. Existing supply-chain overrides keyv 4.5.4, flat-cache 4.0.1, file-entry-cache 8.0.0 are preserved.

## Lockfile and install protection

Final reviewed SHA-256: package.json `60dd0bdab93a467968186f8cc7b8c299cb512ca8bae1640ab5b202b2ce957c9b`; package-lock.json `6de7c7a5d5f4bc7df0ed49511ade45aeea5cba865f210962bd8f44736e888b65`.

Lockfile v3 root dependency declarations match package.json. All **705 independently fetched package entries** resolve to HTTPS registry.npmjs.org and have SHA-512 integrity. The other **6 entries** are explicitly `inBundle` dependencies within @tailwindcss/oxide-wasm32-wasi and inherit the containing tarball's integrity. No file/Git/alternate-registry resolution was introduced. Compared with HEAD, shared paths have no version downgrades.

`.npmrc` retains `ignore-scripts=true`; Dockerfile copies it before `npm ci`. Docker runtime copies only standalone/static/public, runs as node, and retains its pinned base-image digest. Independent node_modules scan found **no setup.mjs, Math_Symbol.js, bun_environment.js or preinstall declarations**. Postinstall declarations are the expected unrs-resolver hook and a resolve package's nested test fixture (`resolve/test/resolver/multirepo/package.json`, `lerna bootstrap`), not another installed package lifecycle hook; scripts remain disabled. This is a marker check, not a complete malware attestation. Frontend owner independently reports clean `npm ci` with scripts ignored and the same marker/fixture result; build gates are still running and belong to that owner.

## Accurate audit scope and residual exposure

Evidence: ignored `runtime/evidence/frontend-dependency-review-prod-audit.json` and `frontend-dependency-review-full-audit.json`. The historical `frontend-runtime-audit.json` is the pre-update 20-findings baseline, not final evidence.

- Production lock graph: **0 critical/high/moderate/low**. Audit metadata reports prod 36, dev 638, total 711; optional 95 overlaps other classifications and must not be added to the total.
- Full build/development graph: **17 findings, 14 high + 3 moderate, no critical**. All 21 affected lock nodes are explicitly dev-only. Names: @hono/node-server, @next/eslint-plugin-next, @ts-morph/common, brace-expansion, braces, browserslist, eslint-config-next, fast-glob, fast-uri, hono, ip-address, js-yaml, micromatch, qs, shadcn, ts-morph, undici. npm counts affected package groups, not distinct exploitable application defects.
- These are not dismissed as harmless: malicious build inputs, CLI registries/configuration or developer tooling execution can reach vulnerable code. The retained unpatched [braces deeply nested pattern DoS](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) propagates through glob/CLI/lint chains. npm's proposed shadcn 1.0.0 and eslint-config-next 14.2.35 major downgrades are not acceptable minimal security fixes. Compatible dev transitive maintenance remains follow-up work, not a blocker for this isolated runtime gate. Avoid untrusted build/CLI inputs; ignore-scripts does not prevent code deliberately executed by build/lint commands.

## Runtime handoff and gate

Before rebuild, independent read-only inspection found **20 named/versioned package manifests** under the old local standalone node_modules, including Next 16.2.10 and sharp 0.34.5. This demonstrates why audit graph counts must not be called installed-image counts.

Final runtime evidence reviewed: ignored `runtime/evidence/local-frontend-package-inventory.json` and `stage-frontend-package-inventory.json`. Both rebuilt images have **23 named/versioned manifests, 23 unique name/version pairs**, Next **16.3.8**, sharp **0.35.5** and libvips **1.3.4**. ARM versus x86 platform package differences are expected. The reviewer independently inspected the live local container: healthy, UID 1000, matching Next/sharp versions. Runtime owner captured the native-stage inventory and image identity, confirmed healthy, successful builds, complete same-origin API smokes and repeated shared-cookie-jar origin isolation on both patched frontends.

| Runtime | Image ID |
|---|---|
| Local ARM64 | `sha256:6ee1fec09c63947b2ab6ff8d2bd942e810f766dec23392a88b7c167c077b81bc` |
| Private stage AMD64 | `sha256:d04ded24771affd8b07cc293515e200703fc662d6f4256acbf88f39aa19baa8b` |

Both correspond to the runtime-verified approved 478-path source digest `b63975290568371e0bded79a5f34a99c550037d59d3c1360fc9e9f32004c8f61` (`frontend-final-manifest.json` local and stage). Neither inventory contains named/versioned shadcn, braces, micromatch, fast-glob, ESLint, Hono, undici or ts-morph package entries. Embedded/compiled Next dependencies without versioned manifests and OS packages are not completely represented, so neither this inventory nor npm audit is a full SBOM or a zero-image-CVE claim.

This update closes the reviewed npm production advisories at source. The remaining build-tool advisories and previously documented public deployment gates remain explicit; no public production or paid AI service was touched.
