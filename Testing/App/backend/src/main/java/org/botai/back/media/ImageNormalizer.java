package org.botai.back.media;

import org.botai.back.common.ApiException;
import org.springframework.stereotype.Component;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.Locale;
import java.util.concurrent.Semaphore;

@Component
public class ImageNormalizer {
    public record Normalized(byte[] bytes,String mimeType,int width,int height) { }
    private final Semaphore slots=new Semaphore(2);
    public Normalized normalize(InputStream input,boolean avatar) {
        return normalize(input,avatar,false,false);
    }
    public Normalized normalizeCatalog(InputStream input) {
        return normalize(input,false,true,false);
    }
    public Normalized normalizePdf(InputStream input) { return normalize(input,false,false,true); }
    private Normalized normalize(InputStream input,boolean avatar,boolean lossless,boolean pdf) {
        int bytesLimit=avatar?2*1024*1024:8*1024*1024;
        if(!slots.tryAcquire())throw new ApiException(429,"image_busy","Повтори загрузку позже");
        try(input) {
            byte[] bytes=input.readNBytes(bytesLimit+1);
            if(bytes.length>bytesLimit)throw error(413,"file_size");
            try(var stream=ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
                var readers=ImageIO.getImageReaders(stream);if(!readers.hasNext())throw error(422,"decode_failed");
                ImageReader reader=readers.next();
                try {
                    String format=reader.getFormatName().toLowerCase(Locale.ROOT);
                    if(pdf&&!java.util.Set.of("jpeg","jpg").contains(format))throw error(422,"file_type");
                    if(!java.util.Set.of("jpeg","jpg","png","webp").contains(format))throw error(422,"file_type");
                    reader.setInput(stream,false,true);
                    int w=reader.getWidth(0),h=reader.getHeight(0),side=avatar||pdf?4096:8192;long pixels=pdf?6_000_000L:avatar?4_000_000L:20_000_000L;
                    if(w<1||h<1||w>side||h>side||(long)w*h>pixels)throw error(422,"image_dimensions");
                    if(reader.getNumImages(true)!=1||animated(bytes,format))throw error(422,"file_type");
                    BufferedImage decoded=reader.read(0);if(decoded==null)throw error(422,"decode_failed");
                    decoded=orient(decoded,orientation(bytes,format));w=decoded.getWidth();h=decoded.getHeight();
                    int outW=avatar?Math.min(512,w):w,outH=avatar?Math.max(1,(int)((long)h*outW/w)):h;
                    if(avatar&&outH>512){outH=512;outW=Math.max(1,(int)((long)w*outH/h));}
                    var clean=new BufferedImage(outW,outH,BufferedImage.TYPE_INT_RGB);var graphics=clean.createGraphics();
                    graphics.setColor(Color.WHITE);graphics.fillRect(0,0,outW,outH);graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION,RenderingHints.VALUE_INTERPOLATION_BICUBIC);graphics.drawImage(decoded,0,0,outW,outH,null);graphics.dispose();decoded.flush();
                    var output=new ByteArrayOutputStream();ImageIO.write(clean,lossless?"png":"jpeg",output);clean.flush();
                    if(output.size()>bytesLimit)throw error(413,"file_size");return new Normalized(output.toByteArray(),lossless?"image/png":"image/jpeg",outW,outH);
                } finally { reader.dispose(); }
            }
        } catch(ApiException e){throw e;}catch(IOException|RuntimeException e){throw error(422,"decode_failed");}finally{slots.release();}
    }
    // Apply camera orientation before stripping metadata. All offsets remain inside the bounded upload.
    private int orientation(byte[] bytes,String format){
        if(format.equals("jpeg")||format.equals("jpg")){for(int p=2;p+4<=bytes.length;){if((bytes[p++]&255)!=255)return 1;int marker=bytes[p++]&255;if(marker==0xda||marker==0xd9)return 1;if(marker==0xd8||(marker>=0xd0&&marker<=0xd7))continue;int size=((bytes[p]&255)<<8)|(bytes[p+1]&255);if(size<2||size>bytes.length-p)return 1;if(marker==0xe1&&size>=8&&bytes[p+2]=='E'&&bytes[p+3]=='x'&&bytes[p+4]=='i'&&bytes[p+5]=='f'&&bytes[p+6]==0&&bytes[p+7]==0)return tiff(bytes,p+8,size-8);p+=size;}}
        if(format.equals("png")){for(int p=8;p+12<=bytes.length;){int n=java.nio.ByteBuffer.wrap(bytes,p,4).getInt();if(n<0||n>bytes.length-p-12)return 1;String type=new String(bytes,p+4,4,java.nio.charset.StandardCharsets.US_ASCII);if(type.equals("eXIf"))return tiff(bytes,p+8,n);p+=12+n;}}
        if(format.equals("webp")){for(int p=12;p+8<=bytes.length;){int n=java.nio.ByteBuffer.wrap(bytes,p+4,4).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt();if(n<0||n>bytes.length-p-8)return 1;String type=new String(bytes,p,4,java.nio.charset.StandardCharsets.US_ASCII);if(type.equals("EXIF")){int skip=n>=6&&bytes[p+8]=='E'&&bytes[p+9]=='x'&&bytes[p+10]=='i'&&bytes[p+11]=='f'&&bytes[p+12]==0&&bytes[p+13]==0?6:0;return tiff(bytes,p+8+skip,n-skip);}p+=8+n+(n&1);}}
        return 1;
    }
    private int tiff(byte[] bytes,int start,int size){try{if(size<8)return 1;var b=java.nio.ByteBuffer.wrap(bytes,start,size).slice();if(b.get(0)=='I'&&b.get(1)=='I')b.order(java.nio.ByteOrder.LITTLE_ENDIAN);else if(b.get(0)!='M'||b.get(1)!='M')return 1;if(b.getShort(2)!=42)return 1;long offset=Integer.toUnsignedLong(b.getInt(4));if(offset>size-2)return 1;int count=Short.toUnsignedInt(b.getShort((int)offset));for(int i=0;i<count;i++){long entry=offset+2L+12L*i;if(entry>size-12)return 1;int p=(int)entry;if(Short.toUnsignedInt(b.getShort(p))==0x112&&b.getShort(p+2)==3&&b.getInt(p+4)==1){int value=Short.toUnsignedInt(b.getShort(p+8));return value>=1&&value<=8?value:1;}}}catch(IndexOutOfBoundsException ignored){}return 1;}
    private BufferedImage orient(BufferedImage input,int orientation){if(orientation==1)return input;int w=input.getWidth(),h=input.getHeight();var output=new BufferedImage(orientation>=5?h:w,orientation>=5?w:h,BufferedImage.TYPE_INT_RGB);var g=output.createGraphics();g.setColor(Color.WHITE);g.fillRect(0,0,output.getWidth(),output.getHeight());var transform=switch(orientation){case 2->new java.awt.geom.AffineTransform(-1,0,0,1,w,0);case 3->new java.awt.geom.AffineTransform(-1,0,0,-1,w,h);case 4->new java.awt.geom.AffineTransform(1,0,0,-1,0,h);case 5->new java.awt.geom.AffineTransform(0,1,1,0,0,0);case 6->new java.awt.geom.AffineTransform(0,1,-1,0,h,0);case 7->new java.awt.geom.AffineTransform(0,-1,-1,0,h,w);case 8->new java.awt.geom.AffineTransform(0,-1,1,0,0,w);default->new java.awt.geom.AffineTransform();};g.drawImage(input,transform,null);g.dispose();input.flush();return output;}
    private boolean animated(byte[] bytes,String format){
        // APNG and animated WebP flags are rejected even where an ImageIO reader exposes only frame zero.
        if(format.equals("png")){for(int p=8;p+12<=bytes.length;){int n=java.nio.ByteBuffer.wrap(bytes,p,4).getInt();if(n<0||n>bytes.length-p-12)return true;String type=new String(bytes,p+4,4,java.nio.charset.StandardCharsets.US_ASCII);if(type.equals("acTL"))return true;p+=12+n;}}
        if(format.equals("webp")){for(int p=12;p+8<=bytes.length;){int n=java.nio.ByteBuffer.wrap(bytes,p+4,4).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt();if(n<0||n>bytes.length-p-8)return true;String type=new String(bytes,p,4,java.nio.charset.StandardCharsets.US_ASCII);if(type.equals("ANIM")||type.equals("ANMF")||(type.equals("VP8X")&&n>0&&(bytes[p+8]&2)!=0))return true;p+=8+n+(n&1);}}
        return false;
    }
    private ApiException error(int status,String code){return new ApiException(status,code,"Не удалось принять изображение");}
}
