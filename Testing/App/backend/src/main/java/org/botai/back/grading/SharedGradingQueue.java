package org.botai.back.grading;

import org.springframework.jdbc.core.JdbcTemplate;

/** Shared durable backlog budget; callers hold this transaction lock through enqueue. */
public final class SharedGradingQueue {
    private SharedGradingQueue() { }
    public static boolean full(JdbcTemplate db,int limit) {
        db.execute("SELECT pg_advisory_xact_lock(726118013)");
        return db.queryForObject("SELECT (SELECT count(*) FROM grading_jobs WHERE state<>'done') + (SELECT count(*) FROM expert_grading_jobs WHERE state='queued' OR (state IN('pending','unknown') AND deadline_at>clock_timestamp()))",Integer.class)>=limit;
    }
}
