export type QuizDifficulty = 'basic' | 'challenge';

interface QuizQuestionBase {
  id: string;
  difficulty: QuizDifficulty;
  prompt: string;
  context: string;
  explanation: string;
}

export interface QuizOption {
  id: string;
  latex: string;
}

export interface QuizChoiceQuestion extends QuizQuestionBase {
  kind: 'choice';
  options: QuizOption[];
  answerIds: string[];
}

export interface QuizBuildQuestion extends QuizQuestionBase {
  kind: 'build';
  options: QuizOption[];
  answerIds: string[];
  equivalentAnswerIds?: string[][];
}

export interface QuizPair {
  id: string;
  left: string;
  right: string;
}

export interface QuizPairsQuestion extends QuizQuestionBase {
  kind: 'pairs';
  pairs: QuizPair[];
}

export type QuizQuestion = QuizChoiceQuestion | QuizBuildQuestion | QuizPairsQuestion;

export type QuizTopicId = 'trigonometry' | 'probability';

export interface QuizTopic {
  id: QuizTopicId;
  title: string;
  description: string;
  eyebrow: string;
  formula: string;
  questions: QuizQuestion[];
}

export const QUIZ_TOPICS: QuizTopic[] = [
  {
    id: 'trigonometry',
    title: 'Тригонометрические формулы',
    description: 'Преобразуй выражения и замечай короткий путь к ответу',
    eyebrow: 'К заданиям 7 и 13',
    formula: '\\sin 2\\alpha',
    questions: [
      {
        id: 'trig-basic-product',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin 15° · cos 15°',
        explanation: 'Произведение равно половине sin 30°. Поэтому ответ: ½ · ½ = ¼',
        options: [
          {
            id: 'a',
            latex: '\\frac12',
          },
          {
            id: 'b',
            latex: '\\frac14',
          },
          {
            id: 'c',
            latex: '\\frac{\\sqrt3}{4}',
          },
          {
            id: 'd',
            latex: '\\frac{\\sqrt3}{2}',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-basic-sign',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди cos α',
        context: 'sin α = ⅗, π/2 < α < π',
        explanation:
          'Из основного тождества cos² α = 16/25. Во второй четверти косинус отрицателен, поэтому cos α = -4/5',
        options: [
          {
            id: 'a',
            latex: '\\frac45',
          },
          {
            id: 'b',
            latex: '-\\frac35',
          },
          {
            id: 'c',
            latex: '-\\frac45',
          },
          {
            id: 'd',
            latex: '\\frac{16}{25}',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'trig-basic-double-angle',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation:
          'Разность квадратов даёт cos 2α, удвоенное произведение - sin 2α. Выражение 1 - 2cos² α равно -cos 2α',
        pairs: [
          {
            id: 'a',
            left: '\\cos^2\\alpha-\\sin^2\\alpha',
            right: '\\cos 2\\alpha',
          },
          {
            id: 'b',
            left: '2\\sin\\alpha\\cdot\\cos\\alpha',
            right: '\\sin 2\\alpha',
          },
          {
            id: 'c',
            left: '1-2\\cos^2\\alpha',
            right: '-\\cos 2\\alpha',
          },
        ],
      },
      {
        id: 'trig-basic-reduction',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation:
          'Дополнение до π/2 меняет косинус на синус. При π - α косинус меняет знак, а при π + α знак меняет синус',
        pairs: [
          {
            id: 'a',
            left: '\\cos(\\frac\\pi2-\\alpha)',
            right: '\\sin\\alpha',
          },
          {
            id: 'b',
            left: '\\cos(\\pi-\\alpha)',
            right: '-\\cos\\alpha',
          },
          {
            id: 'c',
            left: '\\sin(\\pi+\\alpha)',
            right: '-\\sin\\alpha',
          },
        ],
      },
      {
        id: 'trig-basic-build-square',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: '(sin α + cos α)²',
        explanation:
          'После раскрытия скобок sin² α + cos² α дают 1, а 2sin α cos α превращается в sin 2α',
        options: [
          {
            id: 'a',
            latex: '\\sin 2\\alpha',
          },
          {
            id: 'b',
            latex: '-',
          },
          {
            id: 'c',
            latex: '1',
          },
          {
            id: 'd',
            latex: '+',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'trig-basic-build-double',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: 'cos² α - sin² α',
        explanation:
          'Замени cos² α на 1 - sin² α. Два одинаковых вычитаемых объединяются в 2sin² α',
        options: [
          {
            id: 'a',
            latex: '2\\sin^2\\alpha',
          },
          {
            id: 'b',
            latex: '1',
          },
          {
            id: 'c',
            latex: '+',
          },
          {
            id: 'd',
            latex: '-',
          },
        ],
        answerIds: ['b', 'd', 'a'],
      },
      {
        id: 'trig-challenge-quotient',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin 2α / cos² α, если tan α = 2',
        explanation: 'Подставь sin 2α = 2sin α cos α и сократи один cos α. Получится 2tan α = 4',
        options: [
          {
            id: 'a',
            latex: '2',
          },
          {
            id: 'b',
            latex: '4',
          },
          {
            id: 'c',
            latex: '\\frac45',
          },
          {
            id: 'd',
            latex: '\\frac25',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-challenge-sign',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди sin 2α',
        context: 'cos α = -⅗, π < α < 3π/2',
        explanation: 'В третьей четверти sin α = -4/5. Тогда sin 2α = 2 · (-4/5) · (-3/5) = 24/25',
        options: [
          {
            id: 'a',
            latex: '-\\frac{24}{25}',
          },
          {
            id: 'b',
            latex: '\\frac7{25}',
          },
          {
            id: 'c',
            latex: '\\frac{24}{25}',
          },
          {
            id: 'd',
            latex: '-\\frac7{25}',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'trig-challenge-collapse',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: 'Все знаменатели отличны от нуля',
        explanation:
          'Раскрой двойные углы: sin 2α = 2sin α cos α, 1 - cos 2α = 2sin² α, 1 + cos 2α = 2cos² α',
        pairs: [
          {
            id: 'a',
            left: '\\frac{\\sin 2\\alpha}{2\\sin\\alpha}',
            right: '\\cos\\alpha',
          },
          {
            id: 'b',
            left: '\\frac{1-\\cos 2\\alpha}{2\\sin\\alpha}',
            right: '\\sin\\alpha',
          },
          {
            id: 'c',
            left: '\\frac{\\sin 2\\alpha}{1+\\cos 2\\alpha}',
            right: '\\tan\\alpha',
          },
        ],
      },
      {
        id: 'trig-challenge-squares',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation:
          'Раскрой квадраты суммы и разности. Основное тождество даёт 1, а произведение синуса и косинуса заменяется формулой двойного угла',
        pairs: [
          {
            id: 'a',
            left: '(\\sin\\alpha+\\cos\\alpha)^2',
            right: '1+\\sin 2\\alpha',
          },
          {
            id: 'b',
            left: '(\\sin\\alpha-\\cos\\alpha)^2',
            right: '1-\\sin 2\\alpha',
          },
          {
            id: 'c',
            left: '4\\sin^2\\alpha\\cdot\\cos^2\\alpha',
            right: '\\sin^2 2\\alpha',
          },
        ],
      },
      {
        id: 'trig-challenge-build-ratio',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: '(1 - cos 2α) / sin 2α, sin 2α ≠ 0',
        explanation:
          'Числитель равен 2sin² α, знаменатель - 2sin α cos α. После сокращения получается sin α / cos α',
        options: [
          {
            id: 'a',
            latex: '\\cos\\alpha',
          },
          {
            id: 'b',
            latex: '\\cdot',
          },
          {
            id: 'c',
            latex: '\\sin\\alpha',
          },
          {
            id: 'd',
            latex: '\\div',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
      {
        id: 'trig-challenge-build-shift',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: 'sin²(α + π/4)',
        explanation:
          'Формула понижения степени даёт ½ - ½cos(2α + π/2). Здесь cos(2α + π/2) = -sin 2α, поэтому знак меняется на плюс',
        options: [
          {
            id: 'a',
            latex: '\\frac12\\sin 2\\alpha',
          },
          {
            id: 'b',
            latex: '-',
          },
          {
            id: 'c',
            latex: '\\frac12',
          },
          {
            id: 'd',
            latex: '+',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'trig-basic-cos30',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'cos² 15° - sin² 15°',
        explanation: 'Разность квадратов равна cos 30°, то есть √3/2',
        options: [
          {
            id: 'a',
            latex: '\\frac12',
          },
          {
            id: 'b',
            latex: '\\frac{\\sqrt3}{2}',
          },
          {
            id: 'c',
            latex: '0',
          },
          {
            id: 'd',
            latex: '1',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-basic-tan-value',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди tan α',
        context: 'sin α = 5/13, cos α = 12/13',
        explanation: 'Тангенс равен отношению синуса к косинусу: (5/13) / (12/13) = 5/12',
        options: [
          {
            id: 'a',
            latex: '\\frac5{12}',
          },
          {
            id: 'b',
            latex: '\\frac{12}5',
          },
          {
            id: 'c',
            latex: '\\frac5{13}',
          },
          {
            id: 'd',
            latex: '\\frac{60}{169}',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-basic-sin150',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin 150°',
        explanation: '150° = 180° - 30°. Во второй четверти синус положителен: sin 150° = sin 30°',
        options: [
          {
            id: 'a',
            latex: '-\\frac12',
          },
          {
            id: 'b',
            latex: '\\frac{\\sqrt3}2',
          },
          {
            id: 'c',
            latex: '\\frac12',
          },
          {
            id: 'd',
            latex: '-\\frac{\\sqrt3}2',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'trig-basic-period',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'cos 420°',
        explanation: 'Вычти 360°: cos 420° = cos 60° = 1/2',
        options: [
          {
            id: 'a',
            latex: '\\frac12',
          },
          {
            id: 'b',
            latex: '-\\frac12',
          },
          {
            id: 'c',
            latex: '\\frac{\\sqrt3}2',
          },
          {
            id: 'd',
            latex: '1',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-basic-negative',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin(-π/6)',
        explanation: 'Синус - нечётная функция: sin(-π/6) = -sin(π/6) = -1/2',
        options: [
          {
            id: 'a',
            latex: '\\frac12',
          },
          {
            id: 'b',
            latex: '-\\frac12',
          },
          {
            id: 'c',
            latex: '-\\frac{\\sqrt3}2',
          },
          {
            id: 'd',
            latex: '0',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-basic-sin-square',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди sin² α',
        context: 'cos α = 2/3',
        explanation: 'sin² α = 1 - cos² α = 1 - 4/9 = 5/9',
        options: [
          {
            id: 'a',
            latex: '\\frac13',
          },
          {
            id: 'b',
            latex: '\\frac49',
          },
          {
            id: 'c',
            latex: '\\frac59',
          },
          {
            id: 'd',
            latex: '\\frac79',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'trig-basic-double-cos',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди cos 2α',
        context: 'sin α = 1/3',
        explanation: 'cos 2α = 1 - 2sin² α = 1 - 2/9 = 7/9',
        options: [
          {
            id: 'a',
            latex: '\\frac79',
          },
          {
            id: 'b',
            latex: '\\frac89',
          },
          {
            id: 'c',
            latex: '\\frac13',
          },
          {
            id: 'd',
            latex: '-\\frac79',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-basic-sum-angle',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin 20° cos 40° + cos 20° sin 40°',
        explanation: 'Это sin(20° + 40°) = sin 60° = √3/2',
        options: [
          {
            id: 'a',
            latex: '\\frac12',
          },
          {
            id: 'b',
            latex: '\\frac{\\sqrt3}2',
          },
          {
            id: 'c',
            latex: '\\sin20^\\circ',
          },
          {
            id: 'd',
            latex: '1',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-basic-parity',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation: 'Косинус чётный, синус и тангенс нечётные',
        pairs: [
          {
            id: 'a',
            left: '\\sin(-\\alpha)',
            right: '-\\sin\\alpha',
          },
          {
            id: 'b',
            left: '\\cos(-\\alpha)',
            right: '\\cos\\alpha',
          },
          {
            id: 'c',
            left: '\\tan(-\\alpha)',
            right: '-\\tan\\alpha',
          },
        ],
      },
      {
        id: 'trig-basic-power-reduction',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation: 'Вырази квадраты через cos 2α, а произведение через sin 2α',
        pairs: [
          {
            id: 'a',
            left: '\\sin^2\\alpha',
            right: '\\frac{1-\\cos2\\alpha}{2}',
          },
          {
            id: 'b',
            left: '\\cos^2\\alpha',
            right: '\\frac{1+\\cos2\\alpha}{2}',
          },
          {
            id: 'c',
            left: '\\sin\\alpha\\cos\\alpha',
            right: '\\frac{\\sin2\\alpha}{2}',
          },
        ],
      },
      {
        id: 'trig-basic-special-values',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation: 'Используй табличные значения и знаки функций на окружности',
        pairs: [
          {
            id: 'a',
            left: '\\tan\\frac\\pi4',
            right: '1',
          },
          {
            id: 'b',
            left: '\\cos\\frac{2\\pi}3',
            right: '-\\frac12',
          },
          {
            id: 'c',
            left: '\\sin\\frac{3\\pi}2',
            right: '-1',
          },
        ],
      },
      {
        id: 'trig-basic-square-difference',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: '(sin α - cos α)²',
        explanation: 'Сумма квадратов равна 1, а удвоенное произведение вычитается',
        options: [
          {
            id: 'a',
            latex: '\\sin2\\alpha',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '1',
          },
          {
            id: 'd',
            latex: '-',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
      {
        id: 'trig-basic-cos-sum',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: 'cos(α + β) + cos(α - β)',
        explanation:
          'При сложении формул косинуса суммы и разности слагаемые с синусами сокращаются',
        options: [
          {
            id: 'a',
            latex: '\\cos\\alpha\\cos\\beta',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '2',
          },
          {
            id: 'd',
            latex: '\\cdot',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'trig-basic-sin-difference',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: 'sin(α - β)',
        explanation: 'В формуле синуса разности знак между произведениями отрицательный',
        options: [
          {
            id: 'a',
            latex: '\\cos\\alpha\\sin\\beta',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '\\sin\\alpha\\cos\\beta',
          },
          {
            id: 'd',
            latex: '-',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
      {
        id: 'trig-challenge-tan-double',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди cos 2α',
        context: 'tan α = 3',
        explanation: 'cos 2α = (1 - tan² α)/(1 + tan² α) = -8/10 = -4/5',
        options: [
          {
            id: 'a',
            latex: '-\\frac45',
          },
          {
            id: 'b',
            latex: '\\frac45',
          },
          {
            id: 'c',
            latex: '-\\frac35',
          },
          {
            id: 'd',
            latex: '\\frac35',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-challenge-sum-known',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди sin 2α',
        context: 'sin α + cos α = 1/2',
        explanation: 'Квадрат суммы равен 1 + sin 2α. Поэтому sin 2α = 1/4 - 1 = -3/4',
        options: [
          {
            id: 'a',
            latex: '\\frac14',
          },
          {
            id: 'b',
            latex: '-\\frac34',
          },
          {
            id: 'c',
            latex: '\\frac34',
          },
          {
            id: 'd',
            latex: '-\\frac12',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-challenge-fourth-powers',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin⁴ α + cos⁴ α, если sin 2α = 3/5',
        explanation: 'Сумма четвёртых степеней равна 1 - 2sin² α cos² α = 1 - sin² 2α / 2 = 41/50',
        options: [
          {
            id: 'a',
            latex: '\\frac{41}{50}',
          },
          {
            id: 'b',
            latex: '\\frac{16}{25}',
          },
          {
            id: 'c',
            latex: '\\frac9{25}',
          },
          {
            id: 'd',
            latex: '\\frac{23}{25}',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-challenge-half-angle',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди sin(α/2)',
        context: 'cos α = -7/25, π < α < 2π',
        explanation:
          'α/2 лежит во второй четверти. sin²(α/2) = (1 - cos α)/2 = 16/25, берём положительный корень',
        options: [
          {
            id: 'a',
            latex: '-\\frac45',
          },
          {
            id: 'b',
            latex: '\\frac35',
          },
          {
            id: 'c',
            latex: '\\frac45',
          },
          {
            id: 'd',
            latex: '-\\frac35',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'trig-challenge-tan-add',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди tan(α + π/4)',
        context: 'tan α = 1/2',
        explanation: 'По формуле суммы (1/2 + 1)/(1 - 1/2) = 3',
        options: [
          {
            id: 'a',
            latex: '1',
          },
          {
            id: 'b',
            latex: '\\frac13',
          },
          {
            id: 'c',
            latex: '3',
          },
          {
            id: 'd',
            latex: '-3',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'trig-challenge-sin75',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди значение',
        context: 'sin 75°',
        explanation: '75° = 45° + 30°. Формула синуса суммы даёт (√6 + √2)/4',
        options: [
          {
            id: 'a',
            latex: '\\frac{\\sqrt6+\\sqrt2}{4}',
          },
          {
            id: 'b',
            latex: '\\frac{\\sqrt6-\\sqrt2}{4}',
          },
          {
            id: 'c',
            latex: '\\frac{\\sqrt3+1}{2}',
          },
          {
            id: 'd',
            latex: '\\frac{\\sqrt6}{4}',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-challenge-cancel-domain',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Выбери условие равенства',
        context: 'sin 2α / sin α = 2cos α',
        explanation:
          'Сокращаем только ненулевой множитель sin α. Исходная дробь при sin α = 0 не определена',
        options: [
          {
            id: 'a',
            latex: '\\cos\\alpha\\ne0',
          },
          {
            id: 'b',
            latex: '\\sin\\alpha\\ne0',
          },
          {
            id: 'c',
            latex: '\\alpha>0',
          },
          {
            id: 'd',
            latex: '\\sin2\\alpha=0',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'trig-challenge-equation-factor',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Выбери равносильное уравнение',
        context: '2sin x cos x = sin x',
        explanation: 'Вынеси sin x, не деля на него: иначе потеряются корни sin x = 0',
        options: [
          {
            id: 'a',
            latex: '\\sin x(2\\cos x-1)=0',
          },
          {
            id: 'b',
            latex: '2\\cos x=1',
          },
          {
            id: 'c',
            latex: '\\sin x(2\\cos x+1)=0',
          },
          {
            id: 'd',
            latex: '\\cos x=0',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'trig-challenge-sum-products',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation: 'Формулы суммы и разности используют полусумму 2α и полуразность α',
        pairs: [
          {
            id: 'a',
            left: '\\sin3\\alpha+\\sin\\alpha',
            right: '2\\sin2\\alpha\\cos\\alpha',
          },
          {
            id: 'b',
            left: '\\cos3\\alpha+\\cos\\alpha',
            right: '2\\cos2\\alpha\\cos\\alpha',
          },
          {
            id: 'c',
            left: '\\cos3\\alpha-\\cos\\alpha',
            right: '-2\\sin2\\alpha\\sin\\alpha',
          },
        ],
      },
      {
        id: 'trig-challenge-tan-identities',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: 'Все знаменатели отличны от нуля',
        explanation: 'Раздели основное тождество и формулы двойного угла на cos² α',
        pairs: [
          {
            id: 'a',
            left: '1+\\tan^2\\alpha',
            right: '\\frac1{\\cos^2\\alpha}',
          },
          {
            id: 'b',
            left: '\\frac{2\\tan\\alpha}{1+\\tan^2\\alpha}',
            right: '\\sin2\\alpha',
          },
          {
            id: 'c',
            left: '\\frac{1-\\tan^2\\alpha}{1+\\tan^2\\alpha}',
            right: '\\cos2\\alpha',
          },
        ],
      },
      {
        id: 'trig-challenge-shift-square',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини равные выражения',
        context: '',
        explanation: 'Определи смену функции при нечётном числе четвертей и знак по формуле суммы',
        pairs: [
          {
            id: 'a',
            left: '\\sin^2(\\frac\\pi2+\\alpha)',
            right: '\\cos^2\\alpha',
          },
          {
            id: 'b',
            left: '\\cos(\\frac{3\\pi}2+\\alpha)',
            right: '\\sin\\alpha',
          },
          {
            id: 'c',
            left: '\\sin(\\frac{3\\pi}2+\\alpha)',
            right: '-\\cos\\alpha',
          },
        ],
      },
      {
        id: 'trig-challenge-cos-shift',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: 'cos²(α + π/4)',
        explanation: 'cos² t = (1 + cos 2t)/2, а cos(2α + π/2) = -sin 2α',
        options: [
          {
            id: 'a',
            latex: '\\frac12\\sin2\\alpha',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '\\frac12',
          },
          {
            id: 'd',
            latex: '-',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
      {
        id: 'trig-challenge-sin-product',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери равное выражение',
        context: '2sin α sin β',
        explanation:
          'Разность формул косинуса разности и суммы равна удвоенному произведению синусов',
        options: [
          {
            id: 'a',
            latex: '\\cos(\\alpha+\\beta)',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '\\cos(\\alpha-\\beta)',
          },
          {
            id: 'd',
            latex: '-',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
      {
        id: 'trig-challenge-fourth-difference',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Представь в виде произведения',
        context: 'sin⁴ α - cos⁴ α',
        explanation: 'Второй множитель sin² α + cos² α равен 1',
        options: [
          {
            id: 'a',
            latex: '1',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '\\sin^2\\alpha-\\cos^2\\alpha',
          },
          {
            id: 'd',
            latex: '\\cdot',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
    ],
  },
  {
    id: 'probability',
    title: 'Теория вероятностей',
    description: 'Выбирай модель и разбирай вероятности по шагам',
    eyebrow: 'Шаг к заданиям 4 и 5',
    formula: 'P',
    questions: [
      {
        id: 'prob-basic-at-least',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс попасть хотя бы раз?',
        context: 'Два независимых выстрела, вероятность попадания в каждом 0,7',
        explanation:
          'Не попасть ни разу: 0,3 · 0,3 = 0,09. Противоположное событие имеет вероятность 1 - 0,09 = 0,91',
        options: [
          {
            id: 'a',
            latex: '0{,}49',
          },
          {
            id: 'b',
            latex: '0{,}91',
          },
          {
            id: 'c',
            latex: '0{,}42',
          },
          {
            id: 'd',
            latex: '0{,}7',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-basic-without-replacement',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс достать красный шар?',
        context: 'Из 5 красных и 3 синих шаров вынули синий и не вернули. Теперь достают ещё один',
        explanation:
          'Теперь в коробке 7 шаров, из них 5 красных. Вероятность равна 5/7, а не исходным 5/8',
        options: [
          {
            id: 'a',
            latex: '\\frac58',
          },
          {
            id: 'b',
            latex: '\\frac47',
          },
          {
            id: 'c',
            latex: '\\frac57',
          },
          {
            id: 'd',
            latex: '\\frac27',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'prob-basic-shooters',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context:
          'Два стрелка делают по одному независимому выстрелу. Шансы попадания: у первого 0,8, у второго 0,6',
        explanation:
          'Оба: 0,8 · 0,6 = 0,48. Только первый: 0,8 · 0,4 = 0,32. Ни один: 0,2 · 0,4 = 0,08',
        pairs: [
          {
            id: 'a',
            left: '\\text{оба}',
            right: '0{,}48',
          },
          {
            id: 'b',
            left: '\\text{только первый}',
            right: '0{,}32',
          },
          {
            id: 'c',
            left: '\\text{ни один}',
            right: '0{,}08',
          },
        ],
      },
      {
        id: 'prob-basic-dice',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'Дважды независимо бросают честный кубик',
        explanation:
          'Всего 36 равновероятных пар. Сумму 7 дают 6 пар, два чётных числа - 9 пар, сумму 2 - только пара (1, 1)',
        pairs: [
          {
            id: 'a',
            left: '\\text{сумма 7}',
            right: '\\frac16',
          },
          {
            id: 'b',
            left: '\\text{два чётных}',
            right: '\\frac14',
          },
          {
            id: 'c',
            left: '\\text{сумма 2}',
            right: '\\frac1{36}',
          },
        ],
      },
      {
        id: 'prob-basic-build-at-least',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери вероятность события',
        context:
          'Хотя бы одна попытка успешна. Три независимые попытки, вероятность успеха в каждой 0,2',
        explanation: 'Вероятность трёх неудач: 0,8³ = 0,512. Хотя бы один успех: 1 - 0,512 = 0,488',
        options: [
          {
            id: 'a',
            latex: '0{,}8^3',
          },
          {
            id: 'b',
            latex: '1',
          },
          {
            id: 'c',
            latex: '-',
          },
          {
            id: 'd',
            latex: '0{,}2^3',
          },
        ],
        answerIds: ['b', 'c', 'a'],
      },
      {
        id: 'prob-basic-build-draw',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери вероятность двух красных',
        context: 'В коробке 3 красных и 2 синих шара. Достают два без возвращения',
        explanation:
          'Первый красный выпадает с вероятностью 3/5. После него остаются 2 красных из 4 шаров. Перемножаем: 3/5 · 2/4 = 3/10',
        options: [
          {
            id: 'a',
            latex: '\\cdot',
          },
          {
            id: 'b',
            latex: '\\frac35',
          },
          {
            id: 'c',
            latex: '\\frac24',
          },
          {
            id: 'd',
            latex: '+',
          },
        ],
        answerIds: ['b', 'a', 'c'],
        equivalentAnswerIds: [['c', 'a', 'b']],
      },
      {
        id: 'prob-challenge-exactly-one',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Каков шанс, что работает ровно один?',
        context: 'Два прибора работают независимо с вероятностями 0,9 и 0,8',
        explanation:
          'Подходят два случая: первый работает, второй нет; и наоборот. Складываем 0,9 · 0,2 + 0,1 · 0,8 = 0,26',
        options: [
          {
            id: 'a',
            latex: '0{,}72',
          },
          {
            id: 'b',
            latex: '0{,}98',
          },
          {
            id: 'c',
            latex: '0{,}26',
          },
          {
            id: 'd',
            latex: '0{,}02',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'prob-challenge-condition',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Каков шанс шестёрки в первом броске?',
        context: 'Честный кубик бросили дважды независимо. Сумма выпавших чисел равна 9',
        explanation:
          'Условию отвечают четыре равновероятные пары: (3, 6), (4, 5), (5, 4), (6, 3). Только в одной первое число равно 6',
        options: [
          {
            id: 'a',
            latex: '\\frac16',
          },
          {
            id: 'b',
            latex: '\\frac13',
          },
          {
            id: 'c',
            latex: '\\frac12',
          },
          {
            id: 'd',
            latex: '\\frac14',
          },
        ],
        answerIds: ['d'],
      },
      {
        id: 'prob-challenge-without-replacement',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'В коробке 3 белых и 2 чёрных шара. Достают два шара без возвращения',
        explanation:
          'Два белых: 3/5 · 2/4 = 3/10. Два чёрных: 2/5 · 1/4 = 1/10. Разные цвета: 1 - 3/10 - 1/10 = 3/5',
        pairs: [
          {
            id: 'a',
            left: '\\text{два белых}',
            right: '\\frac3{10}',
          },
          {
            id: 'b',
            left: '\\text{разные цвета}',
            right: '\\frac35',
          },
          {
            id: 'c',
            left: '\\text{два чёрных}',
            right: '\\frac1{10}',
          },
        ],
      },
      {
        id: 'prob-challenge-sensors',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'Каждый из двух датчиков независимо срабатывает с вероятностью 0,9',
        explanation:
          'Оба: 0,9² = 0,81. Хотя бы один: 1 - 0,1² = 0,99. Ровно один: 2 · 0,9 · 0,1 = 0,18',
        pairs: [
          {
            id: 'a',
            left: '\\text{оба}',
            right: '0{,}81',
          },
          {
            id: 'b',
            left: '\\text{хотя бы один}',
            right: '0{,}99',
          },
          {
            id: 'c',
            left: '\\text{ровно один}',
            right: '0{,}18',
          },
        ],
      },
      {
        id: 'prob-challenge-build-first-success',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери вероятность события',
        context:
          'Первое попадание случится с третьего выстрела. Выстрелы независимы, вероятность попадания в каждом 0,6',
        explanation:
          'Нужна строго последовательность: промах, промах, попадание. Её вероятность: 0,4² · 0,6 = 0,096',
        options: [
          {
            id: 'a',
            latex: '0{,}6',
          },
          {
            id: 'b',
            latex: '0{,}4^2',
          },
          {
            id: 'c',
            latex: '+',
          },
          {
            id: 'd',
            latex: '\\cdot',
          },
        ],
        answerIds: ['b', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'b']],
      },
      {
        id: 'prob-challenge-build-complement',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери вероятность события',
        context:
          'Хотя бы один шар красный. Из 4 красных и 6 синих шаров достают два без возвращения',
        explanation:
          'Противоположный случай - оба синие: 6/10 · 5/9 = 1/3. Значит, хотя бы один красный выпадет с вероятностью 1 - 1/3 = 2/3',
        options: [
          {
            id: 'a',
            latex: '\\frac6{10}\\cdot\\frac59',
          },
          {
            id: 'b',
            latex: '1',
          },
          {
            id: 'c',
            latex: '-',
          },
          {
            id: 'd',
            latex: '\\frac6{10}\\cdot\\frac6{10}',
          },
        ],
        answerIds: ['b', 'c', 'a'],
      },
      {
        id: 'prob-basic-union',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс хотя бы одного события?',
        context: 'Вероятности событий A и B: 0,4 и 0,5. Вероятность обоих сразу 0,2',
        explanation:
          'При сложении вероятностей случай, когда произошли оба события, учтён дважды. Вычитаем 0,2: получаем 0,7',
        options: [
          {
            id: 'a',
            latex: '0{,}9',
          },
          {
            id: 'b',
            latex: '0{,}7',
          },
          {
            id: 'c',
            latex: '0{,}2',
          },
          {
            id: 'd',
            latex: '0{,}1',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-basic-opposite',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Какова вероятность работы без ошибок?',
        context: 'Вероятность хотя бы одной ошибки равна 0,18',
        explanation: 'Это противоположные события, их вероятности в сумме равны 1',
        options: [
          {
            id: 'a',
            latex: '0{,}18',
          },
          {
            id: 'b',
            latex: '0{,}82',
          },
          {
            id: 'c',
            latex: '0{,}32',
          },
          {
            id: 'd',
            latex: '0{,}9',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-basic-lottery',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс выиграть?',
        context:
          'Из 80 билетов 12 выигрышных. Два выигрышных забрали. Ты выбираешь случайный оставшийся билет',
        explanation: 'Осталось 78 билетов, из них 10 выигрышных. Вероятность равна 10/78 = 5/39',
        options: [
          {
            id: 'a',
            latex: '\\frac{12}{80}',
          },
          {
            id: 'b',
            latex: '\\frac{10}{80}',
          },
          {
            id: 'c',
            latex: '\\frac5{39}',
          },
          {
            id: 'd',
            latex: '\\frac6{39}',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'prob-basic-coins',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Какова вероятность ровно двух орлов?',
        context: 'Честную монету бросают трижды независимо',
        explanation: 'Подходят ООР, ОРО и РОО. Каждый исход имеет вероятность 1/8, всего 3/8',
        options: [
          {
            id: 'a',
            latex: '\\frac18',
          },
          {
            id: 'b',
            latex: '\\frac14',
          },
          {
            id: 'c',
            latex: '\\frac38',
          },
          {
            id: 'd',
            latex: '\\frac12',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'prob-basic-independence',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс шестёрки в следующем броске?',
        context: 'На честном кубике пять раз подряд выпало 6. Броски независимы',
        explanation: 'Независимый бросок не помнит предыдущие результаты: вероятность остаётся 1/6',
        options: [
          {
            id: 'a',
            latex: '\\frac16',
          },
          {
            id: 'b',
            latex: '\\frac1{36}',
          },
          {
            id: 'c',
            latex: '\\frac56',
          },
          {
            id: 'd',
            latex: '0',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'prob-basic-interval',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Найди P(6 ≤ X < 10)',
        context: 'P(X < 10) = 0,7, P(X < 6) = 0,25',
        explanation: 'Событие X < 6 входит в X < 10. Вычитаем: 0,7 - 0,25 = 0,45',
        options: [
          {
            id: 'a',
            latex: '0{,}95',
          },
          {
            id: 'b',
            latex: '0{,}45',
          },
          {
            id: 'c',
            latex: '0{,}175',
          },
          {
            id: 'd',
            latex: '0{,}3',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-basic-defect',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс, что оба изделия исправны?',
        context: 'Два изделия исправны независимо друг от друга с вероятностью 0,95 каждое',
        explanation: 'Для независимых событий перемножаем вероятности: 0,95² = 0,9025',
        options: [
          {
            id: 'a',
            latex: '0{,}95',
          },
          {
            id: 'b',
            latex: '0{,}9025',
          },
          {
            id: 'c',
            latex: '0{,}9975',
          },
          {
            id: 'd',
            latex: '0{,}0025',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-basic-disjoint',
        difficulty: 'basic',
        kind: 'choice',
        prompt: 'Каков шанс обоих событий сразу?',
        context: 'Кубик бросают один раз. Событие A: выпало 2, событие B: выпало 5',
        explanation:
          'За один бросок нельзя одновременно получить 2 и 5, поэтому вероятность равна 0',
        options: [
          {
            id: 'a',
            latex: '0',
          },
          {
            id: 'b',
            latex: '\\frac1{36}',
          },
          {
            id: 'c',
            latex: '\\frac13',
          },
          {
            id: 'd',
            latex: '\\frac16',
          },
        ],
        answerIds: ['a'],
      },
      {
        id: 'prob-basic-one-die',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'Один бросок честного кубика',
        explanation: 'Подходящих граней соответственно 2, 5 и 3 из шести',
        pairs: [
          {
            id: 'a',
            left: '\\text{число больше 4}',
            right: '\\frac13',
          },
          {
            id: 'b',
            left: '\\text{число не равно 6}',
            right: '\\frac56',
          },
          {
            id: 'c',
            left: '\\text{число делится на 2}',
            right: '\\frac12',
          },
        ],
      },
      {
        id: 'prob-basic-events',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'События A и B независимы. Их вероятности: 0,3 и 0,4',
        explanation:
          'Оба события: 0,3 · 0,4. Хотя бы одно: 0,3 + 0,4 - 0,12. Событие A не произошло: 1 - 0,3',
        pairs: [
          {
            id: 'a',
            left: '\\text{оба события}',
            right: '0{,}12',
          },
          {
            id: 'b',
            left: '\\text{хотя бы одно}',
            right: '0{,}58',
          },
          {
            id: 'c',
            left: '\\text{A не произошло}',
            right: '0{,}7',
          },
        ],
      },
      {
        id: 'prob-basic-three-coins',
        difficulty: 'basic',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'Три независимых броска честной монеты',
        explanation: 'Из восьми равновероятных исходов подходят соответственно 1, 3 и 7',
        pairs: [
          {
            id: 'a',
            left: '\\text{три орла}',
            right: '\\frac18',
          },
          {
            id: 'b',
            left: '\\text{ровно один орёл}',
            right: '\\frac38',
          },
          {
            id: 'c',
            left: '\\text{хотя бы один орёл}',
            right: '\\frac78',
          },
        ],
      },
      {
        id: 'prob-basic-incompatible',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери вероятность любого приза',
        context: 'Вероятность первого приза 0,05, второго 0,1. Получить оба нельзя',
        explanation: 'Для несовместимых событий вероятность объединения равна сумме вероятностей',
        options: [
          {
            id: 'a',
            latex: '0{,}1',
          },
          {
            id: 'b',
            latex: '-',
          },
          {
            id: 'c',
            latex: '0{,}05',
          },
          {
            id: 'd',
            latex: '+',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'prob-basic-only-first',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери вероятность события',
        context:
          'Попал только первый стрелок. Два стрелка стреляют по разу независимо. Вероятности попадания: 0,7 у первого и 0,8 у второго',
        explanation: 'Нужны попадание первого и промах второго: 0,7 · (1 - 0,8) = 0,14',
        options: [
          {
            id: 'a',
            latex: '0{,}2',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '0{,}7',
          },
          {
            id: 'd',
            latex: '\\cdot',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'prob-basic-conditional-basic',
        difficulty: 'basic',
        kind: 'build',
        prompt: 'Собери условную вероятность',
        context:
          'Вероятность обоих событий A и B равна 0,12, события B - 0,4. Событие B произошло. Каков шанс события A?',
        explanation: 'Вероятность обоих событий делим на вероятность события B: 0,12 / 0,4 = 0,3',
        options: [
          {
            id: 'a',
            latex: '0{,}4',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '0{,}12',
          },
          {
            id: 'd',
            latex: '\\div',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
      {
        id: 'prob-challenge-total',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди вероятность брака',
        context:
          'Первый завод даёт 60% деталей, второй 40%. Доли брака: 0,02 и 0,05 соответственно',
        explanation: 'Складываем доли брака от каждого завода: 0,6 · 0,02 + 0,4 · 0,05 = 0,032',
        options: [
          {
            id: 'a',
            latex: '0{,}07',
          },
          {
            id: 'b',
            latex: '0{,}032',
          },
          {
            id: 'c',
            latex: '0{,}035',
          },
          {
            id: 'd',
            latex: '0{,}012',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-challenge-reverse-condition',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Каков шанс, что выбрали первую коробку?',
        context:
          'В каждой коробке 4 шара: в первой 3 красных, во второй 1. Случайно выбрали коробку и достали красный шар',
        explanation:
          'Вклад первой коробки 1/2 · 3/4 = 3/8, общий шанс красного 1/2. Условная вероятность: (3/8)/(1/2) = 3/4',
        options: [
          {
            id: 'a',
            latex: '\\frac12',
          },
          {
            id: 'b',
            latex: '\\frac14',
          },
          {
            id: 'c',
            latex: '\\frac34',
          },
          {
            id: 'd',
            latex: '\\frac38',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'prob-challenge-binomial',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Какова вероятность ровно двух успехов?',
        context: 'Три независимые попытки, вероятность успеха в каждой 0,4',
        explanation:
          'Выбрать место единственной неудачи можно тремя способами: 3 · 0,4² · 0,6 = 0,288',
        options: [
          {
            id: 'a',
            latex: '0{,}16',
          },
          {
            id: 'b',
            latex: '0{,}288',
          },
          {
            id: 'c',
            latex: '0{,}352',
          },
          {
            id: 'd',
            latex: '0{,}064',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-challenge-at-most',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Какова вероятность не больше одной ошибки?',
        context: 'Два независимых действия, вероятность ошибки в каждом 0,2',
        explanation: 'Исключаем только две ошибки: 1 - 0,2² = 0,96',
        options: [
          {
            id: 'a',
            latex: '0{,}64',
          },
          {
            id: 'b',
            latex: '0{,}96',
          },
          {
            id: 'c',
            latex: '0{,}32',
          },
          {
            id: 'd',
            latex: '0{,}8',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-challenge-recover',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Найди p',
        context:
          'Два прибора исправны независимо с вероятностью p каждый. Вероятность, что оба неисправны, равна 0,09',
        explanation: '(1 - p)² = 0,09. Вероятность неотрицательна, поэтому 1 - p = 0,3 и p = 0,7',
        options: [
          {
            id: 'a',
            latex: '0{,}3',
          },
          {
            id: 'b',
            latex: '0{,}7',
          },
          {
            id: 'c',
            latex: '0{,}91',
          },
          {
            id: 'd',
            latex: '0{,}81',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-challenge-dependent',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Каков шанс обоих событий сразу?',
        context: 'События A и B независимы. Их вероятности: 0,5 и 0,4',
        explanation: 'Для независимых событий перемножаем вероятности: 0,5 · 0,4 = 0,2',
        options: [
          {
            id: 'a',
            latex: '0{,}9',
          },
          {
            id: 'b',
            latex: '0{,}1',
          },
          {
            id: 'c',
            latex: '0{,}2',
          },
          {
            id: 'd',
            latex: '0{,}45',
          },
        ],
        answerIds: ['c'],
      },
      {
        id: 'prob-challenge-conditional-dice',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Каков шанс двух шестёрок?',
        context: 'Два честных кубика бросили независимо. Хотя бы на одном выпало 6',
        explanation:
          'Условию подходят 6 + 6 - 1 = 11 равновероятных пар. Только одна из них (6, 6)',
        options: [
          {
            id: 'a',
            latex: '\\frac16',
          },
          {
            id: 'b',
            latex: '\\frac1{11}',
          },
          {
            id: 'c',
            latex: '\\frac1{36}',
          },
          {
            id: 'd',
            latex: '\\frac12',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-challenge-draw-order',
        difficulty: 'challenge',
        kind: 'choice',
        prompt: 'Каков шанс шаров разных цветов?',
        context: 'Из 4 белых и 2 чёрных шаров достают два без возвращения',
        explanation: 'Два порядка: 4/6 · 2/5 + 2/6 · 4/5 = 8/15',
        options: [
          {
            id: 'a',
            latex: '\\frac4{15}',
          },
          {
            id: 'b',
            latex: '\\frac8{15}',
          },
          {
            id: 'c',
            latex: '\\frac49',
          },
          {
            id: 'd',
            latex: '\\frac25',
          },
        ],
        answerIds: ['b'],
      },
      {
        id: 'prob-challenge-three-trials',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'Три независимые попытки, вероятность успеха в каждой 0,8',
        explanation: 'Три успеха: 0,8³. Два: 3 · 0,8² · 0,2. Ни одного: 0,2³',
        pairs: [
          {
            id: 'a',
            left: '\\text{все успешны}',
            right: '0{,}512',
          },
          {
            id: 'b',
            left: '\\text{ровно две успешны}',
            right: '0{,}384',
          },
          {
            id: 'c',
            left: '\\text{ни одной успешной}',
            right: '0{,}008',
          },
        ],
      },
      {
        id: 'prob-challenge-joint-table',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context: 'Вероятности событий A и B: 0,6 и 0,5. Вероятность обоих сразу 0,3',
        explanation:
          'Событие A при условии B: 0,3 / 0,5. Хотя бы одно: 0,6 + 0,5 - 0,3. Ни одного: 1 - 0,8',
        pairs: [
          {
            id: 'a',
            left: '\\text{A при условии B}',
            right: '0{,}6',
          },
          {
            id: 'b',
            left: '\\text{хотя бы одно}',
            right: '0{,}8',
          },
          {
            id: 'c',
            left: '\\text{ни одного}',
            right: '0{,}2',
          },
        ],
      },
      {
        id: 'prob-challenge-first-success',
        difficulty: 'challenge',
        kind: 'pairs',
        prompt: 'Соедини событие и вероятность',
        context:
          'Попытки независимы, вероятность успеха 0,5. Слева указана попытка, на которой успех случился впервые',
        explanation: 'Перед первым успехом должны идти только неудачи: 0,5; 0,5²; 0,5³',
        pairs: [
          {
            id: 'a',
            left: '\\text{первая попытка}',
            right: '\\frac12',
          },
          {
            id: 'b',
            left: '\\text{вторая попытка}',
            right: '\\frac14',
          },
          {
            id: 'c',
            left: '\\text{третья попытка}',
            right: '\\frac18',
          },
        ],
      },
      {
        id: 'prob-challenge-total-formula',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери вероятность брака',
        context:
          'Первый завод даёт 70% изделий, второй 30%. Доли брака: 0,01 и 0,04 соответственно',
        explanation:
          'Ветви выбора завода несовместимы. Их вклады складываются: 0,007 + 0,012 = 0,019',
        options: [
          {
            id: 'a',
            latex: '0{,}3\\cdot0{,}04',
          },
          {
            id: 'b',
            latex: '-',
          },
          {
            id: 'c',
            latex: '0{,}7\\cdot0{,}01',
          },
          {
            id: 'd',
            latex: '+',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'prob-challenge-exactly-one-build',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери вероятность события',
        context:
          'Ровно один выстрел попал в цель. Два независимых выстрела, вероятность попадания в каждом 0,6',
        explanation:
          'Два порядка: попадание-промах и промах-попадание. Каждый имеет вероятность 0,24',
        options: [
          {
            id: 'a',
            latex: '0{,}6\\cdot0{,}4',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '2',
          },
          {
            id: 'd',
            latex: '\\cdot',
          },
        ],
        answerIds: ['c', 'd', 'a'],
        equivalentAnswerIds: [['a', 'd', 'c']],
      },
      {
        id: 'prob-challenge-two-red-condition',
        difficulty: 'challenge',
        kind: 'build',
        prompt: 'Собери вероятность события',
        context:
          'Оба шара красные. Вероятность двух красных 0,2, хотя бы одного красного - 0,8. Известно, что хотя бы один красный',
        explanation:
          'Событие «оба красные» входит в «хотя бы один красный». Условная вероятность 0,2/0,8 = 0,25',
        options: [
          {
            id: 'a',
            latex: '0{,}8',
          },
          {
            id: 'b',
            latex: '+',
          },
          {
            id: 'c',
            latex: '0{,}2',
          },
          {
            id: 'd',
            latex: '\\div',
          },
        ],
        answerIds: ['c', 'd', 'a'],
      },
    ],
  },
];
