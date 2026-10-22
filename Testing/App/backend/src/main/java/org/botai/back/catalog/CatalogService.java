package org.botai.back.catalog;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.Page;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import static org.botai.back.catalog.CatalogDtos.*;

@Service
@RequiredArgsConstructor
@Transactional(readOnly=true)
public class CatalogService {
    private final CatalogRepository repository;
    public Catalog catalog() { return new Catalog(repository.format(CatalogRepository.FORMAT),repository.numbers(CatalogRepository.FORMAT)); }
    public Task task(UUID user,UUID task) { return repository.version(repository.currentVersion(task),user); }
    public Task version(UUID user,UUID version) { return repository.version(version,user); }
    public TaskSnapshot snapshot(UUID version) { return repository.snapshot(version); }
    public boolean aiInputReady(UUID version) { return repository.aiInputReady(version); }
    public Solution solution(UUID version,String mediaPrefix) { var snapshot=snapshot(version);return new Solution(snapshot.referenceAnswer(),snapshot.referenceSolution(),repository.referenceContent(version,mediaPrefix),repository.referenceAnswerContent(version,mediaPrefix)); }
    public Page<Task> list(UUID user,Integer number,String topic,Integer difficulty,boolean favourite,String cursor,Integer size) {
        int limit=Page.limit(size),offset=Page.offset(cursor);
        return Page.of(repository.find(user,number,topic,difficulty,favourite,offset,limit+1).stream().map(id->repository.version(id,user)).toList(),offset,limit);
    }
    @Transactional public void favourite(UUID user,UUID task,boolean add) { repository.favourite(user,task,add); }
    public Task daily(UUID user) {
        var ids=repository.find(user,7,null,null,false,0,50);
        long day=LocalDate.now(ZoneId.of("Europe/Moscow")).toEpochDay();
        return repository.version(ids.get(Math.floorMod(day,ids.size())),user);
    }
    public Solution dailySolution(UUID user) { return solution(daily(user).taskVersionId(),"/api/daily-task/solution-media/"); }
}
