# T032: Polish & Ship

## Summary

Final polish pass before v1.0 release. Onboarding wizard, auto-updater, code signing, performance audit, accessibility audit, documentation, and release.

## Acceptance Criteria

### Onboarding
- [ ] First-run setup wizard (5 steps: welcome, agent setup, workspace, pipeline, theme)
- [ ] Empty state designs for all views
- [ ] Onboarding tooltips (dismissible)

### Distribution
- [ ] Tauri updater plugin configured (stable + beta channels)
- [ ] macOS code signing (Apple Developer certificate)
- [ ] macOS notarization
- [ ] DMG installer with drag-to-Applications
- [ ] GitHub Releases as update source
- [ ] CI/CD: GitHub Actions for build + sign + release

### Quality
- [ ] Performance audit: <2s to interactive, <500KB JS bundle
- [ ] Accessibility audit: keyboard nav, screen reader, contrast ratios
- [ ] Memory leak check: run 5+ agents for 30 min, verify stable memory
- [ ] Cross-platform: macOS aarch64 + x86_64 (Windows/Linux stretch)

### Documentation
- [ ] README.md with screenshots, install instructions, quick start
- [ ] ARCHITECTURE.md
- [ ] CONTRIBUTING.md
- [ ] User docs: pipeline config, agent setup, keyboard shortcuts

## Dependencies

- ALL previous tickets

## Complexity

**L**
