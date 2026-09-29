const productImage = './product-campaign.png';
const mariaImage = './assets/images/maria-sokolova.png';
const alexeyImage = './assets/images/alexey-founder.png';

const projects = [
  ['Забота в каждом движении', 'Рекламный ролик для NaturaCare', 'AI', '15 сентября 2026', 'Готов', 'done', productImage],
  ['Больше, чем красота', 'Имиджевый ролик для Lumière', 'Агентство', '14 сентября 2026', 'В работе', 'work', './assets/images/project-beauty.png'],
  ['Пространства для жизни', 'Социальная кампания для Domus', 'AI', '12 сентября 2026', 'На проверке', 'review', './assets/images/project-interior.png'],
  ['Движение вперед', 'Серия роликов для RunLab', 'Агентство', '10 сентября 2026', 'В работе', 'work', './assets/images/project-runner.png'],
  ['Чистая планета', 'Ролик для Green Tomorrow', 'AI', '7 сентября 2026', 'На доработке', 'revision', './assets/images/project-leaf.png']
];

const PROFILE_STORAGE_KEY = 'viral-studio-profile';
const profileDefaults = {
  name: 'Алексей', email: 'alexey@bestbite.co', role: 'Сооснователь', company: 'BestBite Co.',
  language: 'Русский', timezone: '(GMT+03:00) Москва, Санкт-Петербург', avatar: alexeyImage,
  notifications: { email: true, browser: true, marketing: false }
};

function profileSnapshot(profile) {
  return {
    name: profile.name, email: profile.email, role: profile.role, company: profile.company,
    language: profile.language, timezone: profile.timezone, avatar: profile.avatar,
    notifications: { ...profile.notifications }
  };
}

function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return profileSnapshot(profileDefaults);
    return { ...profileSnapshot(profileDefaults), ...saved, notifications: { ...profileDefaults.notifications, ...(saved.notifications || {}) } };
  } catch { return profileSnapshot(profileDefaults); }
}

const initialProfile = loadProfile();

const navItems = [['create', 'Создать'], ['projects', 'Проекты'], ['team', 'Команда'], ['media', 'Медиатека']];
const state = {
  route: 'create', query: '', type: 'Все типы', status: 'Все статусы', mode: 'ai',
  format: 'Вертикальное 9:16', duration: '15 секунд', voice: 'Русский, нейтральный', idea: '', menu: null,
  profile: initialProfile, savedProfile: profileSnapshot(initialProfile), profileDirty: false
};

const iconNames = {
  search: 'magnifying-glass', arrow: 'arrow-right', down: 'caret-down', back: 'arrow-left',
  play: 'play', pause: 'pause', volume: 'speaker-high', expand: 'corners-out', phone: 'device-mobile',
  clock: 'clock', voice: 'waveform', team: 'users-three', bolt: 'lightning', download: 'download-simple',
  trash: 'trash', comment: 'chat-circle-dots', heart: 'heart', share: 'paper-plane-tilt', menu: 'list', check: 'check',
  camera: 'camera', eye: 'eye', close: 'x'
};

function icon(name, cls = '') {
  return `<i class="icon ph ph-${iconNames[name] || name} ${cls}" aria-hidden="true"></i>`;
}

