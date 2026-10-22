package org.botai.back.media;

import org.botai.back.common.ApiException;
import org.springframework.stereotype.Component;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.*;
import java.util.concurrent.Semaphore;
import javax.imageio.ImageIO;

/** Pixel crop from an already orientation-normalized private solution JPEG. */
@Component
public class StudentCropper {
    public record Crop(double x,double y,double width,double height) { }
    private final Semaphore slots=new Semaphore(1);
    public ImageNormalizer.Normalized crop(byte[] jpeg,Crop box) {
        validate(box);
        if(!slots.tryAcquire())throw new ApiException(429,"image_busy","Повтори позже");
        try(var input=ImageIO.createImageInputStream(new ByteArrayInputStream(jpeg))) {
            if(jpeg.length>8*1024*1024)throw invalid();
            var readers=ImageIO.getImageReaders(input);if(!readers.hasNext())throw invalid();var reader=readers.next();
            try {
                if(!reader.getFormatName().equalsIgnoreCase("jpeg")&&!reader.getFormatName().equalsIgnoreCase("jpg"))throw invalid();
                reader.setInput(input,false,true);int w=reader.getWidth(0),h=reader.getHeight(0);
                if(w<1||h<1||w>8192||h>8192||(long)w*h>20_000_000||reader.getNumImages(true)!=1)throw invalid();
                int left=Math.max(0,(int)Math.floor(box.x*w)),top=Math.max(0,(int)Math.floor(box.y*h));
                int right=Math.min(w,(int)Math.ceil((box.x+box.width)*w)),bottom=Math.min(h,(int)Math.ceil((box.y+box.height)*h));
                int width=right-left,height=bottom-top;
                if(width<1||height<1||width>4096||height>4096||(long)width*height>6_000_000)throw invalid();
                BufferedImage source=reader.read(0);if(source==null)throw invalid();
                var clean=new BufferedImage(width,height,BufferedImage.TYPE_INT_RGB);var g=clean.createGraphics();
                try {g.setColor(Color.WHITE);g.fillRect(0,0,width,height);g.drawImage(source,0,0,width,height,left,top,right,bottom,null);}finally{g.dispose();source.flush();}
                var out=new ByteArrayOutputStream();try{if(!ImageIO.write(clean,"jpeg",out))throw invalid();}finally{clean.flush();}
                if(out.size()>8*1024*1024)throw invalid();return new ImageNormalizer.Normalized(out.toByteArray(),"image/jpeg",width,height);
            } finally {reader.dispose();}
        }catch(ApiException e){throw e;}catch(IOException|RuntimeException e){throw invalid();}finally{slots.release();}
    }
    public static void validate(Crop b) {
        if(b==null||!Double.isFinite(b.x)||!Double.isFinite(b.y)||!Double.isFinite(b.width)||!Double.isFinite(b.height)||b.x<0||b.y<0||b.width<=0||b.height<=0||b.x+b.width>1||b.y+b.height>1)throw invalid();
    }
    private static ApiException invalid(){return new ApiException(400,"validation_error","Некорректный фрагмент изображения");}
}
