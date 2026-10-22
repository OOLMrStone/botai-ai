package org.botai.back.grading;

import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import org.botai.back.catalog.CatalogService;
import org.botai.back.common.*;
import org.botai.back.grading.port.GradingGateway;
import org.botai.back.media.MediaService;
import org.botai.back.media.port.ObjectStorage;
import org.botai.back.profile.ProfileService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.*;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@EnableScheduling
public class GradingWorker {
  public record Claim(UUID submission, long fence) {}

  private final SubmissionStore store;
  private final SubmissionService service;
  private final CatalogService catalog;
  private final ProfileService profile;
  private final ObjectStorage storage;
  private final GradingGateway gateway;
  private final TransactionTemplate tx;
  private final MediaService media;
  private final boolean enabled;
  private final ExecutorService workers = Executors.newFixedThreadPool(2);
  private final Semaphore slots = new Semaphore(2);
  private final AiResponseValidator validator = new AiResponseValidator();
  @org.springframework.beans.factory.annotation.Autowired private org.botai.back.b2b.SubmissionOrigins origins;
  @org.springframework.beans.factory.annotation.Autowired private org.botai.back.b2b.B2bConfig b2b;
  @org.springframework.beans.factory.annotation.Autowired private org.botai.back.school.SchoolReviewService schoolReviews;
  @org.springframework.beans.factory.annotation.Autowired(required=false) private org.botai.back.b2b.B2bGradingGateway b2bGateway;

  public GradingWorker(
      SubmissionStore store,
      SubmissionService service,
      CatalogService catalog,
      ProfileService profile,
      ObjectStorage storage,
      GradingGateway gateway,
      TransactionTemplate tx,
      MediaService media,
      @Value("${app.grading.worker-enabled:true}") boolean enabled) {
    this.store = store;
    this.service = service;
    this.catalog = catalog;
    this.profile = profile;
    this.storage = storage;
    this.gateway = gateway;
    this.tx = tx;
    this.media = media;
    this.enabled = enabled;
  }

  @Scheduled(fixedDelay = 1000)
  public void poll() {
    if (!enabled || (b2b != null && b2b.enabled())) return;
    while (slots.tryAcquire()) {
      Claim claim;
      try {
        claim = claim();
      } catch (Exception e) {
        slots.release();
        return;
      }
      if (claim == null) {
        slots.release();
        return;
      }
      workers.submit(
          () -> {
            try {
              execute(claim);
            } finally {
              slots.release();
            }
          });
    }
  }

  public Claim claim() {
    return tx.execute(
        t -> {
          var rows =
              store
                  .db()
                  .queryForList(
                      "SELECT submission_id,fencing_token FROM grading_jobs WHERE state='ready' AND"
                          + " available_at<=now() ORDER BY available_at,submission_id LIMIT 1 FOR"
                          + " UPDATE SKIP LOCKED");
          if (rows.isEmpty()) return null;
          var row = rows.getFirst();
          UUID id = (UUID) row.get("submission_id");
          long fence = ((Number) row.get("fencing_token")).longValue() + 1;
          store
              .db()
              .update(
                  "UPDATE grading_jobs SET"
                      + " state='claimed',fencing_token=?,lease_until=now()+interval '90"
                      + " seconds',updated_at=now() WHERE submission_id=?",
                  fence,
                  id);
          return new Claim(id, fence);
        });
  }

