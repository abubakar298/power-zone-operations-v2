-- Preserve the reviewed Operations preview's existing 25 MB/image formats.
-- Widening only: existing immutable evidence remains valid and untouched.
ALTER TABLE operations_board_files DROP CONSTRAINT operations_board_files_media_type_check;
ALTER TABLE operations_board_files ADD CONSTRAINT operations_board_files_media_type_check CHECK(media_type IN ('application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif'));
ALTER TABLE operations_board_files DROP CONSTRAINT operations_board_files_content_check;
ALTER TABLE operations_board_files ADD CONSTRAINT operations_board_files_content_check CHECK(octet_length(content)>0 AND octet_length(content)<=26214400);
