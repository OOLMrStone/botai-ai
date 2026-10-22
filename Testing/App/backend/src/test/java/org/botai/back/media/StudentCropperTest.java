package org.botai.back.media;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.*;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class StudentCropperTest {
    private final StudentCropper cropper=new StudentCropper();
    static byte[] jpeg(int w,int h) throws IOException {
        var image=new BufferedImage(w,h,BufferedImage.TYPE_INT_RGB);var g=image.createGraphics();g.setColor(Color.WHITE);g.fillRect(0,0,w,h);g.setColor(Color.RED);g.fillRect(0,0,w/2,h/2);g.dispose();var out=new ByteArrayOutputStream();ImageIO.write(image,"jpeg",out);image.flush();return out.toByteArray();
    }
    @Test void roundsOutwardAndStoresActualCleanJpegPixels() throws Exception {
        var image=cropper.crop(jpeg(100,80),new StudentCropper.Crop(.101,.126,.202,.251));
        assertThat(image.width()).isEqualTo(21);assertThat(image.height()).isEqualTo(21);assertThat(image.mimeType()).isEqualTo("image/jpeg");
        var decoded=ImageIO.read(new ByteArrayInputStream(image.bytes()));assertThat(decoded.getWidth()).isEqualTo(21);assertThat(decoded.getHeight()).isEqualTo(21);
        var color=new Color(decoded.getRGB(10,10));assertThat(color.getRed()).isGreaterThan(200);assertThat(color.getGreen()).isLessThan(80);
        String bytes=new String(image.bytes(),java.nio.charset.StandardCharsets.ISO_8859_1);assertThat(bytes).doesNotContain("Exif","http://","GPS");
    }
    @Test void acceptsExactLastPixelAndWholeImage() throws Exception {
        assertThat(cropper.crop(jpeg(100,80),new StudentCropper.Crop(.99,.9875,.01,.0125)).width()).isEqualTo(1);
        assertThat(cropper.crop(jpeg(100,80),new StudentCropper.Crop(0,0,1,1)).height()).isEqualTo(80);
    }
    @Test void rejectsNonFiniteNegativeEmptyAndOverflowBounds() throws Exception {
        byte[] input=jpeg(10,10);
        for(var box:new StudentCropper.Crop[]{null,new StudentCropper.Crop(Double.NaN,0,.5,.5),new StudentCropper.Crop(0,Double.POSITIVE_INFINITY,.5,.5),new StudentCropper.Crop(0,0,Double.NaN,.5),new StudentCropper.Crop(0,0,.5,Double.NEGATIVE_INFINITY),new StudentCropper.Crop(-.01,0,.5,.5),new StudentCropper.Crop(0,0,0,.5),new StudentCropper.Crop(0,0,.5,-.1),new StudentCropper.Crop(.8,0,.3,.5),new StudentCropper.Crop(0,.8,.5,.3)})assertThatThrownBy(()->cropper.crop(input,box)).extracting("code").isEqualTo("validation_error");
    }
    @Test void rejectsOutputSideOrPixelBudgetBeforeDecode() throws Exception {
        assertThatThrownBy(()->cropper.crop(jpeg(5000,100),new StudentCropper.Crop(0,0,1,1))).extracting("code").isEqualTo("validation_error");
        assertThatThrownBy(()->cropper.crop(jpeg(3000,2100),new StudentCropper.Crop(0,0,1,1))).extracting("code").isEqualTo("validation_error");
    }
    @Test void rejectsPngAndMalformedSource() throws Exception {
        var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(10,10,BufferedImage.TYPE_INT_RGB),"png",out);
        assertThatThrownBy(()->cropper.crop(out.toByteArray(),new StudentCropper.Crop(0,0,1,1))).extracting("code").isEqualTo("validation_error");
        assertThatThrownBy(()->cropper.crop(new byte[]{1,2,3},new StudentCropper.Crop(0,0,1,1))).extracting("code").isEqualTo("validation_error");
    }
    @Test void finalReferenceMustBeExactV2ImageLeafInOcrBlock() {
        var json=tools.jackson.databind.json.JsonMapper.builder().build();var id=java.util.UUID.randomUUID();
        String leaf="{\"type\":\"image\",\"artifact_id\":\""+id+"\",\"alt\":\"Диаграмма\"}";
        assertThat(SubmissionArtifactService.referenced(json.readTree("{\"schema_version\":\"expert-review.v2\",\"ocr\":{\"blocks\":[{\"content\":"+leaf+"}]}}"),id)).isTrue();
        assertThat(SubmissionArtifactService.referenced(json.readTree("{\"schema_version\":\"expert-review.v2\",\"ocr\":{\"blocks\":[{\"content\":{\"type\":\"step\",\"lines\":[\"Решение\"],\"image\":"+leaf+"}}]}}"),id)).isTrue();
        for(String doc:new String[]{"{\"schema_version\":\"expert-review.v1\",\"ocr\":{\"blocks\":[{\"content\":"+leaf+"}]}}","{\"schema_version\":\"expert-review.v2\",\"metadata\":"+leaf+"}","{\"schema_version\":\"expert-review.v2\",\"ocr\":{\"blocks\":[{\"content\":{\"type\":\"text\",\"image\":"+leaf+"}}]}}"})assertThat(SubmissionArtifactService.referenced(json.readTree(doc),id)).isFalse();
    }
}
