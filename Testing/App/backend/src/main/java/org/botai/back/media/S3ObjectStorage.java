package org.botai.back.media;

import org.botai.back.media.port.ObjectStorage;
import org.botai.back.common.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.*;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.core.checksums.RequestChecksumCalculation;
import software.amazon.awssdk.core.checksums.ResponseChecksumValidation;
import java.net.URI;
import java.time.Duration;

@Component
public class S3ObjectStorage implements ObjectStorage {
    private final S3Client client; private final String bucket;
    public S3ObjectStorage(@Value("${app.storage.endpoint:}") String endpoint,@Value("${app.storage.bucket:botai}") String bucket,
        @Value("${app.storage.access-key:}") String access,@Value("${app.storage.secret-key:}") String secret,@Value("${app.storage.region:garage}") String region) {
        this.bucket=bucket;
        client=endpoint.isBlank()||access.isBlank()||secret.isBlank()?null:S3Client.builder().endpointOverride(URI.create(endpoint)).region(Region.of(region))
            .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(access,secret))).forcePathStyle(true)
            .requestChecksumCalculation(RequestChecksumCalculation.WHEN_REQUIRED).responseChecksumValidation(ResponseChecksumValidation.WHEN_REQUIRED)
            .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(Duration.ofSeconds(5)).socketTimeout(Duration.ofSeconds(30)))
            .overrideConfiguration(c->c.apiCallTimeout(Duration.ofSeconds(40)).apiCallAttemptTimeout(Duration.ofSeconds(35)).retryStrategy(r->r.maxAttempts(1))).build();
    }
    private S3Client client() { if(client==null)throw new ApiException(503,"storage_unavailable","Хранилище временно недоступно");return client; }
    public String bucket(){return bucket;}
    public void put(String key,byte[] bytes,String type){client().putObject(b->b.bucket(bucket).key(key).contentType(type),RequestBody.fromBytes(bytes));}
    public byte[] get(String key,long maxBytes){try(var stream=client().getObject(b->b.bucket(bucket).key(key))){if(stream.response().contentLength()>maxBytes)throw new IllegalStateException("Object limit");byte[] result=stream.readNBytes(Math.toIntExact(maxBytes+1));if(result.length>maxBytes)throw new IllegalStateException("Object limit");return result;}catch(java.io.IOException e){throw new IllegalStateException("Storage read failed");}}
    public void delete(String key){client().deleteObject(b->b.bucket(bucket).key(key));}
}