function header(active) {
  return `<header class="topbar">
    <a class="brand" href="#create" aria-label="Viral Studio"><b>VIRAL</b><i>/</i><span>Studio</span><em>AI. ЛЮДИ. БОЛЬШЕ<br>ВОЗМОЖНОСТЕЙ.</em></a>
    <nav class="desktop-nav" aria-label="Основная навигация">${navItems.map(([id, label]) => `<a href="#${id}" class="${id === active ? 'active' : ''}" ${id === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    <div class="account">
      <button class="icon-button" data-action="search" aria-label="Перейти к поиску проектов">${icon('search')}</button><span class="hairline"></span>
      <a href="#profile" class="avatar black">${escapeHtml(state.profile.name.trim().charAt(0) || 'А')}</a><a class="person" href="#profile"><b>${escapeHtml(state.profile.name || 'Алексей')}</b><small>${escapeHtml(state.profile.company)}</small></a>
      <button class="chevron" data-action="toggle-account" aria-label="Открыть меню профиля" aria-expanded="${state.menu === 'account'}">${icon('down')}</button>
      <button class="mobile-menu" data-action="toggle-mobile" aria-label="Открыть меню" aria-expanded="${state.menu === 'mobile'}">${icon(state.menu === 'mobile' ? 'x' : 'menu')}</button>
    </div>
    <div class="account-popover ${state.menu === 'account' ? 'open' : ''}" role="menu"><a href="#profile" role="menuitem">Настройки профиля</a><button role="menuitem" data-action="sign-out">Выйти</button></div>
    <nav class="mobile-nav ${state.menu === 'mobile' ? 'open' : ''}" aria-label="Мобильная навигация">${navItems.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}<a href="#profile">Профиль</a></nav>
  </header>`;
}

function date() { return '<time class="date" datetime="2026-09-15">15 сентября 2026</time>'; }
function cta(label, action, extra = '') { return `<button class="cta ${extra}" data-action="${action}"><span>${label}</span>${icon('arrow')}</button>`; }

function videoFrame({ vertical = false } = {}) {
  return `<div class="video-frame ${vertical ? 'vertical' : ''}" data-action="play-video" role="button" tabindex="0" aria-label="Воспроизвести ролик" aria-pressed="false">
    <img src="${productImage}" alt="Косметический флакон на бежевом полотенце"><div class="video-shade"></div>
    ${vertical ? `<p class="video-copy">Маленькие<br>ритуалы -<br>большие<br>перемены.</p><div class="socials"><b>${icon('heart')}<small>12.4K</small></b><b>${icon('comment')}<small>342</small></b><b>${icon('share')}<small>1.1K</small></b></div>` : ''}
    <div class="controls"><button type="button" aria-label="Воспроизвести">${icon('play', 'play-state')}</button><div class="track"><i></i></div><span>0:00 / 0:15</span>${vertical ? '' : `<button type="button" aria-label="Громкость">${icon('volume')}</button>`}<button type="button" aria-label="Развернуть">${icon('expand')}</button></div>
  </div>`;
}

function createPage() {
  return `${header('create')}<main class="page create-page">${date()}<section class="create-grid"><div class="create-copy">
    <h1>ИДЕИ<br>ДВИГАЮТ<br>БИЗНЕС</h1><p>Создавайте вирусный контент с AI или заказывайте его у нашей команды.</p>
    <div class="mode-toggle" role="tablist" aria-label="Режим создания"><button role="tab" aria-selected="${state.mode === 'ai'}" class="${state.mode === 'ai' ? 'selected' : ''}" data-action="mode-ai">${icon('bolt')}Создать с AI</button><button role="tab" aria-selected="${state.mode === 'team'}" class="${state.mode === 'team' ? 'selected' : ''}" data-action="mode-team">${icon('team')}Заказать у команды</button></div>
    <label class="idea-box"><span class="sr-only">Идея для ролика</span><textarea data-input="idea" maxlength="500" placeholder="Опишите идею для ролика...">${escapeHtml(state.idea)}</textarea><small><output id="counter">${state.idea.length}</output> / 500</small></label>
    <div class="create-options">${optionControl('format', icon('phone'), 'Формат', state.format)}${optionControl('duration', icon('clock'), 'Длительность', state.duration)}${optionControl('voice', icon('voice'), 'Голос', state.voice)}</div>
    <div class="create-submit">${cta(state.mode === 'ai' ? 'Создать ролик' : 'Отправить бриф', 'create-video')}<small>${state.mode === 'ai' ? 'Быстро. Качественно. Под вашим контролем.' : 'Команда ответит в течение рабочего дня.'}</small></div>
  </div><div class="create-preview">${videoFrame({ vertical: true })}</div></section></main>`;
}

function optionControl(key, leadingIcon, label, value) {
  const choices = {
    format: ['Вертикальное 9:16', 'Квадратное 1:1', 'Горизонтальное 16:9'],
    duration: ['6 секунд', '15 секунд', '30 секунд'],
    voice: ['Русский, нейтральный', 'Русский, энергичный', 'Без голоса']
  }[key];
  return `<div class="option-wrap"><button class="select-control" data-action="toggle-option" data-key="${key}" aria-expanded="${state.menu === key}">${leadingIcon}<span><small>${label}</small>${value}</span>${icon('down')}</button>${state.menu === key ? `<div class="option-menu" role="menu">${choices.map(choice => `<button role="menuitemradio" aria-checked="${choice === value}" data-action="choose-option" data-key="${key}" data-value="${choice}">${choice}${choice === value ? icon('check') : ''}</button>`).join('')}</div>` : ''}</div>`;
}

function projectRows() {
  const filtered = projects.filter(p => {
    const queryMatch = `${p[0]} ${p[1]}`.toLowerCase().includes(state.query.toLowerCase());
    const typeMatch = state.type === 'Все типы' || p[2] === state.type;
    const statusMatch = state.status === 'Все статусы' || p[4] === state.status;
    return queryMatch && typeMatch && statusMatch;
  });
  return `<div class="project-head"><span>Проект</span><span>Тип</span><span>Обновлен</span><span>Статус</span><span></span></div>${filtered.length ? filtered.map((p) => `<a class="project-row" href="#media-detail"><span><img src="${p[6]}" alt=""><span><b>${p[0]}</b><small>${p[1]}</small></span></span><span>${p[2]}</span><time>${p[3]}</time><span class="status ${p[5]}"><i></i>${p[4]}</span>${icon('arrow')}</a>`).join('') : `<div class="empty"><b>Проекты не найдены</b><span>Измените запрос или сбросьте фильтры.</span><button data-action="reset-filters">Сбросить фильтры</button></div>`}`;
}

function projectsPage() {
  return `${header('projects')}<main class="page projects-page">${date()}<section><h1>ПРОЕКТЫ</h1><p class="subtitle">Идеи, которые двигают бизнес.</p><div class="projects-actions">${cta('Новый проект', 'new-project')}<div class="filter-row"><label class="search-field">${icon('search')}<input data-input="query" value="${escapeAttribute(state.query)}" placeholder="Поиск по проектам..." aria-label="Поиск по проектам"></label><button class="filter" data-action="filter-type">${state.type} ${icon('down')}</button><button class="filter" data-action="filter-status">${state.status} ${icon('down')}</button><button class="filter" data-action="sort">По дате обновления ${icon('down')}</button></div></div><div class="project-table" aria-live="polite">${projectRows()}</div></section></main>`;
}

function teamPage() {
  const messages = [['А', 'Алексей', '10:24', 'Мария, привет! Утвердили концепцию - двигаемся к продакшну. Можешь, пожалуйста, собрать мудборд по визуальному стилю?'], ['М', 'Мария Соколова', '11:02', 'Привет, Алексей! Отлично, подготовлю варианты сегодня до конца дня. Учту нашу аудиторию и тональность бренда.'], ['А', 'Алексей', '12:17', 'Супер. Еще давай добавим идеи для рилсов и пару референсов по инфлюенсерам.'], ['М', 'Мария Соколова', '14:36', 'Принято! Сборка уже в работе, вышлю всё единым файлом. Если появятся комментарии - пиши, я на связи.']];
  return `${header('team')}<main class="page team-page">${date()}<section class="team-grid"><div class="team-intro"><small>AGENCY COLLABORATION</small><h1>РАБОТАЕМ<br>ВМЕСТЕ</h1><p class="case-title">BestBite -<br>Запуск линейки ухода</p><p>Вместе превращаем идеи в вирусный контент и реальные результаты.</p></div><article class="expert-card"><img src="${mariaImage}" alt="Мария Соколова" class="portrait woman"><span class="badge"><i></i>Назначена на проект</span><h2>Мария Соколова</h2><p>Креативный продюсер</p><hr><small>Экспертиза</small><p class="expertise">Креативные стратегии, AI-контент, продакшн, инфлюенсеры</p>${cta('Обсудить проект', 'discuss')}</article><section class="chat" aria-label="Переписка"><div id="message-list">${messages.map(([letter, name, time, text], i) => messageTemplate(letter, name, time, text, i % 2 === 1)).join('')}</div><form class="message-form" data-form="message"><input aria-label="Сообщение" placeholder="Напишите сообщение..." autocomplete="off" required><button class="round-button" aria-label="Отправить">${icon('arrow')}</button></form></section></section></main>`;
}

function messageTemplate(letter, name, time, text, person = false) {
  return `<article class="message"><span class="avatar ${person ? 'image' : 'black'}"${person ? ` style="background-image:url('${mariaImage}')"` : ''}>${person ? '' : letter}</span><div><b>${name}</b><time>${time}</time><p>${text}</p></div></article>`;
}

function mediaDetailPage() {
  return `${header('media')}<main class="page media-detail">${date()}<a class="back" href="#projects">${icon('back')}К проектам</a><section class="media-grid"><aside><h1>ВЫБРАННЫЙ<br>МАТЕРИАЛ</h1><h2>natural_care_motion_01.mp4</h2><p>Забота в каждом движении.<br>Тизер для рекламной кампании.</p><dl><div><dt>Длительность</dt><dd>00:15</dd></div><div><dt>Разрешение</dt><dd>1080 × 1920</dd></div><div><dt>Формат</dt><dd>MP4</dd></div><div><dt>Размер файла</dt><dd>24,8 МБ</dd></div><div><dt>Дата добавления</dt><dd>15 сентября 2026</dd></div></dl></aside><div class="media-player">${videoFrame()}</div><div class="thumbs">${[0, 1, 2, 3].map((_, i) => `<button class="thumb ${i === 0 ? 'active' : ''}" data-action="thumb" aria-label="Показать кадр ${i + 1}"><img src="${productImage}" style="object-position:${['58% 32%', '48% 53%', '28% 50%', '75% 70%'][i]}" alt="Кадр ролика"><small>0:${String([15, 7, 6, 8][i]).padStart(2, '0')}</small></button>`).join('')}</div><div class="media-actions">${cta('Добавить в проект', 'add-to-project')}<button data-action="download">${icon('download')}Скачать</button><button data-action="delete">${icon('trash')}Удалить</button></div></section></main>`;
}

function profileField(name, label, type = 'text', attributes = '') {
  const value = escapeAttribute(state.profile[name]);
  return `<label class="profile-field" for="profile-${name}"><span>${label}</span><input id="profile-${name}" name="${name}" type="${type}" value="${value}" data-profile-field="${name}" aria-describedby="${name}-error" ${attributes}><small class="field-error" id="${name}-error" aria-live="polite"></small></label>`;
}

function profileSelect(key, label, choices) {
  const open = state.menu === `profile-${key}`;
  return `<div class="profile-select-wrap"><button type="button" class="line-select" data-action="toggle-profile-option" data-key="${key}" aria-expanded="${open}"><span>${label}</span><b>${escapeHtml(state.profile[key])}</b>${icon('down')}</button>${open ? `<div class="option-menu profile-option-menu" role="menu">${choices.map(choice => `<button type="button" role="menuitemradio" aria-checked="${choice === state.profile[key]}" data-action="choose-profile-option" data-key="${key}" data-value="${escapeAttribute(choice)}">${escapeHtml(choice)}${choice === state.profile[key] ? icon('check') : ''}</button>`).join('')}</div>` : ''}</div>`;
}

function passwordDialog() {
  return `<dialog id="password-dialog" class="password-dialog" aria-labelledby="password-title"><form data-form="password"><div class="dialog-head"><div><small>БЕЗОПАСНОСТЬ</small><h2 id="password-title">Сменить пароль</h2></div><button type="button" class="dialog-close" data-action="close-password" aria-label="Закрыть">${icon('close')}</button></div><p>Новый пароль должен содержать не менее 8 символов.</p><label>Текущий пароль<input name="currentPassword" type="password" minlength="8" autocomplete="current-password" required></label><label>Новый пароль<input name="newPassword" type="password" minlength="8" autocomplete="new-password" required></label><label>Повторите новый пароль<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required><small class="field-error" id="password-error" aria-live="polite"></small></label><label class="show-password"><input type="checkbox" data-password-visibility>Показать пароли</label><button class="cta" type="submit"><span>Обновить пароль</span>${icon('arrow')}</button></form></dialog>`;
}

function profilePage() {
  const p = state.profile;
  const notifications = [
    ['email', 'Уведомления по email', 'Новости продукта, обновления и важные сообщения.'],
    ['browser', 'Уведомления в браузере', 'Статусы генераций, комментарии и упоминания.'],
    ['marketing', 'Маркетинговые рассылки', 'Советы, кейсы и специальные предложения.']
  ];
  const languages = ['Русский', 'English', 'Қазақша'];
  const timezones = ['(GMT+03:00) Москва, Санкт-Петербург', '(GMT+05:00) Алматы, Астана', '(GMT+01:00) Берлин, Париж'];
  return `${header('')}<main class="page profile-page">${date()}<h1>ПРОФИЛЬ</h1><section class="profile-grid"><aside class="profile-person"><div class="portrait-editor"><img src="${escapeAttribute(p.avatar)}" alt="Фото профиля ${escapeAttribute(p.name)}" class="portrait man"><button type="button" data-action="choose-avatar">${icon('camera')}<span>Изменить фото</span></button><input class="sr-only" id="avatar-input" type="file" accept="image/png,image/jpeg,image/webp" data-input="avatar"></div><h2>${escapeHtml(p.name)}</h2><p>${escapeHtml(p.company)}</p><small class="avatar-hint">JPG, PNG или WebP · до 2 МБ</small></aside><form class="profile-form" data-form="profile" novalidate>${profileField('name', 'Имя', 'text', 'required minlength="2" maxlength="60" autocomplete="name"')}${profileField('email', 'Email', 'email', 'required maxlength="120" autocomplete="email"')}${profileField('role', 'Должность', 'text', 'required minlength="2" maxlength="80" autocomplete="organization-title"')}${profileSelect('language', 'Язык интерфейса', languages)}${profileSelect('timezone', 'Часовой пояс', timezones)}<div class="profile-actions"><button class="cta" type="submit"><span>Сохранить изменения</span>${icon('arrow')}</button>${state.profileDirty ? '<button type="button" class="cancel-profile" data-action="discard-profile">Отменить</button>' : ''}<small class="profile-save-state" aria-live="polite">${state.profileDirty ? 'Есть несохранённые изменения' : 'Все данные сохранены'}</small></div></form><section class="settings"><h2>Уведомления</h2>${notifications.map(([key, title, desc]) => `<label class="setting"><span><b>${title}</b><small>${desc}</small></span><input type="checkbox" data-profile-notification="${key}" ${p.notifications[key] ? 'checked' : ''} aria-label="${title}"><i></i></label>`).join('')}<hr><h2>Безопасность</h2><button class="text-link" data-action="password">Сменить пароль ${icon('arrow')}</button><small class="security-note">Последнее изменение: 3 месяца назад</small></section></section></main>${passwordDialog()}`;
}

function pageFor(route) {
  return ({ create: createPage, projects: projectsPage, team: teamPage, media: mediaDetailPage, 'media-detail': mediaDetailPage, profile: profilePage }[route] || createPage)();
}

function render({ transition = false } = {}) {
  state.route = location.hash.slice(1) || 'create';
  const update = () => { document.querySelector('#app').innerHTML = pageFor(state.route); };
  if (transition && document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(update);
  else update();
}

function navigate(route) {
  state.menu = null;
  history.pushState(null, '', `#${route}`);
  render({ transition: true });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function updateProjectRows() {
  const table = document.querySelector('.project-table');
  if (table) table.innerHTML = projectRows();
}

function profileIsDirty() {
  return JSON.stringify(profileSnapshot(state.profile)) !== JSON.stringify(state.savedProfile);
}

function updateProfileActionState() {
  state.profileDirty = profileIsDirty();
  const actions = document.querySelector('.profile-actions');
  const save = actions?.querySelector('.cta');
  const status = actions?.querySelector('.profile-save-state');
  if (!actions || !save || !status) return;
  save.disabled = false;
  save.querySelector('span').textContent = 'Сохранить изменения';
  save.querySelector('.icon').className = 'icon ph ph-arrow-right';
  status.textContent = state.profileDirty ? 'Есть несохранённые изменения' : 'Все данные сохранены';
  let cancel = actions.querySelector('.cancel-profile');
  if (state.profileDirty && !cancel) {
    status.insertAdjacentHTML('beforebegin', '<button type="button" class="cancel-profile" data-action="discard-profile">Отменить</button>');
  } else if (!state.profileDirty && cancel) cancel.remove();
}

function validateProfileField(input) {
  input.setCustomValidity('');
  const value = input.value.trim();
  if (input.required && !value) input.setCustomValidity('Заполните это поле');
  else if (input.name === 'name' && value.length < 2) input.setCustomValidity('Укажите имя полностью');
  else if (input.name === 'role' && value.length < 2) input.setCustomValidity('Укажите должность');
  const valid = input.checkValidity();
  input.setAttribute('aria-invalid', String(!valid));
  const error = document.querySelector(`#${input.name}-error`);
  if (error) error.textContent = valid ? '' : input.name === 'email' && input.validity.typeMismatch ? 'Проверьте формат email' : input.validationMessage;
  return valid;
}

function persistProfile() {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profileSnapshot(state.profile)));
    state.savedProfile = profileSnapshot(state.profile);
    state.profileDirty = false;
    return true;
  } catch {
    flash('Не удалось сохранить данные в браузере', 'error');
    return false;
  }
}

