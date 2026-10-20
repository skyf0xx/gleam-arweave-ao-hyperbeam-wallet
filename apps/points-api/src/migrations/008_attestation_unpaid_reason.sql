-- Why a scan earned nothing, so callers don't infer it from `paid` and the
-- places left. Null for a paid scan.
ALTER TABLE attestations
  ADD COLUMN unpaid_reason text CHECK (unpaid_reason IN ('places_taken', 'no_snapshot'));