  public UUID dispatch(Claim claim) {
    return tx.execute(
        t -> {
          var s = store.row(claim.submission, null, true);
          if (!s.status().equals("queued")) return null;
          if(origins!=null&&origins.b2b(s.id())&&!origins.valid(s.id(),true)){store.terminal(s,"failed","access_revoked");store.db().update("UPDATE grading_jobs SET state='done',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now() WHERE submission_id=?",s.id());return null;}
          UUID run = UUID.randomUUID();
          boolean typed=origins!=null&&origins.b2b(s.id());int leaseSeconds=typed?1200:420;
          int changed =
              store
                  .db()
                  .update(
                      "UPDATE grading_jobs SET"
                      + " state='dispatching',run_id=?,lease_until="+(typed?"clock_timestamp()":"now()")+"+make_interval(secs=>?),updated_at=now() WHERE submission_id=? AND state='claimed'"
                      + " AND fencing_token=? AND lease_until>"+(typed?"clock_timestamp()":"now()"),
                      run,
                  leaseSeconds,
                      claim.submission,
                      claim.fence);
          if (changed != 1) return null;
          store
              .db()
              .update(
                  "INSERT INTO grading_runs(id,submission_id,fencing_token,package_id)"
                      + " VALUES(?,?,?,?)",
                  run,
                  claim.submission,
                  claim.fence,
                  s.packageId());
          store
              .db()
              .update(
                  "UPDATE grading_submissions SET"
                      + " status='running',revision=revision+1,updated_at=now() WHERE id=?",
                  claim.submission);
          store.event(
              claim.submission,
              "dispatch_committed",
              null,
              Map.of("runId", run, "fencingToken", claim.fence));
          return run;
        });
  }

  public void execute(Claim claim) {
    boolean dispatched = false;
    boolean school = false;
    try {
      var s = store.row(claim.submission, null, false);
      school=origins!=null&&origins.b2b(s.id());
      var task = school?origins.task(s.id()):catalog.snapshot(s.version());
      if(school){if(b2bGateway==null)throw new ApiException(503,"grading_unavailable","Проверка недоступна");if(!tx.execute(t->origins.valid(s.id(),true)))throw new ApiException(403,"access_revoked","Доступ к работе отозван");var capability=b2bGateway.capabilities().get(task.taskNumber());if(capability==null||!capability.supported()||!Objects.equals(capability.packageId(),s.packageId())||!Objects.equals(capability.providerMode(),s.mode()))throw new ApiException(503,"grading_unavailable","Пакет проверки изменился");b2b.requireProvider(capability.providerMode());}
      var images = new ArrayList<GradingGateway.Image>();
      for (var row :
          store
              .db()
              .queryForList(
                  "SELECT id,object_key,mime_type FROM stored_objects WHERE submission_id=? AND"
                      + " purpose='solution' AND state='ready' ORDER BY ordinal",
                  s.id()))
        images.add(
            new GradingGateway.Image(
                (UUID) row.get("id"),
                storage.get((String) row.get("object_key"), 8 * 1024 * 1024),
                (String) row.get("mime_type")));
      if (images.isEmpty() || images.size() > 4)
        throw new ApiException(422, "images_missing", "Изображения недоступны");
      UUID run = dispatch(claim);
      if (run == null) return;
      dispatched = true;
      if(school){var validated=b2bGateway.grade(run,s.id(),claim.fence,task,images,s.packageId(),s.mode());complete(claim,validated.raw(),validated.result(),validated.task());}
      else{var response = gateway.grade(run, task, images, s.packageId());var validated = validator.validate(response, task, images, s.packageId(), s.mode());complete(claim, response, validated);}
    } catch (Exception e) {
      fail(
          claim,
          dispatched
              ? (e instanceof ApiException a ? a.code() : "unknown_after_dispatch")
              : (school&&e instanceof ApiException a?a.code():"storage_unavailable"),
          dispatched);
    }
  }

