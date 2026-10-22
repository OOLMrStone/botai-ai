package org.botai.back.grading;
import org.botai.back.media.ImageNormalizer;
import org.botai.back.common.ApiException;
import org.junit.jupiter.api.Test;
import java.io.*;
import java.awt.image.BufferedImage;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.*;

class ImageNormalizerTest {
    private final ImageNormalizer normalizer=new ImageNormalizer();
    @Test void rejectsUnsafeAndOversizeBytes(){assertThatThrownBy(()->normalizer.normalize(new ByteArrayInputStream("<svg/>".getBytes()),false)).isInstanceOf(ApiException.class);assertThatThrownBy(()->normalizer.normalize(new ByteArrayInputStream(new byte[2*1024*1024+1]),true)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("file_size");}
    @Test void normalizesAndShrinksAvatar()throws Exception{var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(1024,768,BufferedImage.TYPE_INT_RGB),"png",out);var result=normalizer.normalize(new ByteArrayInputStream(out.toByteArray()),true);assertThat(result.mimeType()).isEqualTo("image/jpeg");assertThat(result.width()).isEqualTo(512);assertThat(result.height()).isEqualTo(384);assertThat(ImageIO.read(new ByteArrayInputStream(result.bytes())).getWidth()).isEqualTo(512);}
    @Test void rejectsDimensionsBeforePixelDecode()throws Exception{var out=new ByteArrayOutputStream();ImageIO.write(new BufferedImage(8193,1,BufferedImage.TYPE_INT_RGB),"png",out);assertThatThrownBy(()->normalizer.normalize(new ByteArrayInputStream(out.toByteArray()),false)).isInstanceOf(ApiException.class).extracting("code").isEqualTo("image_dimensions");}
    @Test void catalogGlyphRemainsLosslessWhileStudentOutputRemainsJpeg()throws Exception {
        var source=new BufferedImage(8,8,BufferedImage.TYPE_INT_RGB);source.setRGB(3,3,0xff3344);var encoded=new ByteArrayOutputStream();ImageIO.write(source,"png",encoded);
        var normalized=normalizer.normalizeCatalog(new ByteArrayInputStream(encoded.toByteArray()));assertThat(normalized.mimeType()).isEqualTo("image/png");
        var decoded=ImageIO.read(new ByteArrayInputStream(normalized.bytes()));for(int x=0;x<8;x++)for(int y=0;y<8;y++)assertThat(decoded.getRGB(x,y)).isEqualTo(source.getRGB(x,y));
        assertThat(normalizer.normalize(new ByteArrayInputStream(encoded.toByteArray()),false).mimeType()).isEqualTo("image/jpeg");
    }
    @Test void appliesCameraOrientationBeforeDiscardingExif()throws Exception {
        var source=new BufferedImage(40,20,BufferedImage.TYPE_INT_RGB);var g=source.createGraphics();g.setColor(java.awt.Color.RED);g.fillRect(0,0,20,20);g.setColor(java.awt.Color.BLUE);g.fillRect(20,0,20,20);g.dispose();var encoded=new ByteArrayOutputStream();ImageIO.write(source,"jpeg",encoded);byte[] original=encoded.toByteArray();
        for(int orientation=1;orientation<=8;orientation++){
            var exif=java.nio.ByteBuffer.allocate(32).order(java.nio.ByteOrder.LITTLE_ENDIAN);exif.put(new byte[]{'E','x','i','f',0,0,'I','I'}).putShort((short)42).putInt(8).putShort((short)1).putShort((short)0x112).putShort((short)3).putInt(1).putShort((short)orientation).putShort((short)0).putInt(0);
            var upload=new ByteArrayOutputStream();upload.write(original,0,2);upload.write(new byte[]{(byte)255,(byte)225,0,34});upload.write(exif.array());upload.write(original,2,original.length-2);
            var clean=normalizer.normalize(new ByteArrayInputStream(upload.toByteArray()),false);var image=ImageIO.read(new ByteArrayInputStream(clean.bytes()));assertThat(image.getWidth()).isEqualTo(orientation>=5?20:40);assertThat(image.getHeight()).isEqualTo(orientation>=5?40:20);assertThat(new String(clean.bytes(),java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain("Exif");
            boolean redTopLeft=java.util.Set.of(1,4,5,6).contains(orientation);var color=new java.awt.Color(image.getRGB(5,5));assertThat(color.getRed()>color.getBlue()).isEqualTo(redTopLeft);
        }
    }

}
