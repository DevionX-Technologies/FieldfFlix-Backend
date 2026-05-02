-- Inventory: how venues relate to cameras vs sports in Postgres.
--
-- Today: `turfs.sports_supported` is venue-level (array). The `cameras` table has
-- NO per-camera sport column — each camera is a row with `id`, `name`, `turfId`.
-- Same physical "Court 1" for Pickleball vs Cricket at one venue should be TWO
-- different camera UUIDs (two QR codes), with names that disambiguate in admin.
--
-- Run against your DB (psql, DBeaver, etc.):

SELECT
  c.id AS camera_id,
  c.name AS camera_name,
  t.id AS turf_id,
  t.name AS turf_name,
  t.city,
  t.sports_supported
FROM cameras c
JOIN turfs t ON t.id = c."turfId"
ORDER BY t.name, c.name NULLS LAST, c.id;

-- Turfs with multiple cameras (typical multi-court venues):
SELECT
  t.id,
  t.name,
  t.city,
  COUNT(c.id)::int AS camera_count,
  t.sports_supported
FROM turfs t
LEFT JOIN cameras c ON c."turfId" = t.id
GROUP BY t.id, t.name, t.city, t.sports_supported
HAVING COUNT(c.id) > 1
ORDER BY camera_count DESC, t.name;
