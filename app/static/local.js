/* Local runner diagnostics. The photo-check form keeps its existing contract. */
(() => {
  'use strict';

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = new URL('local.css', document.currentScript.src).href;
  document.head.append(style);

  const MAX_EVENTS = 2000;
  let cursor = 0;
  let polling = false;
  let retryTimer;
  let configured = false;
  let connected = false;
  let lastState = 'idle';
  let displayedCount = 0;
  let droppedCount = 0;
  let historyGap = false;
  let eventCount = 0;

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  const panel = node('section', undefined, 'panel local-diagnostics');
  panel.id = 'local-diagnostics';
  panel.setAttribute('aria-labelledby', 'local-title');
  const heading = node('div', undefined, 'local-heading');
  const titleGroup = node('div');
  const title = node('h2', 'Ход проверки');
  title.id = 'local-title';
  const environment = node('p', 'Подключаемся к локальному приложению…', 'local-environment');
  titleGroup.append(title, environment);
  const download = node('a', 'Скачать журнал', 'download local-download');
  download.href = '/local/log.txt';
  download.download = 'botai-local-log.txt';
  heading.append(titleGroup, download);

  const connection = node('div', undefined, 'local-connection');
  connection.hidden = true;
  const connectionText = node('span');
  connectionText.setAttribute('role', 'status');
  const reconnect = node('button', 'Повторить сейчас');
  reconnect.type = 'button';
  reconnect.addEventListener('click', () => {
    clearTimeout(retryTimer);
    poll();
  });
  connection.append(connectionText, reconnect);

  const current = node('div', undefined, 'local-current');
  current.dataset.state = 'idle';
  const currentLabel = node('span', 'Готово к проверке', 'local-current-label');
  currentLabel.setAttribute('role', 'status');
  const currentWait = node('span', '', 'local-current-wait');
  current.append(currentLabel, currentWait);

  const timeline = node('div', undefined, 'local-timeline');
  timeline.tabIndex = 0;
  timeline.setAttribute('role', 'region');
  timeline.setAttribute('aria-label', 'Журнал шагов проверки');
  const empty = node('p', 'После отправки фотографий здесь появятся обращения к модели, чтение файлов и результаты инструментов.', 'local-empty');
  const eventsList = node('ol', undefined, 'local-events');
  timeline.append(empty, eventsList);

  const footer = node('div', undefined, 'local-log-footer');
  const logHint = node('span', 'Обновление каждую секунду', 'local-log-hint');
  const clear = node('button', 'Очистить экран', 'local-clear');
  clear.type = 'button';
  clear.disabled = true;
  clear.addEventListener('click', () => {
    eventsList.replaceChildren();
    displayedCount = 0;
    droppedCount = 0;
    clear.disabled = true;
    empty.textContent = 'Экран очищен. Новые шаги появятся здесь; журнал приложения остаётся доступен для скачивания.';
    empty.hidden = false;
    updateHint();
  });
  footer.append(logHint, clear);

  const files = node('details', undefined, 'local-files');
  const filesSummary = node('summary', 'Локальные файлы и подключение');
  const filesContent = node('div', undefined, 'content');
  filesContent.append(node('p', 'Загружаем пути к файлам…', 'muted'));
  files.append(filesSummary, filesContent);
  panel.append(heading, connection, current, timeline, footer, files);
  document.getElementById('form').after(panel);

  function setCurrent(label, state, waiting = '') {
    lastState = state;
    if (currentLabel.textContent !== label) currentLabel.textContent = label;
    currentWait.textContent = waiting;
    current.dataset.state = state;
  }

  function updateHint() {
    logHint.textContent = droppedCount || historyGap
      ? 'Показаны последние доступные шаги · журнал приложения можно скачать'
      : 'Обновление каждую секунду' + (displayedCount ? ' · шагов: ' + displayedCount : '');
  }

  function setConnection(ok) {
    connected = ok;
    connection.hidden = ok;
    if (!ok) {
      connectionText.textContent = 'Локальное приложение не отвечает. Журнал на экране сохранён; пробуем подключиться снова.';
      current.dataset.state = 'offline';
    } else {
      current.dataset.state = lastState;
    }
  }

  async function getJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Local runner returned HTTP ' + response.status);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function configurationItem(label, value) {
    const item = node('div', undefined, 'local-config-item');
    item.append(node('dt', label), node('dd', value));
    return item;
  }

  async function loadStatus() {
    const status = await getJSON('/local/status');
    environment.textContent = status.mode === 'mock'
      ? 'Демонстрационный режим · без обращения к API'
      : 'Прямое API · ' + String(status.model || 'модель не указана') + ' · ' + String(status.endpoint || '');
    filesContent.replaceChildren();
    const metadata = node('dl', undefined, 'local-config');
    metadata.append(
      configurationItem('API', String(status.endpoint || '—')),
      configurationItem('Модель', String(status.model || '—')),
      configurationItem('Рабочая папка', String(status.workspace || '—'))
    );
    filesContent.append(metadata);
    if (status.mode !== 'mock' && status.key_configured === false) {
      filesContent.append(node('p', 'В этой сборке нет ключа API. Для прямой проверки нужна сборка приложения со встроенным ключом.', 'local-key-warning'));
      environment.textContent = 'Прямое подключение · ключ API не настроен';
    }
    filesContent.append(node('p', 'Файлы задания 16. Приложение передаёт модели содержимое только разрешённых файлов.', 'muted'));
    const paths = node('dl', undefined, 'local-config local-paths');
    for (const [name, path] of Object.entries(status.prompt_files || {})) {
      paths.append(configurationItem(name, String(path)));
    }
    filesContent.append(paths);
    configured = true;
  }

  function clockTime(raw) {
    const date = new Date(raw);
    return Number.isNaN(date.valueOf()) ? String(raw || '') : date.toLocaleTimeString('ru-RU', { hour12: false });
  }

  function stageName(event) {
    const stage = event.details?.stage;
    return stage === 'preparation' || stage === 'prepare' ? 'Распознаём условие' : 'Проверяем решение';
  }

  const toolLabels = {
    read_file: 'чтение файла', write_file: 'сохранение файла',
    validate_response: 'проверка формата', review_image: 'просмотр фотографии',
    set_rejection: 'отказ от оценки'
  };

  function updateCurrent(event) {
    const kind = event.kind;
    const details = event.details || {};
    switch (kind) {
      case 'start': setCurrent('Начинаем проверку', 'active'); break;
      case 'preparation': setCurrent(String(event.message || 'Распознаём условие и правильный ответ'), 'active'); break;
      case 'model_request': setCurrent(stageName(event) + ' · запрос к модели', 'active'); break;
      case 'model_wait': {
        const seconds = Number(details.elapsed_seconds);
        setCurrent(stageName(event) + ' · ждём ответ модели', 'active', Number.isFinite(seconds) ? Math.floor(seconds) + ' с' : '');
        break;
      }
      case 'model_response': setCurrent('Получен ответ модели', 'active'); break;
      case 'tool_request': setCurrent('Выполняем инструмент' + (toolLabels[details.tool] ? ' · ' + toolLabels[details.tool] : ''), 'active'); break;
      case 'tool_result': setCurrent(details.ok === false ? 'Запрос инструмента отклонён · модель продолжит проверку' : 'Получен результат инструмента', 'active'); break;
      case 'validation': setCurrent('Проверяем формат результата', 'active'); break;
      case 'final': setCurrent('Проверка завершена', 'complete'); break;
      case 'error': setCurrent('Проверка завершилась с ошибкой', 'error'); break;
      case 'cancelled': setCurrent('Проверка остановлена', 'error'); break;
      case 'http_complete':
        if (Number(details.http_status) >= 400) setCurrent('Запрос завершился с ошибкой', 'error');
        break;
      default: break;
    }
  }

  const eventLabels = {
    start: 'Начало', preparation: 'Условие', model_request: 'Запрос к модели',
    model_response: 'Ответ модели', tool_request: 'Инструмент',
    tool_result: 'Результат инструмента', validation: 'Валидация', final: 'Готово',
    error: 'Ошибка', cancelled: 'Остановлено', restart: 'Перезапуск',
    ready: 'Приложение готово', http_complete: 'Ответ сервиса'
  };

  function appendEvent(event) {
    updateCurrent(event);
    eventCount += 1;
    // Heartbeats update the one live waiting indicator, not the timeline.
    if (event.kind === 'model_wait') return;
    const row = node('li', undefined, 'local-event');
    row.dataset.kind = String(event.kind || '');
    const time = node('time', clockTime(event.time), 'local-event-time');
    if (event.time) time.dateTime = event.time;
    const body = node('div', undefined, 'local-event-body');
    body.append(node('span', eventLabels[event.kind] || 'Событие', 'local-event-kind'));
    const path = event.details?.path;
    const context = !event.kind?.startsWith('tool_') || (path && String(event.message).includes(path)) ? ''
      : [toolLabels[event.details?.tool], path].filter(Boolean).join(' · ');
    const message = String(event.message || '') + (context ? ' · ' + context : '');
    body.append(node('p', message.length > 240 ? message.slice(0, 240) + '…' : message, 'local-event-message'));
    if (event.details != null || event.request_id || message.length > 240) {
      const details = node('details', undefined, 'local-event-details');
      details.append(node('summary', 'Подробности'));
      const content = node('div', undefined, 'local-event-content');
      if (event.request_id) content.append(node('p', 'Запрос: ' + event.request_id, 'local-event-request'));
      if (message.length > 240) content.append(node('pre', message));
      if (event.details != null) {
        if (typeof event.details.content === 'string') {
          const { content: fileContent, ...metadata } = event.details;
          content.append(node('pre', JSON.stringify(metadata, null, 2)), node('p', 'Содержимое файла', 'local-content-label'), node('pre', fileContent));
        } else {
          content.append(node('pre', typeof event.details === 'string' ? event.details : JSON.stringify(event.details, null, 2)));
        }
      }
      details.append(content);
      body.append(details);
    }
    row.append(time, body);
    eventsList.append(row);
    displayedCount += 1;
    if (displayedCount > MAX_EVENTS) {
      eventsList.firstElementChild.remove();
      displayedCount -= 1;
      droppedCount += 1;
    }
    empty.hidden = true;
    clear.disabled = false;
  }

  async function poll() {
    if (polling) return;
    polling = true;
    reconnect.disabled = true;
    try {
      if (!configured || !connected) await loadStatus();
      let data = await getJSON('/local/events?after=' + encodeURIComponent(cursor));
      if (!Array.isArray(data.events) || !Number.isSafeInteger(data.cursor)) throw new Error('Invalid local event response');
      const follow = timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop < 64;
      if (data.cursor < cursor) {
        // The local process restarted. Its sequence is independent from the old one.
        appendEvent({ kind: 'restart', message: 'Локальное приложение перезапущено. Начинается новый журнал.' });
        setCurrent('Готово к проверке', 'idle');
        cursor = 0;
        configured = false;
        data = await getJSON('/local/events?after=0');
        if (!Array.isArray(data.events) || !Number.isSafeInteger(data.cursor)) throw new Error('Invalid local event response');
      }
      for (const event of data.events) {
        if (!Number.isSafeInteger(event.seq) || event.seq <= cursor) continue;
        if (event.seq > cursor + 1) historyGap = true;
        appendEvent(event);
        cursor = event.seq;
      }
      cursor = Math.max(cursor, data.cursor);
      setConnection(true);
      updateHint();
      if (follow) timeline.scrollTop = timeline.scrollHeight;
    } catch {
      setConnection(false);
      if (!eventCount && !configured) environment.textContent = 'Нет связи с локальным приложением';
    } finally {
      polling = false;
      reconnect.disabled = false;
      retryTimer = setTimeout(poll, 1000);
    }
  }

  poll();
})();
