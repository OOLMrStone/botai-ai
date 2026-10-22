package org.botai.back.security;

import lombok.RequiredArgsConstructor;
import org.botai.back.common.ApiException;
import org.botai.back.user.User;
import org.botai.back.user.Role;
import org.botai.back.user.UserRepository;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CurrentActor {
    private final UserRepository users;
    private final org.springframework.session.FindByIndexNameSessionRepository<? extends org.springframework.session.Session> sessions;
    public User require(Authentication authentication) {
        if(authentication==null||!authentication.isAuthenticated())throw new ApiException(401,"session_required","Войди в аккаунт");
        User user=users.findByEmail(authentication.getName()).orElse(null);
        boolean currentRole=user!=null&&authentication.getAuthorities().stream().anyMatch(authority->authority.getAuthority().equals("ROLE_"+user.getRole().name()));
        if(user==null||!user.isEnabled()||!currentRole) {
            sessions.findByPrincipalName(authentication.getName()).keySet().forEach(sessions::deleteById);
            throw new ApiException(401,"session_required","Войди в аккаунт");
        }
        return user;
    }
    public User requireAdmin(Authentication authentication) {
        User user=require(authentication);
        if(user.getRole()!=Role.ADMIN)throw new ApiException(403,"forbidden","Доступ запрещён");return user;
    }
}
