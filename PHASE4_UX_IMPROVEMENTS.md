# Phase 4 — UX Improvements

Implemented on top of the verified Phase 3 status baseline.

## Improvements

1. Better filters
   - Workspace-aware table selector
   - Global text filter
   - Status/result/state filter
   - Date-from/date-to filter
   - Clear filters
   - Visible/hidden row counts

2. Sortable columns
   - Click table headers to sort
   - Sort direction selector
   - Numeric/date/text-aware sorting
   - Works with the existing See More table rendering

3. Date filtering
   - Detects date/time/created/changed/access/finish/commit columns
   - Supports the common Azure DevOps date formats used by the application

4. Advanced dashboards
   - Workspace-specific insight cards derived from loaded telemetry
   - Repository health, pipeline success, work-item, service/agent, activity, access, and user summaries

5. Loading progress
   - Live scan progress panel
   - Request/page/retry counters
   - Active and queued request counts

6. API request progress
   - Central API run state exposes completed requests, retries, pages, and active/queued work

7. Records scanned
   - Central API layer counts array records returned from successful responses

8. Records skipped/unavailable
   - Final failed API requests are surfaced as unavailable/skipped records in the scan summary

9. Permission warnings
   - 401/403 responses are counted
   - Visible warning explains that results may be incomplete for protected resources

## Compatibility

Phase 1 security/correctness and Phase 2 API reliability remain intact. Existing popup/detail handling, table rendering, pagination, cancellation, retries, and exports were preserved.
