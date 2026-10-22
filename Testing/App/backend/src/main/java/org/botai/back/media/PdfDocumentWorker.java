package org.botai.back.media;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@Component
public class PdfDocumentWorker {
    private final SolutionDocumentService documents;
    private final boolean enabled;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    public PdfDocumentWorker(SolutionDocumentService documents,@Value("${app.pdf.worker-enabled:true}") boolean enabled) {this.documents=documents;this.enabled=enabled;}
    @Scheduled(fixedDelayString="${app.pdf.poll-ms:1000}") public void tick() {
        if(!enabled||!busy.compareAndSet(false,true))return;
        try {documents.reap();var claim=documents.claim();if(claim==null){busy.set(false);return;}worker.submit(()->{try{documents.execute(claim);}finally{busy.set(false);}});}
        catch(RuntimeException failure){busy.set(false);}
    }
    @PreDestroy void close() {worker.shutdownNow();}
}
