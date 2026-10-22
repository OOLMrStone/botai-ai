package org.botai.back.catalog;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.botai.back.media.MediaService;
import org.botai.back.media.port.ObjectStorage;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class CatalogMediaService {
    private final JdbcClient jdbc;
    private final ObjectStorage storage;

    public MediaService.Content statement(UUID user,UUID asset) {
        var keys=jdbc.sql("""
            SELECT a.object_key,a.mime_type FROM catalog_assets a WHERE a.id=:asset AND a.state='ready' AND a.purpose='statement'
            AND EXISTS(SELECT 1 FROM task_version_assets va WHERE va.asset_id=a.id AND
                (EXISTS(SELECT 1 FROM tasks t WHERE t.current_version_id=va.task_version_id AND NOT t.archived)
                OR EXISTS(SELECT 1 FROM attempt_items i JOIN attempts x ON x.id=i.attempt_id WHERE i.task_version_id=va.task_version_id AND x.user_id=:user)))
            """).param("asset",asset).param("user",user).query((r,n)->new String[]{r.getString(1),r.getString(2)}).optional().orElseThrow(ApiException::notFound);
        return bytes(keys);
    }
    public MediaService.Content reference(UUID version,UUID asset) {
        var keys=jdbc.sql("SELECT a.object_key,a.mime_type FROM catalog_assets a JOIN task_version_assets va ON va.asset_id=a.id WHERE a.id=:asset AND va.task_version_id=:version AND a.state='ready' AND a.purpose='reference'")
            .param("asset",asset).param("version",version).query((r,n)->new String[]{r.getString(1),r.getString(2)}).optional().orElseThrow(ApiException::notFound);
        return bytes(keys);
    }
    public MediaService.Content admin(UUID actor,UUID asset) {
        var keys=jdbc.sql("SELECT object_key,mime_type FROM catalog_assets WHERE id=:asset AND state='ready' AND EXISTS(SELECT 1 FROM task_version_assets WHERE asset_id=:asset)")
            .param("asset",asset).query((r,n)->new String[]{r.getString(1),r.getString(2)}).optional().orElseThrow(ApiException::notFound);
        jdbc.sql("INSERT INTO admin_access_events(actor_id,action,target_id) VALUES(:actor,'catalog_media_read',:asset)").param("actor",actor).param("asset",asset).update();
        return bytes(keys);
    }
    private MediaService.Content bytes(String[] key) {
        try { return new MediaService.Content(storage.get(key[0],8*1024*1024),key[1]); }
        catch(RuntimeException failure) { throw new ApiException(503,"storage_unavailable","Изображение временно недоступно"); }
    }
}
