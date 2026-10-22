# Product

## Register

product

## Users

Developers reviewing immutable local Git changes and exchanging explicit feedback with coding agents. Dispatch's first self-hosting use case is reviewing this repository's own changes.

## Product Purpose

Make source review, line comments, native Pi inspection and explicit feedback submission dependable. Rust owns snapshots and the request/result boundary; Ferropi owns native Pi sessions. Opening or hiding a window must never publish feedback.

## Brand Personality

The user's stated priorities are fast reopening, native desktop behavior and readable text. Preserve the existing review surface rather than introducing a new visual identity or decorative redesign.

## Anti-references

Avoid starter-framework branding, macOS-only typography that renders poorly on Linux, tiny rough labels at 150% Wayland scaling, focus-stealing background deliveries, and interfaces that silently discard unfinished feedback.

## Design Principles

- Preserve drafts, navigation and immutable snapshot identity across window lifecycle changes.
- Keep background delivery quiet and explicit submission separate from saving state.
- Prioritize fast repeat opens; release the separate GUI process after 30 hidden minutes while the single tray remains.
- Measure native rendering and memory rather than infer them from binary size or framework mount callbacks.
- Preserve the code editor's monospace typography and established interaction patterns when changing UI typography.

## Accessibility & Inclusion

Legibility at the user's 1.5× Linux display scale is an explicit requirement. Retain keyboard interactions, focus visibility, reduced-motion support and browser zoom. No formal conformance level has been specified.
