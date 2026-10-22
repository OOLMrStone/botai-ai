import { BrandText } from '@/components/onboarding/BrandText';

interface HighlightTextProps {
  text: string;
}

// Разбирает строку по `*слово*` на обычный текст и курсивные акценты - один способ
// выделить часть текста внутри заголовка/подписи, вместо ручной сборки JSX на каждом экране.
export function HighlightText({ text }: HighlightTextProps) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const [key, match] of [...text.matchAll(/\*(.+?)\*/g)].entries()) {
    if (match.index > lastIndex)
      parts.push(<BrandText key={`plain-${key}`} text={text.slice(lastIndex, match.index)} />);
    parts.push(
      <span key={key} className="italic">
        <BrandText text={match[1]} />
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(<BrandText key="tail" text={text.slice(lastIndex)} />);

  return <>{parts}</>;
}
