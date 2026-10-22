package org.botai.back.learning;

import org.botai.back.attempt.DifficultySelection;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class DifficultySelectionTest {
    List<DifficultySelection.Candidate> pool() {
        var result=new ArrayList<DifficultySelection.Candidate>();
        for(int i=0;i<=5;i++)result.add(new DifficultySelection.Candidate(new UUID(0,i),i==0?null:i,false));
        return result;
    }
    @Test void endpointsAreStrictAndUnknownNeverPretendsToBeRated() {
        var all=pool();
        assertThat(DifficultySelection.select(all,1,0,new Random(1))).containsExactly(new UUID(0,1));
        assertThat(DifficultySelection.select(all,2,100,new Random(1))).containsExactlyInAnyOrder(new UUID(0,4),new UUID(0,5));
        assertThatThrownBy(()->DifficultySelection.select(all,2,0,new Random(1))).hasMessageContaining("недостаточно");
        assertThatThrownBy(()->DifficultySelection.select(all,3,100,new Random(1))).hasMessageContaining("недостаточно");
        assertThat(DifficultySelection.select(all,6,50,new Random(1))).hasSize(6).doesNotHaveDuplicates().endsWith(new UUID(0,0));
    }
    @Test void seededSamplingTracksSmoothCategoryWeightsInsteadOfPoolSize() {
        var all=pool();var random=new Random(7123);int[] counts=new int[6];
        for(int n=0;n<20000;n++)counts[(int)DifficultySelection.select(all,1,50,random).getFirst().getLeastSignificantBits()]++;
        assertThat(counts[0]).isZero();assertThat((counts[2]+counts[3])/20000.0).isBetween(.88,.92);
        for(int level=1;level<=5;level++)assertThat(counts[level]/20000.0).isCloseTo(DifficultySelection.weights(50)[level-1],within(.015));
        for(int p=1;p<=100;p++)for(int level=0;level<5;level++)assertThat(Math.abs(DifficultySelection.weights(p)[level]-DifficultySelection.weights(p-1)[level])).isLessThan(.03);
    }
    @Test void solvedPreferenceDoesNotOverrideCategoryOrDuplicateTasks() {
        var first=new DifficultySelection.Candidate(new UUID(0,1),1,true);
        var second=new DifficultySelection.Candidate(new UUID(0,2),1,false);
        assertThat(DifficultySelection.select(List.of(first,second),2,0,new Random(4))).containsExactly(second.versionId(),first.versionId());
        assertThatThrownBy(()->DifficultySelection.weights(101)).hasMessageContaining("100");
    }
}
