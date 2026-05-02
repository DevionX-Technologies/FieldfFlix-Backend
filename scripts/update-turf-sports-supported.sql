-- Fix `turfs.sports_supported` for FieldFlix-relevant venues.
-- Safe for QR: only updates a column; `turfs.id` (turf UUID) is unchanged.
--
-- Before running:
--   1) List allowed enum literals (must match exactly, case-sensitive):
SELECT e.enumlabel
FROM pg_enum e
JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'ESportsSupported'
ORDER BY e.enumsortorder;

--   2) Preview rows you will touch:
-- SELECT id, name, sports_supported FROM turfs ORDER BY name;

-- Optional: wrap everything in BEGIN … COMMIT for one transaction.
-- Padel venue (enum value is typically `Paddle`, not “Padel”)
UPDATE turfs
SET sports_supported = ARRAY['Paddle']::"ESportsSupported"[]
WHERE name ILIKE '%TSG Padel Arena%';

-- Pickleball-focused venues (tune Balkanji if you store cricket on same turf row)
UPDATE turfs
SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[]
WHERE name ILIKE '%Pickleflow%';

UPDATE turfs
SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[]
WHERE name ILIKE '%Botanical Gardens%';

UPDATE turfs
SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[]
WHERE name ILIKE '%Eskay Resort%';

-- PickPad (Goregaon West) — spreadsheet: Padel
UPDATE turfs
SET sports_supported = ARRAY['Paddle']::"ESportsSupported"[]
WHERE name ILIKE '%PickPad%';

-- Balkanji Bari (multiple turf rows exist; spreadsheet had pickle + cricket courts)
UPDATE turfs
SET sports_supported = ARRAY['Pickleball', 'Cricket']::"ESportsSupported"[]
WHERE name ILIKE '%All India Balkanji Bari%';

UPDATE turfs
SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[]
WHERE name ILIKE '%Balkanji Bari%' AND name ILIKE '%Global Sports%';

-- Santacruz (from your listing — adjust sport list if cricket/padel courts exist too)
UPDATE turfs
SET sports_supported = ARRAY['Pickleball']::"ESportsSupported"[]
WHERE name ILIKE '%Santacruz West%';

-- Verify:
-- SELECT id, name, sports_supported FROM turfs WHERE name ILIKE '%TSG%' OR name ILIKE '%PickPad%' ORDER BY name;
-- If correct: COMMIT;   otherwise: ROLLBACK;
