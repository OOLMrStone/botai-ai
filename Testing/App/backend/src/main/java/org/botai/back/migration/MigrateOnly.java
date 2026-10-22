package org.botai.back.migration;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import java.net.URI;
import java.sql.DriverManager;
import java.util.Map;

/** One-shot release entrypoint. Never constructs a Spring context or starts application workers. */
public final class MigrateOnly {
    private static final MigrationVersion FIRST = MigrationVersion.fromVersion("4");
    static final MigrationVersion LATEST = MigrationVersion.fromVersion("21");
    private MigrateOnly() { }

    public static void main(String[] args) {
        String stage = "configuration";
        try {
            if (args.length != 0) throw new IllegalArgumentException();
            Map<String,String> env = System.getenv();
            String url = required(env, "APP_MIGRATION_JDBC_URL");
            String user = required(env, "APP_MIGRATION_USER");
            String password = required(env, "APP_MIGRATION_PASSWORD");
            if (!url.startsWith("jdbc:postgresql://")) throw new IllegalArgumentException();
            URI address = URI.create(url.substring(5));
            if (address.getHost() == null || address.getUserInfo() != null || address.getFragment() != null
                || address.getPath() == null || address.getPath().length() < 2) throw new IllegalArgumentException();

            // Deployment must explicitly identify an existing public V4+ database. No implicit baseline.
            stage = "schema";
            try (var connection = DriverManager.getConnection(url, user, password);
                 var query = connection.createStatement().executeQuery(
                     "SELECT current_schema(),to_regclass('public.flyway_schema_history')")) {
                if (!query.next() || !"public".equals(query.getString(1)) || query.getString(2) == null)
                    throw new IllegalStateException();
            }
            stage = "history";
            var flyway = Flyway.configure().dataSource(url, user, password)
                .locations("classpath:db/migration").schemas("public").defaultSchema("public")
                .baselineOnMigrate(false).cleanDisabled(true).validateOnMigrate(true)
                .outOfOrder(false).validateMigrationNaming(true).ignoreMigrationPatterns(new String[0])
                .loggers(new String[0]).load();
            var current = flyway.info().current();
            if (current == null || current.getVersion() == null || current.getVersion().compareTo(FIRST) < 0
                || current.getVersion().compareTo(LATEST) > 0) throw new IllegalStateException();
            String before = current.getVersion().getVersion();
            stage = "migrate";
            var result = flyway.migrate();
            stage = "validate";
            flyway.validate();
            var after = flyway.info();
            if (after.current() == null || !LATEST.equals(after.current().getVersion()) || after.pending().length != 0)
                throw new IllegalStateException();
            System.out.println("MIGRATION_OK before=" + before + " after=" + LATEST.getVersion() + " executed=" + result.migrationsExecuted);
        } catch (IllegalArgumentException invalid) {
            System.err.println("MIGRATION_FAILED configuration");
            System.exit(2);
        } catch (Exception | LinkageError failure) {
            // JDBC/Flyway messages can contain URLs, credentials or SQL. Keep one-shot logs bounded.
            System.err.println("MIGRATION_FAILED database_or_validation stage=" + stage);
            System.exit(1);
        }
    }

    private static String required(Map<String,String> env, String name) {
        String value = env.get(name);
        if (value == null || value.isBlank()) throw new IllegalArgumentException();
        return value;
    }
}
