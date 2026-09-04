-- A material has a title the author chose and a sentence saying what it is.
--
-- Until now a card in the hub's reference library showed the uploaded file's
-- name twice — as its title and as its subtitle — because the title defaulted
-- to the file name and there was nowhere to put a description. The author can
-- now set both in the Topic Builder, or have the description drafted from the
-- document's own text.
ALTER TABLE course_materials ADD COLUMN description TEXT;
