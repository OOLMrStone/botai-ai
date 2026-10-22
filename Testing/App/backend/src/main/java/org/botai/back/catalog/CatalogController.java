package org.botai.back.catalog;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.Page;
import org.botai.back.security.CurrentActor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.UUID;
import static org.botai.back.catalog.CatalogDtos.*;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class CatalogController {
    private final CatalogService service;
    private final CurrentActor actors;
    @GetMapping("/catalog") public Catalog catalog(Authentication auth) { actors.require(auth);return service.catalog(); }
    @GetMapping("/tasks") public Page<Task> tasks(Authentication auth,@RequestParam(required=false) Integer examNumber,@RequestParam(required=false) String topicId,
            @RequestParam(required=false) Integer difficulty,@RequestParam(defaultValue="false") boolean favourite,@RequestParam(required=false) String cursor,@RequestParam(required=false) Integer limit) {
        return service.list(actors.require(auth).getId(),examNumber,topicId,difficulty,favourite,cursor,limit);
    }
    @GetMapping("/tasks/{id}") public Task task(Authentication auth,@PathVariable UUID id) { return service.task(actors.require(auth).getId(),id); }
    @GetMapping("/favorites") public Page<Task> favourites(Authentication auth,@RequestParam(required=false) String cursor,@RequestParam(required=false) Integer limit) { return service.list(actors.require(auth).getId(),null,null,null,true,cursor,limit); }
    @PutMapping("/favorites/{id}") public Map<String,Object> add(Authentication auth,@PathVariable UUID id) { service.favourite(actors.require(auth).getId(),id,true);return Map.of("taskId",id,"isFavourite",true); }
    @DeleteMapping("/favorites/{id}") public Map<String,Object> remove(Authentication auth,@PathVariable UUID id) { service.favourite(actors.require(auth).getId(),id,false);return Map.of("taskId",id,"isFavourite",false); }
    @GetMapping("/daily-task") public Task daily(Authentication auth) { return service.daily(actors.require(auth).getId()); }
    @GetMapping("/daily-task/solution") public Solution dailySolution(Authentication auth) { return service.dailySolution(actors.require(auth).getId()); }
}
