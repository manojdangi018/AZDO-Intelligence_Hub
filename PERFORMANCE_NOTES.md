# DevOps Intelligence - Performance Notes

This build preserves the existing workspaces and adds a faster pipeline fetch path.

## Pipeline optimization

The initial Pipeline Summary scan no longer calls `/build/builds/{id}` once for every run. The build-list response is used directly for branch, build number, trigger identity, queue time and result whenever those fields are available.

Individual detail loading remains deferred to the row-details workflow, so detailed information is fetched when the user opens a record instead of for every run during the initial scan.

The YAML Pipeline Runs fallback also uses the list response directly and defers per-run detail calls.

## Cache/versioning

JavaScript cache-busting versions were updated in `index.html` so browsers load this build after deployment.

## Validation

All JavaScript files pass `node --check` syntax validation.