function escapeHtml(value) {
  const node = document.createElement('div'); node.textContent = value; return node.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function flash(text, tone = 'default') {
  let notice = document.querySelector('.toast');
  if (!notice) { notice = document.createElement('div'); notice.className = 'toast'; notice.setAttribute('role', 'status'); document.body.append(notice); }
  notice.dataset.tone = tone; notice.innerHTML = `${icon(tone === 'error' ? 'warning-circle' : 'check')}<span>${text}</span>`; notice.classList.add('show');
  clearTimeout(flash.timer); flash.timer = setTimeout(() => notice.classList.remove('show'), 2600);
}

window.addEventListener('hashchange', () => render({ transition: true }));
window.addEventListener('beforeunload', event => {
  if (!state.profileDirty) return;
  event.preventDefault();
  event.returnValue = '';
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.menu) { state.menu = null; render(); }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.video-frame')) { event.preventDefault(); toggleVideo(event.target); }
});

document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (link) { event.preventDefault(); navigate(link.getAttribute('href').slice(1)); return; }
  const element = event.target.closest('[data-action]');
  if (!element) {
    if (state.menu && !event.target.closest('.option-menu, .account-popover, .profile-select-wrap')) { state.menu = null; render(); }
    return;
  }
  const action = element.dataset.action;
  if (action === 'search') { navigate('projects'); requestAnimationFrame(() => document.querySelector('[data-input="query"]')?.focus()); }
  if (action === 'toggle-mobile') { state.menu = state.menu === 'mobile' ? null : 'mobile'; render(); }
  if (action === 'toggle-account') { state.menu = state.menu === 'account' ? null : 'account'; render(); }
  if (action === 'toggle-option') { state.menu = state.menu === element.dataset.key ? null : element.dataset.key; render(); }
  if (action === 'choose-option') { state[element.dataset.key] = element.dataset.value; state.menu = null; render(); }
  if (action === 'toggle-profile-option') { state.menu = state.menu === `profile-${element.dataset.key}` ? null : `profile-${element.dataset.key}`; render(); }
  if (action === 'choose-profile-option') { state.profile[element.dataset.key] = element.dataset.value; state.menu = null; state.profileDirty = profileIsDirty(); render(); }
  if (action === 'mode-ai' || action === 'mode-team') { state.mode = action === 'mode-ai' ? 'ai' : 'team'; render({ transition: true }); }
  if (action === 'new-project') navigate('create');
  if (action === 'add-to-project') { flash('Материал добавлен в проект'); element.classList.add('is-success'); element.querySelector('span').textContent = 'Добавлено'; }
  if (action === 'create-video') { element.disabled = true; element.classList.add('is-loading'); element.querySelector('span').textContent = state.mode === 'ai' ? 'Создаём ролик' : 'Отправляем бриф'; setTimeout(() => { element.classList.remove('is-loading'); element.classList.add('is-success'); element.querySelector('span').textContent = state.mode === 'ai' ? 'Ролик в работе' : 'Бриф отправлен'; element.querySelector('.icon').className = 'icon ph ph-check'; flash(state.mode === 'ai' ? 'Ролик поставлен в очередь' : 'Бриф отправлен команде'); }, 900); }
  if (action === 'discuss') document.querySelector('.message-form input')?.focus();
  if (action === 'discard-profile') { state.profile = profileSnapshot(state.savedProfile); state.profileDirty = false; render(); flash('Изменения отменены'); }
  if (action === 'choose-avatar') document.querySelector('#avatar-input')?.click();
  if (action === 'download') flash('Файл готов к скачиванию');
  if (action === 'delete') flash('Материал перемещён в корзину');
  if (action === 'play-video') toggleVideo(element);
  if (action === 'thumb') { document.querySelectorAll('.thumb').forEach(item => item.classList.remove('active')); element.classList.add('active'); const player = document.querySelector('.media-player img'); if (player) player.style.objectPosition = element.querySelector('img').style.objectPosition; }
  if (action === 'filter-type') { state.type = state.type === 'Все типы' ? 'AI' : state.type === 'AI' ? 'Агентство' : 'Все типы'; render(); }
  if (action === 'filter-status') { state.status = state.status === 'Все статусы' ? 'В работе' : 'Все статусы'; render(); }
  if (action === 'reset-filters') { state.query = ''; state.type = 'Все типы'; state.status = 'Все статусы'; render(); }
  if (action === 'sort') { projects.reverse(); render(); }
  if (action === 'password') { const dialog = document.querySelector('#password-dialog'); if (dialog && !dialog.open) { dialog.showModal(); requestAnimationFrame(() => dialog.querySelector('input')?.focus()); } }
  if (action === 'close-password') element.closest('dialog')?.close();
  if (action === 'sign-out') flash('Выход доступен после подключения авторизации');
});

