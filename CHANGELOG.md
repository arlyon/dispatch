# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.3](https://github.com/arlyon/dispatch/compare/v0.1.2...v0.1.3) - 2026-10-26

### Added

- add native in-app review conversations

### Fixed

- share GitHub and local review counts across Waybar and macOS ([#12](https://github.com/arlyon/dispatch/pull/12))
- resolve desktop tools and refine review controls

## [0.1.2](https://github.com/arlyon/dispatch/compare/v0.1.1...v0.1.2) - 2026-10-26

### Added

- expose local review count for Waybar ([#6](https://github.com/arlyon/dispatch/pull/6))
- add signed Tauri updates for RPM and AppImage
- pin Linear and Confluence context to immutable reviews
- add native review quiz in the right panel

### Other

- Merge current main into linked review context
- Merge pull request #4 from arlyon/feat/card-keyboard-navigation
- Add focus-only Inbox card keyboard navigation
- integrate native tray with quiz review workflow

## [0.1.1](https://github.com/arlyon/dispatch/compare/v0.1.0...v0.1.1) - 2026-10-22

### Added

- integrate native macOS bird tray and app identity
- add resident tray and background review delivery
- add native review quiz in the right panel

### Other

- integrate native tray with quiz review workflow

## [0.1.0](https://github.com/arlyon/dispatch/releases/tag/v0.1.0) - 2026-10-22

### Added

- add native Linux packaging and automated desktop releases
- bootstrap local desktop review loop

### Fixed

- launch pnpm safely across native macOS builds

### Other

- consolidate native crates into dispatch workspace
