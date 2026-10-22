package org.botai.back.catalog.importing;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;
import java.nio.file.Path;

@Component
@Profile("content-import")
public class ContentImportRunner implements ApplicationRunner {
    private final ContentPublisher publisher;
    private final ConfigurableApplicationContext context;
    private final String manifest;
    private final String packageRoot;
    private final boolean publish;
    private final boolean workerEnabled;
    public ContentImportRunner(ContentPublisher publisher,ConfigurableApplicationContext context,
        @Value("${app.content-import.manifest:}") String manifest,@Value("${app.content-import.package-root:}") String packageRoot,
        @Value("${app.content-import.publish:false}") boolean publish,@Value("${app.grading.worker-enabled:true}") boolean workerEnabled) {
        this.publisher=publisher;this.context=context;this.manifest=manifest;this.packageRoot=packageRoot;this.publish=publish;this.workerEnabled=workerEnabled;
    }
    public void run(ApplicationArguments arguments) {
        int exit=0;
        try {
            if(workerEnabled||manifest.isBlank())throw new ImportFailure("explicit_offline_import_required");
            Path file=Path.of(manifest);Path assets=packageRoot.isBlank()?file.toAbsolutePath().getParent():Path.of(packageRoot);
            if(publish)publisher.reapStaged();
            var report=publisher.importFile(file,assets,publish);
            if(publish)System.out.println("CONTENT_IMPORT mode=publish run="+report.run()+" published="+report.published()+" noop="+report.noop()+" quarantined="+report.quarantined());
            else System.out.println("CONTENT_IMPORT mode=preflight validated="+report.noop()+" quarantined="+report.quarantined());
            if(report.quarantined()>0) {
                System.out.println("CONTENT_IMPORT quarantine_reasons="+report.quarantineReasons());
                exit=2;
            }
        } catch(ImportFailure failure) { System.out.println("CONTENT_IMPORT rejected="+failure.getMessage());exit=2; }
        int status=exit;SpringApplication.exit(context,()->status);System.exit(status);
    }
}