  public void complete(
      Claim claim, GradingGateway.Response response, AiResponseValidator.Validated result) {
    complete(claim,response,result,null);
  }
  public void complete(Claim claim,GradingGateway.Response response,AiResponseValidator.Validated result,org.botai.back.catalog.TaskSnapshot materializedTask){
    tx.executeWithoutResult(
        t -> {
          var s = store.row(claim.submission, null, true);
          if (!live(claim, "dispatching") || !s.status().equals("running")) {
            store.event(
                s.id(),
                "late_result_ignored",
                null,
                Map.of(
                    "responseHash",
                    JsonCodec.sha256(response.exactJson()),
                    "providerMode",
                    response.providerMode()));
            finishCanceled(claim, s.status());
            return;
          }
          boolean school=origins!=null&&origins.b2b(s.id());
          if(school&&!origins.valid(s.id(),true))throw ApiException.notFound();
          var task = school?origins.task(s.id()):catalog.snapshot(s.version());
          if(school&&materializedTask!=null){if(!Objects.equals(task.id(),materializedTask.id())||!Objects.equals(task.taskVersionId(),materializedTask.taskVersionId())||task.taskNumber()!=materializedTask.taskNumber()||task.maxScore()!=materializedTask.maxScore())throw new ApiException(502,"invalid_ai_response","Некорректная задача");origins.materialize(s.id(),materializedTask);task=origins.task(s.id());}
          store
              .db()
              .update(
                  "UPDATE grading_submissions SET"
                      + " status=?,is_demo=?,provider_mode=?,revision=revision+1,finished_at=now(),updated_at=now()"
                      + " WHERE id=?",
                  result.graded() ? "graded" : "rejected",
                  result.demo(),
                  response.providerMode(),
                  s.id());
          service.result(
              s,
              result.graded(),
              result.score(),
              task.maxScore(),
              result.feedback(),
              result.rejectionReason(),
              result.demo(),
              response.exactJson(),
              response.providerMode(),
              response.packageId());
          store
              .db()
              .update(
                  "UPDATE grading_runs SET provider_mode=?,outcome=?,finished_at=now() WHERE"
                      + " submission_id=? AND fencing_token=?",
                  response.providerMode(),
                  result.graded() ? "graded" : "rejected",
                  s.id(),
                  claim.fence);
          store
              .db()
              .update(
                  "UPDATE grading_jobs SET state='done',lease_until=NULL,updated_at=now() WHERE"
                      + " submission_id=?",
                  s.id());
          var metadata = new HashMap<String, Object>();
          metadata.put("isDemo", result.demo());
          if (response.rejectionCode() != null)
            metadata.put("rejectionCode", response.rejectionCode());
          store.event(s.id(), result.graded() ? "graded" : "ai_rejected", null, metadata);
          if(school)schoolReviews.complete(s.id());
          if (result.graded()&&!school)
            profile.acceptGraded(
                s.user(), task.id(), s.id(), result.score(), task.maxScore(), result.demo());
          store.touchAttempt(s.attempt());
          if(!school)service.settleBilling(s.id());
        });
  }

  private boolean live(Claim claim, String state) {
    return store
            .db()
            .queryForObject(
                "SELECT count(*) FROM grading_jobs WHERE submission_id=? AND fencing_token=? AND"
                    + " state=? AND lease_until>"+((origins!=null&&origins.b2b(claim.submission))?"clock_timestamp()":"now()"),
                Integer.class,
                claim.submission,
                claim.fence,
                state)
        == 1;
  }

  public void fail(Claim claim, String code, boolean dispatched) {
    tx.executeWithoutResult(
        t -> {
          var s = store.row(claim.submission, null, true);
          if (!live(claim, dispatched ? "dispatching" : "claimed")
              || !Set.of("queued", "running").contains(s.status())) {
            store.event(s.id(), "late_failure_ignored", null, Map.of("code", code));
            finishCanceled(claim, s.status());
            return;
          }
          store.terminal(s, "failed", code);
          store
              .db()
              .update(
                  "UPDATE grading_jobs SET state='done',lease_until=NULL,updated_at=now() WHERE"
                      + " submission_id=?",
                  s.id());
          store
              .db()
              .update(
                  "UPDATE grading_runs SET outcome=?,finished_at=now() WHERE submission_id=? AND"
                      + " fencing_token=?",
                  code,
                  s.id(),
                  claim.fence);
          service.settleBilling(s.id());
        });
  }

  @Scheduled(fixedDelay = 30000)
  public void reconcile() {
    if (!enabled) return;
    reap();
    media.reap();
  }

