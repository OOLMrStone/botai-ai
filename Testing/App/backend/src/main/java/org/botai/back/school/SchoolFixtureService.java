package org.botai.back.school;

import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.botai.back.b2b.B2bConfig;
import org.botai.back.common.ApiException;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.media.MediaService;
import org.botai.back.media.port.ObjectStorage;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.JsonNode;

/** Local-only, server-selected fixture; the client never supplies a storage path. */
@Service
@RequiredArgsConstructor
public class SchoolFixtureService {
    private final B2bConfig config;
    private final SubmissionStore store;
    private final ObjectStorage storage;
    private final MediaService media;
    private final TransactionTemplate tx;

    public boolean available(UUID task) {
        return config.enabled() && store.db().queryForObject("SELECT count(*) FROM school_solution_fixtures WHERE task_id=?", Integer.class, task)>0;
    }

    public JsonNode attach(UUID user, UUID submission, UUID task) {
        config.requireEnabled();
        boolean replay=tx.execute(t->{
            store.draft(store.row(submission,user,true));
            var previous=store.db().queryForList("SELECT complete FROM school_fixture_attachments WHERE submission_id=?",submission);
            if(!previous.isEmpty()) {
                if(Boolean.TRUE.equals(previous.getFirst().get("complete")))return true;
                throw ApiException.conflict("fixture_attachment_in_progress");
            }
            if(!available(task))throw ApiException.notFound();
            if(store.db().queryForObject("SELECT count(*) FROM stored_objects WHERE submission_id=? AND purpose='solution' AND state IN('staged','ready')",Integer.class,submission)>0)throw ApiException.conflict("fixture_requires_empty_submission");
            store.db().update("INSERT INTO school_fixture_attachments(submission_id,complete) VALUES(?,false)",submission);
            return false;
        });
        if(replay)return store.get(user,submission);
        var fixtures=store.db().queryForList("SELECT object_key,sha256,size_bytes FROM school_solution_fixtures WHERE task_id=? ORDER BY ordinal",task);
        for(var fixture:fixtures) {
            byte[] bytes=storage.get(fixture.get("object_key").toString(),8*1024*1024);
            try {
                if(bytes.length!=((Number)fixture.get("size_bytes")).longValue() || !HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)).equals(fixture.get("sha256")))throw new IllegalStateException("Fixture integrity mismatch");
            }catch(Exception e){throw new ApiException(503,"fixture_unavailable","Фото решения временно недоступно");}
            media.uploadFixture(user,submission,new FixtureFile(bytes));
        }
        tx.executeWithoutResult(t->{store.draft(store.row(submission,user,true));store.db().update("UPDATE school_fixture_attachments SET complete=true WHERE submission_id=?",submission);});
        return store.get(user,submission);
    }

    private record FixtureFile(byte[] bytes) implements MultipartFile {
        public String getName(){return "file";}
        public String getOriginalFilename(){return "solution.jpg";}
        public String getContentType(){return "image/jpeg";}
        public boolean isEmpty(){return bytes.length==0;}
        public long getSize(){return bytes.length;}
        public byte[] getBytes(){return bytes.clone();}
        public InputStream getInputStream(){return new ByteArrayInputStream(bytes);}
        public void transferTo(File target)throws IOException{Files.write(target.toPath(),bytes);}
    }
}
