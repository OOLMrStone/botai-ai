const prefix = 'бот';
const suffix = 'ai';
const name = `${prefix}${suffix}`;

export const BRAND = {
  name,
  mascotName: 'Бо',
  prefix,
  suffix,
  metadata: {
    applicationName: name,
    appleWebApp: { capable: true, title: name, statusBarStyle: 'default' },
    title: `${name} - подготовка к ЕГЭ по профмату`,
    description: 'Готовимся к ЕГЭ по профильной математике по чуть-чуть каждый день',
  },
} as const;
