package org.botai.back.b2b;

import jakarta.annotation.PreDestroy;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.botai.back.expert.ExpertGradingCoordinator;
import org.botai.back.grading.GradingWorker;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** One durable FIFO admission boundary for local full-photo and grade-only jobs. */
@Component
public class B2bAiScheduler {
    public record Job(String kind,UUID id,long fence) { }
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final GradingWorker full;
    private final ExpertGradingCoordinator expert;
    private final B2bGradingGateway gateway;
    private final B2bConfig config;
    private final boolean enabled;
    private final int configuredCapacity;
    private final Semaphore slots;
    private final ExecutorService workers;
    private final AtomicBoolean polling=new AtomicBoolean();
    private volatile boolean closed;
    public B2bAiScheduler(JdbcTemplate db,TransactionTemplate tx,GradingWorker full,ExpertGradingCoordinator expert,
                         B2bGradingGateway gateway,B2bConfig config,
                         @Value("${app.grading.worker-enabled:true}") boolean enabled,
                         @Value("${app.b2b.ai-concurrency:1}") int capacity) {
        if(capacity<1||capacity>8)throw new IllegalArgumentException("B2B AI concurrency must be between 1 and 8");
        this.db=db;this.tx=tx;this.full=full;this.expert=expert;this.gateway=gateway;this.config=config;
        this.enabled=enabled;configuredCapacity=capacity;slots=new Semaphore(capacity,true);
        workers=Executors.newFixedThreadPool(capacity);
    }
    @Scheduled(fixedDelay=1000)
    public void poll() {
        if(closed||!enabled||!config.enabled()||!polling.compareAndSet(false,true))return;
        try {
            if(slots.availablePermits()==0||!hasQueued())return;
            int limit=effectiveCapacity(); // Read-only discovery before claiming or consuming a slot.
            int records=availableRecords();
            while(records-->0&&limit>0&&!closed&&configuredCapacity-slots.availablePermits()<limit&&slots.tryAcquire()) {
                Job job;
                try {job=claimNext(limit);}catch(RuntimeException error){slots.release();return;}
                if(job==null){slots.release();return;}
                try {workers.execute(()->{try{execute(job);}finally{slots.release();poll();}});}
                catch(RejectedExecutionException error){slots.release();return;} // Claimed job is recovered by its lease, never replay a POST.
            }
        } finally {polling.set(false);}
    }
    protected boolean hasQueued(){return Boolean.TRUE.equals(db.queryForObject("SELECT EXISTS(SELECT 1 FROM grading_jobs WHERE state='ready' AND available_at<=clock_timestamp()) OR EXISTS(SELECT 1 FROM expert_grading_jobs WHERE state='queued')",Boolean.class));}
    protected int effectiveCapacity(){return gateway.capabilities().isEmpty()?0:Math.min(configuredCapacity,Math.max(0,gateway.concurrency()));}
    protected int availableRecords(){return gateway.availableRunRecords();}
    public Job claimNext(int capacity) {
        if(capacity<1||capacity>configuredCapacity)return null;
        return tx.execute(t->{
            // Cross-process reservation: count and claim are serialized without holding the lock during I/O.
            db.queryForList("SELECT pg_advisory_xact_lock(995013)");
            db.update("UPDATE expert_grading_jobs SET state='unknown',error_code='unknown_after_dispatch',updated_at=clock_timestamp() WHERE state='pending' AND deadline_at<clock_timestamp()");
            int active=db.queryForObject("SELECT (SELECT count(*) FROM (SELECT submission_id FROM grading_jobs WHERE state IN('claimed','dispatching') AND lease_until>clock_timestamp() UNION SELECT r.submission_id FROM grading_runs r WHERE r.outcome IN('unknown_after_dispatch','cancelled_no_result','no_result_finalized') AND r.created_at+interval '7 minutes'>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM local_ai_acknowledgements a WHERE a.run_id=r.id)) reserved)+(SELECT count(*) FROM expert_grading_jobs j WHERE j.state='pending' OR (j.state IN('unknown','stale') AND j.deadline_at>clock_timestamp() AND NOT EXISTS(SELECT 1 FROM local_ai_acknowledgements a WHERE a.run_id=j.id)))",Integer.class);
            if(active>=capacity)return null;
            var rows=db.queryForList("SELECT kind,id FROM (SELECT 'photo' kind,submission_id id,available_at created FROM grading_jobs WHERE state='ready' AND available_at<=clock_timestamp() UNION ALL SELECT 'expert',id,created_at FROM expert_grading_jobs WHERE state='queued') q ORDER BY created,id LIMIT 1");
            if(rows.isEmpty())return null;
            var row=rows.getFirst();UUID id=(UUID)row.get("id");
            if(row.get("kind").equals("photo")) {
                var claimed=db.queryForList("UPDATE grading_jobs SET state='claimed',fencing_token=fencing_token+1,lease_until=clock_timestamp()+interval '90 seconds',updated_at=clock_timestamp() WHERE submission_id=? AND state='ready' RETURNING fencing_token",id);
                return claimed.isEmpty()?null:new Job("photo",id,((Number)claimed.getFirst().get("fencing_token")).longValue());
            }
            int changed=db.update("UPDATE expert_grading_jobs SET state='pending',deadline_at=clock_timestamp()+interval '7 minutes',updated_at=clock_timestamp() WHERE id=? AND state='queued'",id);
            return changed==1?new Job("expert",id,0):null;
        });
    }
    protected void execute(Job job){if(job.kind().equals("photo"))full.execute(new GradingWorker.Claim(job.id(),job.fence()));else expert.executeQueued(job.id());}
    /** ACK only durable outcomes; full-photo additionally requires all terminal observer events imported. */
    @Scheduled(fixedDelay=5000)
    public void acknowledgeCompleted() {
        if(closed||!enabled||!config.enabled())return;
        db.update("UPDATE expert_grading_jobs SET state='unknown',error_code='unknown_after_dispatch',updated_at=clock_timestamp() WHERE state='pending' AND deadline_at<clock_timestamp()");
        var rows=db.queryForList("SELECT id FROM (SELECT r.id FROM grading_runs r JOIN local_demo_observer_jobs o ON o.ai_run_id=r.id WHERE r.outcome IS NOT NULL AND o.completed_at IS NOT NULL UNION ALL SELECT j.id FROM expert_grading_jobs j JOIN expert_works w ON w.id=j.work_id JOIN grading_submissions s ON s.id=w.submission_id WHERE j.state IN('succeeded','failed','unknown','stale') AND j.deadline_at IS NOT NULL AND s.origin IN('school','local_demo')) completed WHERE NOT EXISTS(SELECT 1 FROM local_ai_acknowledgements a WHERE a.run_id=completed.id) LIMIT 16");
        for(var row:rows){UUID id=(UUID)row.get("id");if(gateway.acknowledge(id))db.update("INSERT INTO local_ai_acknowledgements(run_id) VALUES(?) ON CONFLICT DO NOTHING",id);}
    }
    @PreDestroy public void close(){closed=true;workers.shutdown();}
}
