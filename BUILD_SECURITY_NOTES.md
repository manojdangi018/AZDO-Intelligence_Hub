# AZDO Intelligence Hub — Protected static build

This build is intended for GitHub Pages/static hosting.

Changes:
- Original `js/` and `css/` source folders are removed from the deployable package.
- JavaScript formatting/indentation and full-line source comments are reduced while preserving script order and behavior.
- CSS is compacted.
- Local assets use content-hash-style filenames.
- No source maps are included.

Security limitation:
A browser must receive JavaScript to execute it, so client-side code can never be completely hidden from DevTools. This build is a deterrent against casual copying, not a security boundary. For real protection, move Azure DevOps API calls, PAT handling, and sensitive business logic to a backend. Never put secrets/API keys/PATs in frontend source or localStorage.
