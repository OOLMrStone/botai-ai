// Заглушка dev-панели для продовой сборки: next.config подменяет ею модуль
// DevTools, поэтому ни кода панели, ни тестовых данных в проде физически нет.
export function DevTools() {
  return null;
}
