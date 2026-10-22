// Хранилище мок-бэкенда. Лежит файлом в .dev-data/ (в gitignore), поэтому
// аккаунты, сессии и тарифы переживают перезапуск dev-сервера - можно спокойно
// тестировать вход и подписку. С реальным бэком папка просто не создаётся.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { DEMO_ACCOUNT } from '@/config/dev';
import { DEFAULT_PLAN, type PlanId } from '@/config/plans';
import type { User } from '@/lib/api/auth';

export interface Account extends User {
  password: string;
  plan: PlanId;
}

interface Snapshot {
  accounts: Record<string, Account>;
  sessions: Record<string, string>; // токен сессии → почта аккаунта
}

const DB_FILE = join(process.cwd(), '.dev-data', 'mock-db.json');

// Демо-аккаунт для мгновенного входа без регистрации (им же логинится dev-панель).
const demo: Account = {
  id: 'u-demo',
  ...DEMO_ACCOUNT,
  role: 'USER',
  authProvider: 'LOCAL',
  plan: DEFAULT_PLAN,
};

function load(): Snapshot {
  try {
    const saved = JSON.parse(readFileSync(DB_FILE, 'utf8')) as Snapshot;

    // Демо-аккаунт есть всегда, но сохранённый (например, с Pro) - главнее.
    return { accounts: { [demo.email]: demo, ...saved.accounts }, sessions: saved.sessions };
  } catch {
    // Файла ещё нет (или он битый) - начинаем с одного демо-аккаунта.
    return { accounts: { [demo.email]: demo }, sessions: {} };
  }
}

const snapshot = load();

function persist(): void {
  mkdirSync(dirname(DB_FILE), { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
}

export function findAccount(email: string): Account | undefined {
  return snapshot.accounts[email];
}

export function saveAccount(account: Account): void {
  snapshot.accounts[account.email] = account;
  persist();
}

export function openSession(token: string, email: string): void {
  snapshot.sessions[token] = email;
  persist();
}

export function closeSession(token: string): void {
  delete snapshot.sessions[token];
  persist();
}

export function sessionAccount(token: string | undefined): Account | undefined {
  const email = token ? snapshot.sessions[token] : undefined;
  return email ? snapshot.accounts[email] : undefined;
}
