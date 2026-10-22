export function flowProgress(pathname: string, steps: readonly string[]) {
  const slug = pathname.split('/').filter(Boolean).pop() ?? '';
  const completed = steps.indexOf(slug);

  if (completed <= 0) return null;

  return { value: completed, max: steps.length - 1 };
}
