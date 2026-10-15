-- A job title's job description is simple rich text, like an email composer (owner's request, 15 October 2026: "allow
-- me to format the text (bold, indent, etc.), not full format, keep the mail system format"): the purpose, the duties
-- and the requirements are saved as HTML. The duties get a column of their own; the duty rows stay, since KPIs will be
-- linked to them, and from now on the API reads them from the duties' HTML.

-- 1. The duties as HTML.
ALTER TABLE "job_titles" ADD COLUMN "jd_duties" TEXT;

-- 2. What was saved as plain text becomes HTML: &, < and > escaped, each non-empty line a paragraph, and lines in a row
-- that start with a bullet (•, ·, ▪, - or *, then text) one bulleted list, the bullets removed. Blank lines are
-- dropped. The API converts plain text sent by older callers the same way (apps/api/src/organisation/job-titles/jd-html.ts).
CREATE FUNCTION "jd_lines_to_html"(source TEXT) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  -- whitespace as JavaScript trims it (line breaks aside), so a line reads the same here as in the API
  blank CONSTANT TEXT := E' \t\f\u000B\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF';
  line TEXT;
  bulleted BOOLEAN;
  in_list BOOLEAN := false;
  html TEXT := '';
BEGIN
  IF source IS NULL THEN
    RETURN NULL;
  END IF;
  FOREACH line IN ARRAY regexp_split_to_array(source, E'\r\n|\r|\n') LOOP
    line := btrim(line, blank);
    CONTINUE WHEN line = '';
    -- a bullet, then text: a line of dashes or of asterisks stays a paragraph
    bulleted := line ~ ('^[•·▪*-][' || blank || ']*[^•·▪*' || blank || '-]');
    IF bulleted THEN
      line := regexp_replace(line, '^[•·▪*-][' || blank || ']*', '');
    END IF;
    line := replace(replace(replace(line, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    IF bulleted AND NOT in_list THEN
      html := html || '<ul>';
    ELSIF in_list AND NOT bulleted THEN
      html := html || '</ul>';
    END IF;
    in_list := bulleted;
    html := html || CASE WHEN bulleted THEN '<li>' || line || '</li>' ELSE '<p>' || line || '</p>' END;
  END LOOP;
  IF in_list THEN
    html := html || '</ul>';
  END IF;
  RETURN NULLIF(html, '');
END;
$$;

UPDATE "job_titles"
SET "jd_purpose" = "jd_lines_to_html"("jd_purpose"), "jd_requirements" = "jd_lines_to_html"("jd_requirements")
WHERE "jd_purpose" IS NOT NULL OR "jd_requirements" IS NOT NULL;

-- 3. Each title's duties as HTML, from its duty rows in order, one line each (the rows themselves stay as they are).
UPDATE "job_titles" j
SET "jd_duties" = "jd_lines_to_html"(d."lines")
FROM (
  SELECT "job_title_id", string_agg("duty", E'\n' ORDER BY "position", "id") AS "lines"
  FROM "job_title_duties"
  GROUP BY "job_title_id"
) d
WHERE d."job_title_id" = j."id";

DROP FUNCTION "jd_lines_to_html"(TEXT);
