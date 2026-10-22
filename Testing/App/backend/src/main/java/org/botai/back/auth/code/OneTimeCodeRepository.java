package org.botai.back.auth.code;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;

import java.util.Optional;
import java.util.UUID;

public interface OneTimeCodeRepository extends JpaRepository<OneTimeCode, UUID> {

    Optional<OneTimeCode> findTopByUserIdAndPurposeOrderByCreatedAtDesc(UUID userId, CodePurpose purpose);

    @Modifying
    void deleteByUserIdAndPurpose(UUID userId, CodePurpose purpose);
}
