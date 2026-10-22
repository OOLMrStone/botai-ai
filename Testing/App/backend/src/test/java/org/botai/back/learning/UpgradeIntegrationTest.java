package org.botai.back.learning;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.sql.DriverManager;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import static org.assertj.core.api.Assertions.*;

@Testcontainers
class UpgradeIntegrationTest {
    @Container static PostgreSQLContainer postgres=new PostgreSQLContainer("postgres:17");
    @Test void preservesV4UsersHashesVerificationAndSession() throws Exception {
        var baseline=Flyway.configure().dataSource(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword()).target("4").load();baseline.migrate();
        UUID local=UUID.randomUUID(),external=UUID.randomUUID();String session=UUID.randomUUID().toString();List<Integer> checksums=new ArrayList<>();
        try(var c=DriverManager.getConnection(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword())) {
            try(var q=c.createStatement().executeQuery("SELECT checksum FROM flyway_schema_history ORDER BY installed_rank")) { while(q.next())checksums.add(q.getInt(1)); }
            try(var p=c.prepareStatement("INSERT INTO users(id,email,password_hash,email_verified,created_at) VALUES(?,'local@example.test','{bcrypt}unchanged',false,'2024-01-01T00:00:00Z')")) { p.setObject(1,local);p.executeUpdate(); }
            try(var p=c.prepareStatement("INSERT INTO users(id,email,auth_provider,provider_id,email_verified) VALUES(?,'oauth@example.test','GOOGLE','subject-123',true)")) { p.setObject(1,external);p.executeUpdate(); }
            try(var p=c.prepareStatement("INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name) VALUES(?,?,1,1,1209600,9999999999999,'local@example.test')")) { p.setString(1,session);p.setString(2,session);p.executeUpdate(); }
        }
        var migrated=migrate(Map.of("APP_MIGRATION_JDBC_URL",postgres.getJdbcUrl(),"APP_MIGRATION_USER",postgres.getUsername(),"APP_MIGRATION_PASSWORD",postgres.getPassword()));
        assertThat(migrated.status()).as(migrated.output()).isZero();assertThat(migrated.output()).isEqualTo("MIGRATION_OK before=4 after=21 executed=17\n");
        var repeated=migrate(Map.of("APP_MIGRATION_JDBC_URL",postgres.getJdbcUrl(),"APP_MIGRATION_USER",postgres.getUsername(),"APP_MIGRATION_PASSWORD",postgres.getPassword()));
        assertThat(repeated.status()).isZero();assertThat(repeated.output()).isEqualTo("MIGRATION_OK before=21 after=21 executed=0\n");
        try(var c=DriverManager.getConnection(postgres.getJdbcUrl(),postgres.getUsername(),postgres.getPassword())) {
            try(var q=c.createStatement().executeQuery("SELECT checksum FROM flyway_schema_history WHERE version IN('1','2','3','4') ORDER BY installed_rank")) { var after=new ArrayList<Integer>();while(q.next())after.add(q.getInt(1));assertThat(after).isEqualTo(checksums); }
            try(var q=c.createStatement().executeQuery("SELECT password_hash,email_verified,created_at,plan_id,time_zone FROM users WHERE email='local@example.test'")) { assertThat(q.next()).isTrue();assertThat(q.getString(1)).isEqualTo("{bcrypt}unchanged");assertThat(q.getBoolean(2)).isFalse();assertThat(q.getTimestamp(3).toInstant().toString()).isEqualTo("2024-01-01T00:00:00Z");assertThat(q.getString(4)).isEqualTo("free");assertThat(q.getString(5)).isEqualTo("Europe/Moscow"); }
            try(var q=c.createStatement().executeQuery("SELECT password_hash,email_verified,provider_id FROM users WHERE email='oauth@example.test'")) { assertThat(q.next()).isTrue();assertThat(q.getString(1)).isNull();assertThat(q.getBoolean(2)).isTrue();assertThat(q.getString(3)).isEqualTo("subject-123"); }
            try(var q=c.createStatement().executeQuery("SELECT count(*) FROM spring_session")) { q.next();assertThat(q.getInt(1)).isEqualTo(1); }
            try(var q=c.createStatement().executeQuery("SELECT count(*) FROM flyway_schema_history WHERE success")) { q.next();assertThat(q.getInt(1)).isEqualTo(21); }
            try(var q=c.createStatement().executeQuery("SELECT to_regclass('activity_timer_state'),to_regclass('activity_timer_events'),to_regclass('attempt_exit_events'),to_regclass('schools'),to_regclass('school_experts'),to_regclass('school_students'),to_regclass('expert_students'),to_regclass('expert_works'),to_regclass('expert_review_versions'),to_regclass('expert_grading_jobs')")) { q.next();for(int i=1;i<=10;i++)assertThat(q.getString(i)).isNotNull(); }
            try(var q=c.createStatement().executeQuery("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='attempts' AND column_name IN('title','deleted_at','last_exited_at')")) { q.next();assertThat(q.getInt(1)).isEqualTo(3); }
            c.createStatement().executeUpdate("UPDATE flyway_schema_history SET checksum=checksum+1 WHERE version='4'");
        }
        var corrupted=migrate(Map.of("APP_MIGRATION_JDBC_URL",postgres.getJdbcUrl(),"APP_MIGRATION_USER",postgres.getUsername(),"APP_MIGRATION_PASSWORD",postgres.getPassword()));
        assertThat(corrupted.status()).isEqualTo(1);assertThat(corrupted.output()).isEqualTo("MIGRATION_FAILED database_or_validation stage=migrate\n");
    }
    @Test void packagedRunnerRejectsMissingOrInvalidConfigurationWithoutLeakingIt() throws Exception {
        var missing=migrate(Map.of());assertThat(missing.status()).isEqualTo(2);assertThat(missing.output()).isEqualTo("MIGRATION_FAILED configuration\n");
        var invalid=migrate(Map.of("APP_MIGRATION_JDBC_URL","jdbc:invalid://private-host/secret-db","APP_MIGRATION_USER","private-user","APP_MIGRATION_PASSWORD","private-password"));
        assertThat(invalid.status()).isEqualTo(2);assertThat(invalid.output()).isEqualTo("MIGRATION_FAILED configuration\n");
    }
    private record Run(int status,String output) { }
    private Run migrate(Map<String,String> environment) throws Exception {
        String java=Path.of(System.getProperty("java.home"),"bin","java").toString();
        var builder=new ProcessBuilder(java,"-Dloader.main=org.botai.back.migration.MigrateOnly","-cp",System.getProperty("botai.migration.jar"),"org.springframework.boot.loader.launch.PropertiesLauncher").redirectErrorStream(true);
        builder.environment().clear();builder.environment().putAll(environment);
        var child=builder.start();
        try {
            assertThat(child.waitFor(60,TimeUnit.SECONDS)).as("one-shot migration exits without a Spring server or worker").isTrue();
            return new Run(child.exitValue(),new String(child.getInputStream().readAllBytes(),StandardCharsets.UTF_8));
        } finally { if(child.isAlive())child.destroyForcibly(); }
    }
}
