package org.botai.back.grading;

import org.botai.back.media.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.net.http.*;
import java.util.UUID;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.*;

@EnabledIfEnvironmentVariable(named="S3_ACCESS_KEY",matches=".+")
class S3ObjectStorageIntegrationTest {
    @Test void officialSdkPrivateLosslessCatalogPngRoundtrip()throws Exception {
        String endpoint=System.getenv().getOrDefault("S3_TEST_ENDPOINT","http://garage:3900"),bucket=System.getenv().getOrDefault("S3_BUCKET","botai");var storage=new S3ObjectStorage(endpoint,bucket,System.getenv("S3_ACCESS_KEY"),System.getenv("S3_SECRET_KEY"),"garage");
        var source=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(16,16,BufferedImage.TYPE_INT_RGB),"png",source);var image=new ImageNormalizer().normalizeCatalog(new ByteArrayInputStream(source.toByteArray()));String key="catalog/test-"+UUID.randomUUID()+".png";
        try { storage.put(key,image.bytes(),image.mimeType());assertThat(storage.get(key,8388608)).isEqualTo(image.bytes());assertThat(image.mimeType()).isEqualTo("image/png");assertThat(HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(endpoint+"/"+bucket+"/"+key)).GET().build(),HttpResponse.BodyHandlers.discarding()).statusCode()).isIn(403,404); }
        finally { storage.delete(key); }
    }
    @Test void officialSdkPrivateNormalizedPhotoAndAvatarRoundtrip()throws Exception {
        String endpoint=System.getenv().getOrDefault("S3_TEST_ENDPOINT","http://garage:3900");String bucket=System.getenv().getOrDefault("S3_BUCKET","botai");
        var storage=new S3ObjectStorage(endpoint,bucket,System.getenv("S3_ACCESS_KEY"),System.getenv("S3_SECRET_KEY"),"garage");var source=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(800,600,BufferedImage.TYPE_INT_RGB),"png",source);
        for(boolean avatar:new boolean[]{false,true}){String key=(avatar?"avatar/":"solution/")+"test-"+UUID.randomUUID();var image=new ImageNormalizer().normalize(new ByteArrayInputStream(source.toByteArray()),avatar);
            try {storage.put(key,image.bytes(),image.mimeType());assertThat(storage.get(key,8*1024*1024)).isEqualTo(image.bytes());assertThatThrownBy(()->storage.get(key,1)).isInstanceOf(IllegalStateException.class);
                var anonymous=HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(endpoint+"/"+bucket+"/"+key)).GET().build(),HttpResponse.BodyHandlers.ofByteArray());assertThat(anonymous.statusCode()).isIn(403,404);
            }finally{storage.delete(key);}assertThatThrownBy(()->storage.get(key,8*1024*1024)).isInstanceOf(RuntimeException.class);
        }
    }
}
