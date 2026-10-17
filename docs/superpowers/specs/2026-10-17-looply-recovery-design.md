# Looply Recovery and Reliability Design

## Intent

Restore the complete, currently missing Looply application tree into the official `looplyapp` repository without changing its observable product behavior, Supabase resources, Vercel project, GitHub Pages configuration, or production data. The existing public `soumoiss/Looply` deployment is a read-only behavioral reference, not a delivery target.

## Evidence and boundary

At the start of this work, `main` contains 24 blobs while the supplied recovery archive contains 124 files and the archive committed in the repository contains 179 entries. HTML entry points in `main` reference `assets/js`, `assets/css`, `src`, `scripts`, tests, Supabase migrations, and functions that are absent from the checkout. The `looplyapp` GitHub Pages URL returns 404; the historical Pages URL serves the referenced static assets.

This phase restores only files that are present in the supplied archive and required by existing root HTML/configuration. It does not upload media, invoke Supabase migrations, change RLS, provision users, set Vercel variables, link a Vercel project, or publish a deployment.

## Architecture

The recovered application retains native ES modules and one HTML entry point per product area. Page adapters in `assets/js/` mount feature modules in `src/`; shared page runtime, authentication, Supabase client setup, themes, profiles, social content, gallery, music, chat, archived letters, and administration remain separate modules. CSS remains split into shared app styles and per-page styles.

Supabase remains the authority for authentication, data, authorization, storage, and Realtime. The browser uses only the publishable configuration already supplied by `config.js`; privileged operations remain in the versioned Edge Functions. The YouTube lookup remains a Vercel server function, so static GitHub Pages can only call an already deployed external endpoint.

## Recovery rules

- Work only on `codex/recovery-foundation`; do not change `main`.
- Preserve all recovered paths and public HTML IDs/classes unless a later regression test proves a focused fix is needed.
- Do not copy credentials, service-role keys, database dumps, user data, or media archives into versioned source.
- Keep GitHub Pages and Vercel responsibilities separate.
- Treat failures caused by inaccessible Supabase/Vercel accounts as blocked verification, never as permission to simulate success.

## Validation

The initial validation gate is a local Node build and the archived test suite. Static checks verify that every root entry point resolves its local styles and module adapter and that package scripts have their referenced files. Browser, multi-account, RLS, Storage, Realtime, Vercel, and production deployment validation require separately authorized credentials or a preview environment.

## Rollout and recovery

After local validation, the branch is reviewed against `main`. A preview deployment may be requested only with explicit environment access and approval. Production remains unchanged until preview checks cover page navigation, signed media access, chat persistence, authorization boundaries, and configuration parity. Rollback is the existing production deployment plus the unchanged `main`; no irreversible database action is in scope.
