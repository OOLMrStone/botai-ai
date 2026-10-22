-- Additive catalogue import: published versions and student history remain immutable.
ALTER TABLE topics ADD COLUMN active boolean NOT NULL DEFAULT true;
UPDATE topics SET title='Вероятности сложных событий' WHERE id='sdamgia-185';
UPDATE topics SET active=false WHERE id IN('sdamgia-265','sdamgia-172','sdamgia-217','sdamgia-209','sdamgia-210');
INSERT INTO topics(id,format_id,exam_number,title,source_url,sort_order) VALUES
('botai-20-divisibility','ege-profile-20-v1',20,'Делимость, остатки и чётность','urn:botai:taxonomy:ege-profile-20-v1:20',0),
('botai-20-integer-equations','ege-profile-20-v1',20,'Целочисленные уравнения','urn:botai:taxonomy:ege-profile-20-v1:20',1),
('botai-20-digits','ege-profile-20-v1',20,'Цифры и запись числа','urn:botai:taxonomy:ege-profile-20-v1:20',2),
('botai-20-sequences','ege-profile-20-v1',20,'Последовательности и прогрессии','urn:botai:taxonomy:ege-profile-20-v1:20',3),
('botai-20-invariants','ege-profile-20-v1',20,'Операции и инварианты','urn:botai:taxonomy:ege-profile-20-v1:20',4),
('botai-20-extrema','ege-profile-20-v1',20,'Оценки и экстремальные значения','urn:botai:taxonomy:ege-profile-20-v1:20',5);
ALTER TABLE task_versions ALTER COLUMN source_year DROP NOT NULL;
ALTER TABLE task_versions ALTER COLUMN reference_answer DROP NOT NULL;
ALTER TABLE task_versions ADD COLUMN sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(sources)='array'),
    ADD COLUMN reference_content jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(reference_content)='array'),
    ADD COLUMN reference_answer_content jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(reference_answer_content)='array'),
    ADD COLUMN ai_input_ready boolean NOT NULL DEFAULT true;
ALTER TABLE task_versions ADD CONSTRAINT reference_answer_complete CHECK(reference_answer IS NOT NULL OR (exam_number BETWEEN 14 AND 20 AND jsonb_array_length(reference_answer_content)>0));
ALTER TABLE task_versions ADD CONSTRAINT ai_reference_answer_ready CHECK(reference_answer IS NOT NULL OR NOT ai_input_ready);
CREATE TABLE task_source_links (
    provider varchar(64) NOT NULL,external_id varchar(128) NOT NULL,task_id uuid NOT NULL REFERENCES tasks(id),
    PRIMARY KEY(provider,external_id),UNIQUE(task_id)
);
CREATE TABLE task_version_provenance (
    task_version_id uuid PRIMARY KEY REFERENCES task_versions(id),task_id uuid NOT NULL REFERENCES tasks(id),
    content_fingerprint char(64) NOT NULL,version_fingerprint char(64) NOT NULL,
    snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(task_id,version_fingerprint),FOREIGN KEY(task_id,task_version_id) REFERENCES task_versions(task_id,id)
);
CREATE TABLE catalog_assets (
    id uuid PRIMARY KEY,bucket text NOT NULL,object_key text NOT NULL UNIQUE,state varchar(8) NOT NULL CHECK(state IN('staged','ready','failed','deleted')),
    purpose varchar(16) NOT NULL CHECK(purpose IN('statement','reference')),mime_type varchar(32) NOT NULL,
    size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),width integer NOT NULL,height integer NOT NULL,
    original_sha256 char(64) NOT NULL,normalized_sha256 char(64) NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE task_version_assets (
    task_version_id uuid NOT NULL REFERENCES task_versions(id),asset_id uuid NOT NULL REFERENCES catalog_assets(id),
    PRIMARY KEY(task_version_id,asset_id)
);
CREATE TABLE content_import_runs (
    id uuid PRIMARY KEY,manifest_sha256 char(64) NOT NULL,state varchar(16) NOT NULL CHECK(state IN('running','completed','failed')),
    created_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
CREATE TABLE content_import_items (
    run_id uuid NOT NULL REFERENCES content_import_runs(id),ordinal integer NOT NULL,provider varchar(64),external_id varchar(128),
    state varchar(16) NOT NULL CHECK(state IN('published','noop','quarantined')),reason varchar(64),task_version_id uuid REFERENCES task_versions(id),
    PRIMARY KEY(run_id,ordinal)
);
CREATE TABLE solution_reveal_grants (
    id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),attempt_id uuid NOT NULL,item_id uuid NOT NULL,
    task_version_id uuid NOT NULL REFERENCES task_versions(id),answer_revision integer NOT NULL,
    latest_submission_id uuid REFERENCES grading_submissions(id),latest_submission_revision integer,input_fingerprint char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,item_id,input_fingerprint),
    FOREIGN KEY(attempt_id,user_id) REFERENCES attempts(id,user_id),FOREIGN KEY(attempt_id,item_id) REFERENCES attempt_items(attempt_id,id),
    CHECK((latest_submission_id IS NULL)=(latest_submission_revision IS NULL))
);
CREATE TRIGGER immutable_solution_reveal_audit BEFORE UPDATE OR DELETE ON solution_reveal_grants FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_version_provenance BEFORE UPDATE OR DELETE ON task_version_provenance FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_version_asset BEFORE UPDATE OR DELETE ON task_version_assets FOR EACH ROW EXECUTE FUNCTION protect_immutable_content();
CREATE TRIGGER immutable_published_provenance BEFORE INSERT ON task_version_provenance FOR EACH ROW EXECUTE FUNCTION protect_published_task_children();
CREATE TRIGGER immutable_published_version_asset BEFORE INSERT ON task_version_assets FOR EACH ROW EXECUTE FUNCTION protect_published_task_children();
CREATE FUNCTION validate_catalog_asset_ready() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM catalog_assets WHERE id=NEW.asset_id AND state='ready') THEN RAISE EXCEPTION 'catalogue asset not ready'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER catalog_asset_ready BEFORE INSERT ON task_version_assets FOR EACH ROW EXECUTE FUNCTION validate_catalog_asset_ready();
CREATE FUNCTION protect_catalog_asset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF OLD.state='ready' THEN RAISE EXCEPTION 'immutable catalogue asset'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_ready_catalog_asset BEFORE UPDATE OR DELETE ON catalog_assets FOR EACH ROW EXECUTE FUNCTION protect_catalog_asset();
CREATE FUNCTION validate_task_topic_position() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM task_versions v JOIN topics p ON p.id=NEW.topic_id AND p.format_id=v.format_id AND p.exam_number=v.exam_number WHERE v.id=NEW.task_version_id) THEN RAISE EXCEPTION 'topic position mismatch'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER task_topic_position BEFORE INSERT ON task_version_topics FOR EACH ROW EXECUTE FUNCTION validate_task_topic_position();
