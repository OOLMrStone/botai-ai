import { create } from 'zustand';
import { syncAccountState } from '@/lib/account-state';

import { fetchCurrentUser, logoutUser, type User } from '@/lib/api/auth';

// 'unknown' - ещё не спрашивали бэкенд, 'anonymous' - сессии нет.
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous' | 'error';

interface AuthState {
  user: User | null;
  status: AuthStatus;

  // Спросить бэкенд «кто я» (GET /api/auth/me) и обновить стор.
  refresh: () => Promise<User | null>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

// Истина о сессии живёт на бэкенде (кука SESSION), стор - лишь кэш в памяти.
// Сознательно без persist: после перезагрузки страницы состояние восстанавливает
// refresh(), а не localStorage - иначе можно показать «вошедшего» без сессии.
let refreshRequest: Promise<User | null> | null = null;
let sessionRevision = 0;

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  status: 'unknown',

  refresh: () => {
    if (refreshRequest) return refreshRequest;

    set({ status: 'unknown' });
    const revision = sessionRevision;
    const request = fetchCurrentUser()
      .then((user) => {
        // Ответ старой проверки не должен отменить более поздний вход или выход.
        if (revision !== sessionRevision) return get().user;

        syncAccountState(user?.id ?? null);
        set({ user, status: user ? 'authenticated' : 'anonymous' });
        return user;
      })
      .catch((error: unknown) => {
        if (revision === sessionRevision) set({ status: 'error' });
        throw error;
      })
      .finally(() => {
        if (refreshRequest === request) refreshRequest = null;
      });

    refreshRequest = request;
    return request;
  },

  setUser: (user) => {
    sessionRevision += 1;
    refreshRequest = null;
    syncAccountState(user.id);
    set({ user, status: 'authenticated' });
  },

  logout: async () => {
    await logoutUser();
    sessionRevision += 1;
    refreshRequest = null;
    syncAccountState(null);
    set({ user: null, status: 'anonymous' });
  },
}));
