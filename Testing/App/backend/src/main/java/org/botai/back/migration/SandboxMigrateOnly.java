package org.botai.back.migration;

import org.flywaydb.core.Flyway;
import java.net.URI;
import java.sql.DriverManager;

/** Explicit initialization of an EMPTY payments_test database; no application context or workers. */
public final class SandboxMigrateOnly {
    private SandboxMigrateOnly() { }
    public static void main(String[] args){
        try{
            if(args.length!=0||!"yes".equals(System.getenv("APP_BILLING_INITIALIZE_EMPTY_SANDBOX")))throw new IllegalArgumentException();
            String url=required("APP_MIGRATION_JDBC_URL"),user=required("APP_MIGRATION_USER"),password=required("APP_MIGRATION_PASSWORD");
            if(!url.startsWith("jdbc:postgresql://"))throw new IllegalArgumentException();
            URI uri=URI.create(url.substring(5));String database=uri.getPath().substring(1);
            if(!database.matches("[a-z][a-z0-9_]*_payments_test")||uri.getHost()==null||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null)throw new IllegalArgumentException();
            try(var c=DriverManager.getConnection(url,user,password);var q=c.createStatement().executeQuery("SELECT current_database(),current_schema(),(SELECT count(*) FROM information_schema.tables WHERE table_schema='public')")){
                if(!q.next()||!database.equals(q.getString(1))||!"public".equals(q.getString(2))||q.getInt(3)!=0)throw new IllegalStateException();
            }
            var flyway=Flyway.configure().dataSource(url,user,password).locations("classpath:db/migration").schemas("public").defaultSchema("public")
                .baselineOnMigrate(false).cleanDisabled(true).validateOnMigrate(true).outOfOrder(false).validateMigrationNaming(true).ignoreMigrationPatterns(new String[0]).loggers(new String[0]).load();
            flyway.migrate();flyway.validate();
            if(flyway.info().current()==null||!MigrateOnly.LATEST.equals(flyway.info().current().getVersion())||flyway.info().pending().length!=0)throw new IllegalStateException();
            System.out.println("SANDBOX_MIGRATION_OK after="+MigrateOnly.LATEST.getVersion());
        }catch(IllegalArgumentException e){System.err.println("SANDBOX_MIGRATION_FAILED configuration");System.exit(2);
        }catch(Exception|LinkageError e){System.err.println("SANDBOX_MIGRATION_FAILED database_or_validation");System.exit(1);}
    }
    private static String required(String name){String value=System.getenv(name);if(value==null||value.isBlank())throw new IllegalArgumentException();return value;}
}
