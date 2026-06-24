-- Large course materials live in Azure Blob Storage; we keep only a reference
-- (the object key) here. kind='file' with a storage_key = a blob-backed file;
-- kind='file' with `data` = a small inline file; kind='link'/'scorm' = a URL.
ALTER TABLE course_materials ADD COLUMN storage_key TEXT;
