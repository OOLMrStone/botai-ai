ALTER TABLE attempts ADD COLUMN title varchar(80);

ALTER TABLE attempts ADD CONSTRAINT attempts_title_not_blank
    CHECK (title IS NULL OR length(btrim(title)) > 0);
