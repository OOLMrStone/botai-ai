CREATE TABLE solution_documents (
    id uuid PRIMARY KEY,
    UNIQUE(id,user_id,submission_id),
    user_id uuid NOT NULL REFERENCES users(id),
    submission_id uuid NOT NULL,
    bucket text NOT NULL,
    object_key text NOT NULL UNIQUE,
    file_name varchar(200) NOT NULL,
    mime_type varchar(64) NOT NULL DEFAULT 'application/pdf' CHECK(mime_type='application/pdf'),
    size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
    sha256 varchar(64) NOT NULL,
    page_count integer CHECK(page_count BETWEEN 1 AND 4),
    reserved_pages integer NOT NULL CHECK(reserved_pages BETWEEN 1 AND 4),
    state varchar(16) NOT NULL CHECK(state IN('processing','ready','failed','delete_pending','deleted')),
    error_code varchar(80),
    base_revision integer NOT NULL,
    fencing_token bigint NOT NULL DEFAULT 0,
    uploaded_at timestamptz,
    lease_until timestamptz,
    renderer_version varchar(80),
    cleanup_until timestamptz,
    cleanup_complete boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(submission_id,user_id) REFERENCES grading_submissions(id,user_id),
    CHECK(state<>'ready' OR (page_count IS NOT NULL AND uploaded_at IS NOT NULL AND renderer_version IS NOT NULL))
);
CREATE INDEX solution_documents_work_ix ON solution_documents(submission_id,created_at,id);
CREATE UNIQUE INDEX solution_documents_user_processing_ux ON solution_documents(user_id) WHERE state='processing';
ALTER TABLE stored_objects ADD COLUMN source_document_id uuid REFERENCES solution_documents(id),
    ADD COLUMN page_number integer,
    ADD CONSTRAINT stored_objects_document_page_ck CHECK((source_document_id IS NULL AND page_number IS NULL)
        OR (source_document_id IS NOT NULL AND page_number BETWEEN 1 AND 4 AND purpose='solution')),
    ADD CONSTRAINT stored_objects_document_owner_fk FOREIGN KEY(source_document_id,user_id,submission_id) REFERENCES solution_documents(id,user_id,submission_id),
    ADD CONSTRAINT stored_objects_document_page_ux UNIQUE(source_document_id,page_number);
CREATE FUNCTION solution_documents_json(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'fileName',d.file_name,'mimeType',d.mime_type,'sizeBytes',d.size_bytes,
        'sha256',d.sha256,'state',d.state,'revision',s.revision,'pageCount',d.page_count,'errorCode',d.error_code,
        'downloadUrl',CASE WHEN d.state='ready' THEN '/api/submissions/'||s.id||'/documents/'||d.id||'/download' ELSE NULL END,
        'pages',coalesce((SELECT jsonb_agg(jsonb_build_object('id',o.id,'fileName',o.file_name,'mimeType',o.mime_type,'sizeBytes',o.size_bytes,
            'previewUrl','/api/media/'||o.id,'sourceDocumentId',o.source_document_id,'pageNumber',o.page_number) ORDER BY o.page_number)
            FROM stored_objects o WHERE o.source_document_id=d.id AND o.state='ready'),'[]'::jsonb)) ORDER BY d.created_at,d.id),'[]'::jsonb)
    FROM solution_documents d JOIN grading_submissions s ON s.id=d.submission_id WHERE d.submission_id=target AND d.state IN('processing','ready','failed')
$$;
CREATE FUNCTION protect_solution_document_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' OR (NEW.id,NEW.user_id,NEW.submission_id,NEW.bucket,NEW.object_key,NEW.file_name,NEW.mime_type,NEW.size_bytes,NEW.sha256,NEW.reserved_pages,NEW.base_revision,NEW.created_at)
        IS DISTINCT FROM (OLD.id,OLD.user_id,OLD.submission_id,OLD.bucket,OLD.object_key,OLD.file_name,OLD.mime_type,OLD.size_bytes,OLD.sha256,OLD.reserved_pages,OLD.base_revision,OLD.created_at)
        THEN RAISE EXCEPTION 'immutable PDF origin'; END IF;
    IF OLD.state='ready' AND (NEW.page_count,NEW.renderer_version) IS DISTINCT FROM (OLD.page_count,OLD.renderer_version) THEN RAISE EXCEPTION 'immutable PDF rendering'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_solution_document_origin BEFORE UPDATE OR DELETE ON solution_documents FOR EACH ROW EXECUTE FUNCTION protect_solution_document_origin();

CREATE FUNCTION protect_solution_page_origin() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF (NEW.source_document_id,NEW.page_number) IS DISTINCT FROM (OLD.source_document_id,OLD.page_number) THEN RAISE EXCEPTION 'immutable PDF page origin'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER immutable_solution_page_origin BEFORE UPDATE ON stored_objects FOR EACH ROW EXECUTE FUNCTION protect_solution_page_origin();