  public void reap() {
    var expired =
        store
            .db()
            .queryForList(
                "SELECT submission_id,fencing_token,state FROM grading_jobs WHERE state"
                    + " IN('claimed','dispatching') AND lease_until<now() LIMIT 100");
    for (var row : expired)
      tx.executeWithoutResult(
          t -> {
            UUID id = (UUID) row.get("submission_id");
            var s = store.row(id, null, true);
            var jobs =
                store
                    .db()
                    .queryForList(
                        "SELECT state FROM grading_jobs WHERE submission_id=? AND fencing_token=?"
                            + " AND lease_until<now() AND state IN('claimed','dispatching') FOR"
                            + " UPDATE",
                        id,
                        row.get("fencing_token"));
            if (jobs.isEmpty()) return;
            String state = (String) jobs.getFirst().get("state");
            if (state.equals("claimed") && s.status().equals("queued")) {
              store
                  .db()
                  .update(
                      "UPDATE grading_jobs SET"
                          + " state='ready',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now()"
                          + " WHERE submission_id=?",
                      id);
              store.event(id, "pre_dispatch_requeued", null, Map.of());
            } else {
              if (Set.of("running", "queued").contains(s.status()))
                store.terminal(s, "failed", "unknown_after_dispatch");
              store
                  .db()
                  .update(
                      "UPDATE grading_jobs SET"
                          + " state='done',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now()"
                          + " WHERE submission_id=?",
                      id);
              store
                  .db()
                  .update(
                      "UPDATE grading_runs SET outcome='unknown_after_dispatch',finished_at=now()"
                          + " WHERE submission_id=? AND outcome IS NULL",
                      id);
              service.settleBilling(id);
            }
          });
    sealTerminalReservations();
  }

  private void sealTerminalReservations() {
    if (!service.sandboxBillingEnabled()) return;
    var ids =
        store
            .db()
            .query(
                "SELECT u.submission_id FROM billing_test_usage u JOIN grading_submissions s ON"
                    + " s.id=u.submission_id JOIN grading_jobs j ON j.submission_id=s.id WHERE"
                    + " s.status IN('failed','rejected','cancelled','expired','unsupported') AND"
                    + " j.state='done' AND j.lease_until IS NULL AND NOT EXISTS(SELECT 1 FROM"
                    + " billing_test_usage_settlements x WHERE x.submission_id=u.submission_id)"
                    + " LIMIT 100",
                (r, n) -> r.getObject(1, UUID.class));
    for (UUID id : ids)
      tx.executeWithoutResult(
          t -> {
            var s = store.row(id, null, true);
            if (!Set.of("failed", "rejected", "cancelled", "expired", "unsupported")
                .contains(s.status())) return;
            var jobs =
                store
                    .db()
                    .queryForList(
                        "SELECT state,lease_until FROM grading_jobs WHERE submission_id=? FOR"
                            + " UPDATE",
                        id);
            if (jobs.isEmpty()
                || !"done".equals(jobs.getFirst().get("state"))
                || jobs.getFirst().get("lease_until") != null) return;
            if (store
                    .db()
                    .queryForObject(
                        "SELECT count(*) FROM grading_results WHERE submission_id=? AND is_graded",
                        Integer.class,
                        id)
                > 0) return;
            store
                .db()
                .update(
                    "UPDATE grading_jobs SET fencing_token=fencing_token+1 WHERE submission_id=?",
                    id);
            store
                .db()
                .update(
                    "UPDATE grading_runs SET"
                        + " outcome=coalesce(outcome,'no_result_finalized'),finished_at=coalesce(finished_at,now())"
                        + " WHERE submission_id=? AND (outcome IS NULL OR finished_at IS NULL)",
                    id);
            service.settleBilling(id);
          });
  }

  private void finishCanceled(Claim claim, String status) {
    if (!status.equals("cancelled")) return;
    int changed =
        store
            .db()
            .update(
                "UPDATE grading_jobs SET"
                    + " state='done',fencing_token=fencing_token+1,lease_until=NULL,updated_at=now()"
                    + " WHERE submission_id=? AND fencing_token=? AND state='dispatching'",
                claim.submission,
                claim.fence);
    if (changed == 0) return;
    store
        .db()
        .update(
            "UPDATE grading_runs SET outcome='cancelled_no_result',finished_at=now() WHERE"
                + " submission_id=? AND outcome IS NULL",
            claim.submission);
    service.settleBilling(claim.submission);
  }

  @PreDestroy
  void close() {
    workers.shutdownNow();
  }
}
