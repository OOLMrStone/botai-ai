package org.botai.back.attempt;

import org.botai.back.common.ApiException;
import java.util.*;
import java.util.random.RandomGenerator;

/** Category weights are independent of category size; unknown is never a numeric rating. */
public final class DifficultySelection {
    private DifficultySelection() { }
    public record Candidate(UUID versionId,Integer difficulty,boolean solved) { }
    private static final double[] LOW={1,0,0,0,0},MIDDLE={.05,.45,.45,.04,.01},HIGH={0,0,0,.7,.3};
    public static void validate(Integer preference) {
        if(preference!=null&&(preference<0||preference>100))throw ApiException.invalid("Предпочтение сложности от 0 до 100");
    }
    public static boolean eligible(Integer level,Integer preference) {
        validate(preference);
        if(preference==null)return true;
        if(preference==0)return Objects.equals(level,1);
        if(preference==100)return level!=null&&level>=4;
        return true;
    }
    public static double[] weights(int preference) {
        validate(preference);
        double t=preference<=50?preference/50.0:(preference-50)/50.0;
        t=t*t*(3-2*t);
        var left=preference<=50?LOW:MIDDLE;var right=preference<=50?MIDDLE:HIGH;
        var result=new double[5];for(int i=0;i<5;i++)result[i]=left[i]+(right[i]-left[i])*t;
        return result;
    }
    public static List<UUID> select(List<Candidate> candidates,int count,Integer preference,RandomGenerator random) {
        validate(preference);
        var remaining=new ArrayList<>(candidates.stream().filter(c->eligible(c.difficulty(),preference)).toList());
        if(remaining.size()<count)throw new ApiException(409,"insufficient_tasks","В выбранных темах пока недостаточно задач нужной сложности");
        var selected=new ArrayList<UUID>();
        var weights=weights(preference==null?50:preference);
        for(int n=0;n<count;n++) {
            // Known ratings have priority over unknown at every interior position.
            var available=new boolean[5];for(var c:remaining)if(c.difficulty()!=null)available[c.difficulty()-1]=true;
            double total=0;for(int i=0;i<5;i++)if(available[i])total+=weights[i];
            Integer chosen=null;
            if(total>0) {
                double draw=random.nextDouble()*total;
                for(int i=0;i<5;i++)if(available[i]&&weights[i]>0) {draw-=weights[i];if(draw<0) {chosen=i+1;break;}}
                if(chosen==null)for(int i=4;i>=0;i--)if(available[i]&&weights[i]>0) {chosen=i+1;break;}
            }
            final Integer level=chosen;
            var bucket=remaining.stream().filter(c->Objects.equals(c.difficulty(),level)).toList();
            var unsolved=bucket.stream().filter(c->!c.solved()).toList();if(!unsolved.isEmpty())bucket=unsolved;
            var winner=bucket.get(random.nextInt(bucket.size()));selected.add(winner.versionId());remaining.remove(winner);
        }
        return selected;
    }
}
