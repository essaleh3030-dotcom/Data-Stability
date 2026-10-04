-- Add UNIQUE constraints for dedupe on upload
-- Base/Extra: unique by (match_id, part_id, event_name)
ALTER TABLE "Base | Before"
  ADD CONSTRAINT "base_before_unique"
  UNIQUE (event_match_id, event_part_id, tornado_event);

ALTER TABLE "Base | Current"
  ADD CONSTRAINT "base_current_unique"
  UNIQUE (event_match_id, event_part_id, tornado_event);

ALTER TABLE "Extra | Before"
  ADD CONSTRAINT "extra_before_unique"
  UNIQUE (event_match_id, event_part_id, tornado_event);

ALTER TABLE "Extra | Current"
  ADD CONSTRAINT "extra_current_unique"
  UNIQUE (event_match_id, event_part_id, tornado_event);

-- Half Collector: change PK to include hr_code
ALTER TABLE "Half Collector" DROP CONSTRAINT IF EXISTS "Half Collector_pkey";
ALTER TABLE "Half Collector" ADD PRIMARY KEY (matchid, partid, hr_code);

-- matches (match_id already PK) — no change needed
-- reviewed_matches (match_id + part_id already PK) — no change needed
