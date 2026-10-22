'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { STUDENT_ENTRY } from '@/config/student-entry';
import { useAuthStore } from '@/stores/auth-store';

export function useStudentEntry() {
  const router = useRouter();
  const refresh = useAuthStore((state) => state.refresh);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) return;

    let active = true;

    void refresh().then(
      (user) => {
        if (active) router.replace(user ? STUDENT_ENTRY.authenticated : STUDENT_ENTRY.anonymous);
      },
      () => {
        if (active) setFailed(true);
      },
    );

    return () => {
      active = false;
    };
  }, [failed, refresh, router]);

  return { failed, retry: () => setFailed(false) };
}
