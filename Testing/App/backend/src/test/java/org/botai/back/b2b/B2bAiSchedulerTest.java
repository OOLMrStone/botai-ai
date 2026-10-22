package org.botai.back.b2b;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class B2bAiSchedulerTest {
    static class QueueScheduler extends B2bAiScheduler {
        final Queue<Job> queue=new ConcurrentLinkedQueue<>();
        final Map<UUID,CountDownLatch> releases=new ConcurrentHashMap<>(),started=new ConcurrentHashMap<>();
        final AtomicInteger active=new AtomicInteger(),maximum=new AtomicInteger(),claims=new AtomicInteger();
        volatile int advertised,records=100;
        QueueScheduler(int capacity){super(null,null,null,null,null,new B2bConfig(true,false,""),true,capacity);advertised=capacity;}
        Job add(String kind){Job j=new Job(kind,UUID.randomUUID(),1);queue.add(j);releases.put(j.id(),new CountDownLatch(1));started.put(j.id(),new CountDownLatch(1));return j;}
        protected boolean hasQueued(){return !queue.isEmpty();}
        protected int effectiveCapacity(){return advertised;}
        protected int availableRecords(){return records;}
        public Job claimNext(int capacity){var job=queue.poll();if(job!=null)claims.incrementAndGet();return job;}
        protected void execute(Job job){int n=active.incrementAndGet();maximum.accumulateAndGet(n,Math::max);started.get(job.id()).countDown();try{if(!releases.get(job.id()).await(5,TimeUnit.SECONDS))throw new AssertionError("Test blocked");}catch(InterruptedException e){Thread.currentThread().interrupt();}finally{active.decrementAndGet();}}
        void releaseAll(){releases.values().forEach(CountDownLatch::countDown);}
    }
    @Test void fourSharedSlotsStartEAsSoonAsBFinishesWithoutWaitingForOtherThree()throws Exception{
        var s=new QueueScheduler(4);
        try {
            var a=s.add("photo");var b=s.add("expert");var c=s.add("photo");var d=s.add("expert");var e=s.add("photo");
            s.poll();for(var job:List.of(a,b,c,d))assertThat(s.started.get(job.id()).await(2,TimeUnit.SECONDS)).isTrue();
            assertThat(s.claims).hasValue(4);assertThat(s.started.get(e.id()).getCount()).isEqualTo(1);
            s.releases.get(b.id()).countDown();assertThat(s.started.get(e.id()).await(2,TimeUnit.SECONDS)).isTrue();
            for(var job:List.of(a,c,d))assertThat(s.releases.get(job.id()).getCount()).isEqualTo(1);
            assertThat(s.maximum).hasValue(4);assertThat(s.claims).hasValue(5);
        }finally{s.close();s.releaseAll();}
    }
    @Test void unavailableCapacityDoesNotClaimOrStartDeadlines()throws Exception{
        var s=new QueueScheduler(2);
        try{s.add("expert");s.advertised=0;s.poll();assertThat(s.claims).hasValue(0);assertThat(s.queue).hasSize(1);s.advertised=1;s.poll();assertThat(s.claims).hasValue(1);}finally{s.close();s.releaseAll();}
    }
    @Test void fullTraceStoreLeavesJobsQueuedWithoutHoldingSlots(){var s=new QueueScheduler(2);try{s.add("photo");s.records=0;s.poll();assertThat(s.claims).hasValue(0);s.records=1;s.poll();assertThat(s.claims).hasValue(1);}finally{s.close();s.releaseAll();}}

}
