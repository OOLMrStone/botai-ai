export const SHORT_ANSWER = {
  draft: /^-?(?:\d+(?:[.,]\d*)?)?$/,
  complete: /^-?\d+(?:[.,]\d+)?$/,
  separator: /[.,]/,
  leadingZeros: /^0+(?=\d)/,
  trailingZeros: /0+$/,
  minus: '-',
  decimal: '.',
  zero: '0',
  errorId: (id: string) => `${id}-format-error`,
} as const;

export const SHORT_ANSWER_COPY = {
  invalid: 'Введи целое число или десятичную дробь, например -2,5',
  incomplete: 'Допиши число после знака или запятой',
  invalidHint: 'Введи здесь число',
  incompleteHint: 'Допиши число',
} as const;
