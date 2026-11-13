-- 0014_branch_name_uniqueness.sql
-- Purpose: Enforce unique operator-facing Branch names per organization.
-- Normalized key is lower(btrim(name)): leading/trailing whitespace and Latin
-- case cannot create a second visible name. Arabic has no case; trim still
-- applies. Uniqueness includes ACTIVE, INACTIVE, and ARCHIVED rows so
-- Floor, Reports, session history, and the Branches list stay unambiguous.
-- Tenant-scoped: (organization_id, normalized name). Different organizations
-- may share the same name. Does not rewrite 0001–0013. Does not change ids,
-- codes, or history. Uses PostgreSQL lower(btrim(...)) — no custom Unicode maps.
--
-- Existing stored names are trimmed in place (display hygiene). Duplicate
-- normalized names must be renamed before this index can be created.

UPDATE core_branches
SET name = btrim(name)
WHERE name IS DISTINCT FROM btrim(name);

DO $$
DECLARE
  dup_list text;
BEGIN
  SELECT string_agg(format('%s:%s×%s', organization_id, key, cnt), ', ' ORDER BY organization_id::text, key)
  INTO dup_list
  FROM (
    SELECT organization_id, lower(btrim(name)) AS key, count(*) AS cnt
    FROM core_branches
    GROUP BY organization_id, lower(btrim(name))
    HAVING count(*) > 1
  ) d;
  IF dup_list IS NOT NULL THEN
    RAISE EXCEPTION 'core_branches duplicate visible names (rename before 0014): %', dup_list;
  END IF;
END $$;

CREATE UNIQUE INDEX core_branches_org_name_normalized_key
  ON core_branches (organization_id, lower(btrim(name)));
