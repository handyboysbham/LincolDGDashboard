CREATE OR REPLACE FUNCTION enforce_rental_operational_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  unresolved_disposal_count integer;
  completed_post_inspection_count integer;
  active_occupancy_count integer;
BEGIN
  IF NEW.status <> 'operationally_complete' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO unresolved_disposal_count
  FROM disposal_loads source_load
  WHERE source_load.tenant_id = NEW.tenant_id
    AND source_load.rental_detail_id = NEW.id
    AND source_load.job_id = NEW.job_id
    AND (
      source_load.status NOT IN ('reconciled', 'cancelled', 'rejected', 'redirected')
      OR (
        source_load.status IN ('rejected', 'redirected')
        AND NOT EXISTS (
          WITH RECURSIVE replacement_chain AS (
            SELECT replacement.id, replacement.status, ARRAY[replacement.id] AS path
            FROM disposal_loads replacement
            WHERE replacement.tenant_id = source_load.tenant_id
              AND replacement.job_id = source_load.job_id
              AND replacement.rental_detail_id = source_load.rental_detail_id
              AND replacement.redirected_from_disposal_load_id = source_load.id

            UNION ALL

            SELECT replacement.id, replacement.status, previous.path || replacement.id
            FROM disposal_loads replacement
            INNER JOIN replacement_chain previous
              ON replacement.redirected_from_disposal_load_id = previous.id
            WHERE replacement.tenant_id = source_load.tenant_id
              AND replacement.job_id = source_load.job_id
              AND replacement.rental_detail_id = source_load.rental_detail_id
              AND NOT replacement.id = ANY(previous.path)
          )
          SELECT 1
          FROM replacement_chain
          WHERE status = 'reconciled'
        )
      )
    );

  SELECT COUNT(*) INTO completed_post_inspection_count
  FROM rental_inspections
  WHERE tenant_id = NEW.tenant_id
    AND rental_detail_id = NEW.id
    AND job_id = NEW.job_id
    AND inspection_type = 'post_rental'
    AND status = 'completed';

  SELECT COUNT(*) INTO active_occupancy_count
  FROM asset_reservations
  WHERE tenant_id = NEW.tenant_id
    AND job_id = NEW.job_id
    AND asset_id = NEW.trailer_asset_id
    AND reservation_type = 'occupancy'
    AND status = 'active';

  IF NEW.customer_custody_ended_at IS NULL
    OR NEW.actual_pickup_at IS NULL
    OR NEW.empty_trailer_status <> 'confirmed_empty'
    OR NEW.final_condition IN ('pending_inspection', 'undetermined')
    OR NEW.occupancy_released_at IS NULL
    OR NEW.operationally_completed_at IS NULL
    OR unresolved_disposal_count > 0
    OR completed_post_inspection_count = 0
    OR active_occupancy_count > 0 THEN
    RAISE EXCEPTION 'Rental cannot complete until retrieval, disposal, empty-trailer evidence, inspection, and occupancy release are complete';
  END IF;

  RETURN NEW;
END;
$$;
