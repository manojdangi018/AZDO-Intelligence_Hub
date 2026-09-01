# Phase 4 — UX Improvements

Implemented on top of the verified Phase 3 Status baseline.

## Included

1. Global search across loaded workspace data, with direct navigation to supported detail records.
2. Improved current-workspace table filters: text, status, date range, table scope, and clear-all.
3. Click-to-sort on every rendered data-table column, with numeric/date-aware sorting and indicators.
4. Date range filtering across displayed table rows; date cells are detected from common ISO and DD/MM/YYYY formats.
5. Advanced Workspace Insights panel with workspace record count, scanned count, skipped/unavailable count, and permission warnings.
6. Live scan progress panel showing completed/active/queued API requests and retries.
7. Central API record counters for arrays returned by Azure DevOps list/WIQL calls.
8. Explicit skipped/unavailable and permission-warning reporting when API operations fail.
9. Existing Phase 1 security, popup/detail, Phase 2 reliability, and Phase 3 data-accuracy functionality is preserved.

## Notes

- Global search operates on data already loaded in the browser; it does not silently issue broad new API scans.
- Table sorting/filtering operates on rows currently rendered by the existing workspace pagination. Existing "See More" behavior remains unchanged.
- Date filtering keeps a row when at least one detected date cell falls inside the selected range.
- "Skipped / unavailable" is deliberately labeled rather than presented as an exact business-record count when the API only exposes request-level failure information.
- Permission warnings are surfaced for HTTP 401/403 failures captured by the central API layer.
