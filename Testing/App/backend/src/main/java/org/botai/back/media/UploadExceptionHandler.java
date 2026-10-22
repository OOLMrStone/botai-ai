package org.botai.back.media;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.botai.back.grading.SubmissionStore;
import org.botai.back.security.CurrentActor;
import org.botai.back.common.ApiProblems;
import org.springframework.core.annotation.Order;
import org.springframework.http.ProblemDetail;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import java.util.*;

@RestControllerAdvice
@Order(-10)
@RequiredArgsConstructor
public class UploadExceptionHandler {
    private final SubmissionStore store;private final CurrentActor actors;private final TransactionTemplate tx;
    @ExceptionHandler(MaxUploadSizeExceededException.class) public ProblemDetail tooLarge(MaxUploadSizeExceededException exception,HttpServletRequest request){
        var match=java.util.regex.Pattern.compile("^/api/submissions/([a-fA-F0-9-]{36})/(?:images|documents)$").matcher(request.getRequestURI());
        if(match.matches())try{UUID user=actors.require(SecurityContextHolder.getContext().getAuthentication()).getId();UUID id=UUID.fromString(match.group(1));tx.executeWithoutResult(t->{var s=store.row(id,user,true);if(s.status().equals("draft"))store.event(id,"upload_rejected",user,Map.of("reason","file_size","phase","multipart"));});}catch(Exception ignored){/* Foreign/missing intent is never disclosed; edge failures cannot create owner history. */}
        return ApiProblems.of(413,"file_size","Файл слишком большой");
    }
}