function toggleVideo(frame) {
  const playing = frame.classList.toggle('playing');
  frame.setAttribute('aria-pressed', String(playing)); frame.setAttribute('aria-label', playing ? 'Поставить ролик на паузу' : 'Воспроизвести ролик');
  const playIcon = frame.querySelector('.play-state'); if (playIcon) playIcon.className = `icon ph ph-${playing ? 'pause' : 'play'} play-state`;
}

document.addEventListener('input', event => {
  if (event.target.dataset.input === 'query') { state.query = event.target.value; updateProjectRows(); }
  if (event.target.dataset.input === 'idea') { state.idea = event.target.value; document.querySelector('#counter').textContent = state.idea.length; }
  if (event.target.dataset.profileField) {
    state.profile[event.target.dataset.profileField] = event.target.value;
    if (event.target.getAttribute('aria-invalid') === 'true') validateProfileField(event.target);
    document.querySelector('.profile-person h2').textContent = state.profile.name || 'Без имени';
    document.querySelector('.person b').textContent = state.profile.name || 'Алексей';
    updateProfileActionState();
  }
  if (event.target.name === 'newPassword' || event.target.name === 'confirmPassword') {
    event.target.setCustomValidity('');
    const error = event.target.closest('form')?.querySelector('#password-error');
    if (error) error.textContent = '';
  }
});

