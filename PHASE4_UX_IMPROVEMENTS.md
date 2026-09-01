# Phase 4 — UX Improvements

Implemented on top of the working Phase 3 baseline.

## 1. Better filters
- Expanded table scope selector to all major workspace tables.
- Global text search across all columns of the selected table(s).
- Value/status filter populated from rendered status/value cells.
- Clear Filters action.
- Filter result count.

## 2. Sortable columns
- Every rendered table header is clickable.
- Added sort-column selector and ascending/descending selector.
- Numeric, date and text values are sorted using type-aware comparisons.
- Sorting is applied to the currently rendered rows and does not mutate API data.

## 3. Date filtering
- Added From / To date controls.
- Date detection supports common Azure DevOps UI date formats and ISO timestamps.
- Rows without a detectable date are excluded when a date range is active.

## 4. Advanced dashboards
- Added Dashboard Insights cards for records loaded, visible rows, latest record and workspace health/success.
- Added Chart Top-N selector (5/10/15/25).
- Chart Top-N affects visualization only; the underlying chart data remains intact.
- Dashboard summaries are workspace-aware.

## Compatibility / safety
- Existing Phase 1 security and popup behavior is preserved.
- Existing Phase 2 retry, timeout, cancellation, pagination and concurrency behavior is preserved.
- Existing Phase 3 accuracy behavior is preserved.
- UX sorting operates on rendered DOM rows and does not rewrite rawStore/API data.
