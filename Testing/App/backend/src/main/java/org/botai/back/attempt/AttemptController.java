package org.botai.back.attempt;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.botai.back.catalog.CatalogDtos;
import org.botai.back.common.Page;
import org.botai.back.security.CurrentActor;
import org.springframework.security.core.Authentication;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import java.util.UUID;
import static org.botai.back.attempt.AttemptDtos.*;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AttemptController {
    private final AttemptService service;
    private final CurrentActor actors;
    @PostMapping("/training-attempts") public Attempt training(Authentication auth,@RequestHeader("Idempotency-Key") String key,@Valid @RequestBody TrainingRequest request) { return service.startTraining(actors.require(auth).getId(),key,request); }
    @GetMapping("/attempts") public Page<Attempt> history(Authentication auth,@RequestParam(required=false) String kind,@RequestParam(required=false) UUID templateId,@RequestParam(required=false) String status,@RequestParam(required=false) String cursor,@RequestParam(required=false) Integer limit) { return service.history(actors.require(auth).getId(),kind,templateId,status,cursor,limit); }
    @GetMapping("/attempts/{id}") public Attempt get(Authentication auth,@PathVariable UUID id) { return service.get(actors.require(auth).getId(),id); }
    @PatchMapping("/attempts/{id}") public Attempt patch(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Patch patch) { return service.patch(actors.require(auth).getId(),id,patch); }
    @DeleteMapping("/attempts/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) public void delete(Authentication auth,@PathVariable UUID id) { service.delete(actors.require(auth).getId(),id); }
    @PostMapping("/attempts/{id}/exit") @ResponseStatus(HttpStatus.NO_CONTENT) public void exit(Authentication auth,@PathVariable UUID id,@Valid @RequestBody Exit request) { service.exit(actors.require(auth).getId(),id,request); }
    @GetMapping("/mock-exams") public Page<Exam> exams(Authentication auth,@RequestParam(required=false) String cursor,@RequestParam(required=false) Integer limit) { return service.exams(actors.require(auth).getId(),cursor,limit); }
    @PostMapping("/mock-exams/{id}/attempts") public Attempt exam(Authentication auth,@PathVariable UUID id,@RequestHeader("Idempotency-Key") String key) { return service.startExam(actors.require(auth).getId(),id,key); }
    @GetMapping("/attempts/{id}/items/{item}/solution") public CatalogDtos.Solution solution(Authentication auth,@PathVariable UUID id,@PathVariable UUID item) { return service.solution(actors.require(auth).getId(),id,item); }
    @PostMapping("/attempts/{id}/items/{item}/solution-reveal") public CatalogDtos.Solution reveal(Authentication auth,@PathVariable UUID id,@PathVariable UUID item,@Valid @RequestBody SolutionReveal request) { return service.reveal(actors.require(auth).getId(),id,item,request); }
}