document.addEventListener('focusout', event => {
  if (event.target.dataset.profileField) validateProfileField(event.target);
});

document.addEventListener('change', event => {
  if (event.target.dataset.profileNotification) {
    state.profile.notifications[event.target.dataset.profileNotification] = event.target.checked;
    updateProfileActionState();
  }
  if (event.target.matches('[data-password-visibility]')) {
    event.target.closest('form').querySelectorAll('input[name$="Password"]').forEach(input => { input.type = event.target.checked ? 'text' : 'password'; });
  }
  if (event.target.dataset.input === 'avatar') {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      event.target.value = ''; flash('Выберите JPG, PNG или WebP размером до 2 МБ', 'error'); return;
    }
    const image = document.querySelector('.profile-person .portrait');
    const previewUrl = URL.createObjectURL(file);
    image.onload = () => URL.revokeObjectURL(previewUrl);
    image.src = previewUrl;
    const reader = new FileReader();
    reader.onload = () => { state.profile.avatar = reader.result; updateProfileActionState(); };
    reader.readAsDataURL(file);
  }
});

document.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.dataset.form === 'message') {
    const input = event.target.querySelector('input'); if (!input.value.trim()) return;
    document.querySelector('#message-list').insertAdjacentHTML('beforeend', messageTemplate('А', 'Алексей', new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), escapeHtml(input.value.trim())));
    input.value = ''; document.querySelector('#message-list .message:last-child')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); flash('Сообщение отправлено');
  }
  if (event.target.dataset.form === 'profile') {
    const fields = [...event.target.querySelectorAll('[data-profile-field]')];
    const valid = fields.map(validateProfileField).every(Boolean);
    if (!valid) { fields.find(field => field.getAttribute('aria-invalid') === 'true')?.focus(); flash('Проверьте заполненные поля', 'error'); return; }
    fields.forEach(field => { state.profile[field.dataset.profileField] = field.value.trim(); });
    if (persistProfile()) { render(); flash('Изменения профиля сохранены'); }
  }
  if (event.target.dataset.form === 'password') {
    const current = event.target.elements.currentPassword;
    const next = event.target.elements.newPassword;
    const confirm = event.target.elements.confirmPassword;
    next.setCustomValidity(next.value === current.value ? 'Новый пароль должен отличаться от текущего' : '');
    confirm.setCustomValidity(confirm.value === next.value ? '' : 'Пароли не совпадают');
    const error = event.target.querySelector('#password-error');
    if (!next.checkValidity() || !confirm.checkValidity()) { error.textContent = next.validationMessage || confirm.validationMessage; (next.checkValidity() ? confirm : next).reportValidity(); return; }
    error.textContent = ''; event.target.closest('dialog').close(); event.target.reset(); flash('Пароль обновлён');
  }
});

render();
