'use strict';

const $ = id => document.getElementById(id);
const ICONS = {
  gateway: ['M5 5h5v5H5zM14 14h5v5h-5z', 'M10 7h5a2 2 0 0 1 2 2v5M7 10v5a2 2 0 0 0 2 2h5'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  route: ['M5 6h8a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8', 'M5 3v6M2 6h6M16 18l4 3-4 3'],
  apps: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM17.5 14v7M14 17.5h7'],
  flask: ['M9 3h6M10 3v6L4 19a1.4 1.4 0 0 0 1.2 2h13.6a1.4 1.4 0 0 0 1.2-2L14 9V3M7 14h10'],
  shield: ['M12 3c3 3 6 3 8 4v6c0 5-8 9-8 9s-8-4-8-9V7c2-1 5-1 8-4z', 'm8.5 12 2.5 2.5 4.5-5'],
  help: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 17h.01'],
  'arrow-up-right': ['M6 18 18 6M6 6h12v12'], 'arrow-right': ['M4 12h16M14 6l6 6-6 6'],
  chevron: ['m9 6 6 6-6 6'], menu: ['M4 6h16M4 12h16M4 18h16'], close: ['m6 6 12 12M6 18 18 6'],
  lock: ['M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4'], logout: ['M9 4H4v16h5M9 12h12m-5-5 5 5-5 5'],
  plus: ['M12 5v14M5 12h14'], bolt: ['m13 2-9 12h7l-1 8L21 9h-8z'], corner: ['M5 4v9a4 4 0 0 0 4 4h10m-5-5 5 5-5 5'],
  message: ['M21 11a9 8 0 0 1-9 8H9l-5 3 1-6a7 7 0 0 1-2-5 9 8 0 0 1 18 0', 'M8 11h.01M12 11h.01M16 11h.01'],
  search: ['M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0M15 15l6 6'],
  info: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 11v6M12 7h.01'],
  edit: ['m15 4 5 5M4 15l-1 6 6-1L21 8a2 2 0 0 0 0-3l-2-2a2 2 0 0 0-3 0z'],
  copy: ['M9 9h12v12H9zM5 15H3V3h12v2'], trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  up: ['m6 12 6-6 6 6M12 6v14'], down: ['m6 12 6 6 6-6M12 4v14'],
  refresh: ['M20 7v5h-5M4 17v-5h5M6 5a8 8 0 0 1 14 7M18 19A8 8 0 0 1 4 12'],
  check: ['m5 12 4 4L19 6'], 'check-circle': ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'm8 12 3 3 5-6'],
  play: ['m8 4 12 8-12 8z'], sparkles: ['m12 3 2 6 6 3-6 2-2 7-2-7-7-2 7-3zM20 2v4M18 4h4'],
  pause: ['M8 5v14M16 5v14'], link: ['m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0']
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.65', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  for (const d of ICONS[name] || ICONS.apps) {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function badge(text, className = '') { return element('span', `chip ${className}`, text); }
function button(text, action, className = 'button secondary', iconName) {
  const node = element('button', className); node.type = 'button';
  if (iconName) node.append(icon(iconName));
  node.append(document.createTextNode(text)); node.addEventListener('click', action); return node;
}
function iconButton(label, iconName, action) {
  const node = button('', action, 'icon-button', iconName);
  node.title = label; node.setAttribute('aria-label', label); return node;
}
for (const node of document.querySelectorAll('[data-icon]')) node.append(icon(node.dataset.icon));

let routing, savedRouting, csrfToken, expiresAt, sessionTimer;
let recentItems = [], recentRevision, recentBusy = false, recentReload = false;
let dirty = false, busy = false, currentView = 'overview', editing, confirmResolve;
const viewCopy = {
  overview: ['ภาพรวม', 'ภาพรวมการเชื่อมต่อ', 'ดูแลทุกเส้นทางจาก LINE ไปยังแอปของคุณได้ในที่เดียว', 'สร้างกฎส่งต่อ'],
  rules: ['กฎส่งต่อ', 'รับอะไร ส่งไปไหน', 'มีเส้นทางพื้นฐานให้แล้ว เพิ่มกฎเฉพาะเมื่ออยากแยกไปแอปอื่น', 'เพิ่มกฎส่งต่อ'],
  apps: ['แอปปลายทาง', 'แอปที่เชื่อมต่อ', 'จัดการปลายทางที่รับ Webhook และเพิ่มแอปใหม่ได้ที่นี่', 'เพิ่มแอปปลายทาง'],
  recent: ['เหตุการณ์ล่าสุด', 'ดูเหตุการณ์ แล้วเลือกเส้นทาง', 'เลือก event ที่รับเข้าคิวแล้ว เพื่อสร้างกฎส่งต่อหรือ Reject โดยไม่ต้องเดาพารามิเตอร์', ''],
  queue: ['คิวงาน', 'เห็นคิว ตรวจงานคงค้าง', 'ติดตามลำดับงานที่รอส่ง งานที่กำลังดำเนินการ และงานที่ต้องตรวจใน DLQ', ''],
  test: ['ทดลองเส้นทาง', 'ลองก่อน แล้วค่อยส่งจริง', 'ตรวจเงื่อนไขและแอปปลายทางก่อนบันทึกการเปลี่ยนแปลง', '']
};
function status(message, error = false, action) {
  $('status').hidden = !message;
  $('status').classList.toggle('error', error);
  $('status').replaceChildren(icon(error ? 'info' : 'check-circle'), element('span', '', message));
  if (action) $('status').append(button(action.label, action.run, 'text-button'));
  if (message) $('status').append(iconButton('ปิดการแจ้งเตือน', 'close', () => { $('status').hidden = true; }));
}
function clearSimulation() { $('test-result').hidden = true; $('test-placeholder').hidden = false; }
function updateSaveState() {
  $('save-bar').classList.toggle('is-dirty', dirty);
  $('draft-banner').hidden = !dirty;
  $('save-state').textContent = busy ? 'กำลังดำเนินการ…' : dirty ? 'มีการเปลี่ยนแปลงที่ยังไม่บันทึก' : 'บันทึกครบแล้ว';
  $('save-description').textContent = dirty ? 'บันทึกเพื่อให้มีผลกับงานถัดไป' : 'การตั้งค่าล่าสุดพร้อมใช้งาน';
  $('save-indicator').replaceChildren(icon(dirty ? 'edit' : 'check-circle'));
  $('save').disabled = busy || !dirty || !csrfToken;
  $('reload').disabled = busy;
  $('primary-action').disabled = busy;
  $('logout').disabled = busy;
  for (const node of document.querySelectorAll('#rules button, #rules input, #apps button, #recent-list button, #fallback, [data-rule-template]')) node.disabled = busy || node.dataset.boundary === 'true';
}
function changed() {
  dirty = JSON.stringify(routing) !== JSON.stringify(savedRouting);
  clearSimulation(); updateSaveState(); renderRecent();
}
function setBusy(value) { busy = value; updateSaveState(); }
function setNavigation(ready) {
  for (const node of $('navigation').querySelectorAll('button')) {
    node.disabled = !ready;
    node.title = ready ? '' : 'เข้าสู่ระบบเพื่อจัดการการเชื่อมต่อ';
  }
  if (!ready) {
    $('nav-app-count').textContent = '—'; $('nav-rule-count').textContent = '—';
    $('breadcrumb-title').textContent = 'ภาพรวม';
  }
}
function switchView(name) {
  if (!viewCopy[name] || !routing) return;
  currentView = name;
  for (const node of document.querySelectorAll('.view')) node.hidden = node.id !== `view-${name}`;
  for (const node of document.querySelectorAll('#navigation [data-view]')) {
    const active = node.dataset.view === name; node.classList.toggle('active', active);
    if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  }
  const [crumb, title, description, action] = viewCopy[name];
  $('breadcrumb-title').textContent = crumb; $('page-title').textContent = title;
  $('page-description').textContent = description; $('primary-action-label').textContent = action;
  $('primary-action').hidden = !action;
  if (name === 'recent') void loadRecent();
  queueView.setActive(name === 'queue');
  closeMenu(); $('main').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' });
}
function closeMenu() {
  document.body.classList.remove('menu-open'); $('menu-overlay').hidden = true; $('menu-toggle').setAttribute('aria-expanded', 'false');
  document.querySelector('.workspace-main').inert = false;
  $('sidebar').inert = window.matchMedia('(max-width: 760px)').matches;
}
for (const node of document.querySelectorAll('[data-view]')) node.addEventListener('click', () => switchView(node.dataset.view));
$('menu-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open'); $('menu-overlay').hidden = !open; $('menu-toggle').setAttribute('aria-expanded', String(open));
  $('sidebar').inert = !open;
  document.querySelector('.workspace-main').inert = open;
  if (open) $('navigation').querySelector('button').focus();
});
$('menu-overlay').addEventListener('click', () => { closeMenu(); $('menu-toggle').focus(); });
window.matchMedia('(min-width: 761px)').addEventListener('change', closeMenu);
closeMenu();
setNavigation(false);
$('primary-action').addEventListener('click', () => currentView === 'apps' ? openApp() : openRule());
$('show-active-rules').addEventListener('click', () => { $('rule-filter').value = 'enabled'; renderRules(); switchView('rules'); });
$('show-fallback').addEventListener('click', () => { switchView('rules'); $('fallback').focus(); });
$('open-help').addEventListener('click', () => { closeMenu(); $('help-dialog').showModal(); });
for (const node of document.querySelectorAll('[data-close-help]')) node.addEventListener('click', () => $('help-dialog').close());
function appName(id) { if (id === null) return 'Reject (ไม่ส่งต่อ)'; return routing.apps.find(app => app.id === id)?.name || 'ไม่พบแอป'; }
function ruleTarget(rule) { return rule.action === 'reject' ? 'Reject (ไม่ส่งต่อ)' : appName(rule.appId); }
function appOptions(select, selected) {
  select.replaceChildren(...routing.apps.filter(app => app.id !== 'sso').map(app => {
    const option = element('option', '', app.name); option.value = app.id; option.selected = app.id === selected; return option;
  }));
  const reject = element('option', '', 'Reject · ไม่ส่งต่อเหตุการณ์ที่เหลือ'); reject.value = '!reject'; reject.selected = selected === null; select.append(reject);
}
function emptyState(title, description, action) {
  const node = element('div', 'empty-state'); node.append(icon('search'), element('h3', '', title), element('p', '', description));
  if (action) node.append(button(action.label, action.run)); return node;
}
function renderOverview() {
  const active = routing.rules.filter(rule => rule.enabled).length;
  $('protected-target').textContent = appName('sso');
  $('route-count').textContent = `2 เส้นทางพื้นฐาน + ${routing.rules.length} กฎเพิ่มเติม`;
  $('stat-apps').textContent = routing.apps.length; $('stat-rules').textContent = routing.rules.length + 2;
  $('stat-active').textContent = active + 2; $('stat-paused').textContent = `ปิดใช้งาน ${routing.rules.length - active} กฎ`;
  $('stat-fallback').textContent = appName(routing.fallbackAppId); $('stat-fallback').title = appName(routing.fallbackAppId);
  $('nav-rule-count').textContent = routing.rules.length + 2; $('nav-app-count').textContent = routing.apps.length;
  $('flow-destinations').replaceChildren(...routing.apps.slice(0, 2).map((app, index) => {
    const node = element('div', 'destination'), mark = element('span', `stat-icon ${index ? 'lavender' : 'peach'}`), copy = element('div');
    mark.append(icon(index ? 'message' : 'shield'));
    copy.append(element('strong', '', app.name), element('small', '', app.id === routing.fallbackAppId ? 'ปลายทางสำรอง' : 'แอปปลายทาง'));
    node.append(mark, copy); return node;
  }));
  if (routing.apps.length > 2) $('flow-destinations').append(element('span', 'flow-more', `และอีก ${routing.apps.length - 2} แอป`));
  $('overview-rules').replaceChildren(...routing.rules.slice(0, 4).map((rule, index) => {
    const node = button('', () => openRule(rule), 'mini-rule'), copy = element('div', 'mini-rule-copy');
    copy.append(element('strong', '', rule.name), element('small', '', `${window.RuleBuilder.conditionLabel(rule)} → ${ruleTarget(rule)}`));
    node.append(element('span', 'rule-number', String(index + 1).padStart(2, '0')), copy, badge(rule.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่', rule.enabled ? 'active-chip' : 'paused-chip'), icon('chevron'));
    return node;
  }));
  const systemRow = (title, destination, description, action) => {
    const row = button('', action, 'mini-rule system-rule'), copy = element('div', 'mini-rule-copy');
    copy.append(element('strong', '', `${title} → ${destination}`), element('small', '', description));
    row.append(icon('shield'), copy, badge('พื้นฐาน', 'active-chip'), icon('chevron')); return row;
  };
  $('overview-rules').prepend(systemRow('ยืนยันตัวตน MFA', appName('sso'), 'แยกให้อัตโนมัติ · ตรวจเป็นอันดับแรก', () => { switchView('rules'); $('protected-route').scrollIntoView({ block: 'center' }); }));
  if (routing.rules.length > 4) $('overview-rules').append(button(`ดูกฎเพิ่มเติมอีก ${routing.rules.length - 4} กฎ`, () => switchView('rules'), 'text-button overview-more'));
  $('overview-rules').append(systemRow('ข้อความและเหตุการณ์ที่เหลือ', appName(routing.fallbackAppId), 'ใช้เมื่อไม่ตรงกับกฎเพิ่มเติม · เปลี่ยนปลายทางได้', () => { switchView('rules'); $('fallback').focus(); }));

}
function renderRules(focusKey) {
  $('custom-rules-panel').classList.toggle('is-empty', !routing.rules.length);
  const query = $('rule-search').value.trim().toLocaleLowerCase(), filter = $('rule-filter').value;
  const matches = routing.rules.filter(rule => `${rule.name} ${rule.eventType} ${rule.postback?.key || ''} ${rule.postback?.value || ''} ${ruleTarget(rule)}`.toLocaleLowerCase().includes(query)
    && (filter === 'all' || (filter === 'enabled') === rule.enabled));
  $('rules-result-count').textContent = `${matches.length} / ${routing.rules.length} กฎเพิ่มเติม`;
  const conflicts = window.RuleBuilder.warnings(routing.rules);
  $('rule-warnings').hidden = !conflicts.length;
  $('rule-warnings').replaceChildren(icon('info'), element('div', '', `มีกฎ ${conflicts.length} รายการที่ถูกกฎด้านบนรับข้อมูลไปก่อน ดูคำแนะนำใต้กฎ แล้วเลื่อนกฎเฉพาะขึ้นหรือปิดกฎที่ซ้ำ`));
  $('rules').replaceChildren(...matches.map(rule => {
    const index = routing.rules.indexOf(rule), row = element('article', `rule-row${rule.enabled ? '' : ' is-paused'}`);
    const main = element('div', 'rule-main'), title = element('div', 'rule-title'), meta = element('div', 'rule-meta');
    title.append(element('h3', '', rule.name), badge(rule.enabled ? 'เปิดใช้งาน' : 'ปิดอยู่', rule.enabled ? 'active-chip' : 'paused-chip'));
    meta.append(badge(window.RuleBuilder.eventLabel(rule.eventType), 'event-chip'));
    if (rule.postback) meta.append(element('code', 'condition-code', `${rule.postback.key}=${rule.postback.value}`));
    meta.append(icon('arrow-right'), element('span', 'rule-target', ruleTarget(rule))); main.append(title, meta);
    const conflict = conflicts.find(item => item.id === rule.id);
    if (conflict) main.append(element('p', 'rule-warning', `ยังรับข้อมูลไม่ได้: ${conflict.kind === 'duplicate' ? 'เงื่อนไขซ้ำกับ' : 'ถูกกฎรับทั้งหมดบังโดย'} “${routing.rules.find(item => item.id === conflict.previousId).name}” ด้านบน`));
    const actions = element('div', 'rule-actions'), toggle = element('label', 'switch'), enabled = element('input');
    enabled.type = 'checkbox'; enabled.checked = rule.enabled; enabled.setAttribute('aria-label', `เปิดใช้งาน ${rule.name}`); enabled.dataset.focus = `toggle-${rule.id}`;
    enabled.addEventListener('change', () => { rule.enabled = enabled.checked; changed(); render(`toggle-${rule.id}`); });
    toggle.append(enabled);
    const move = step => {
      if (busy) return;
      [routing.rules[index], routing.rules[index + step]] = [routing.rules[index + step], routing.rules[index]];
      changed(); render(`${step < 0 ? 'up' : 'down'}-${rule.id}`);
    };
    const up = iconButton(`เลื่อน ${rule.name} ขึ้น`, 'up', () => move(-1)), down = iconButton(`เลื่อน ${rule.name} ลง`, 'down', () => move(1));
    up.dataset.boundary = String(index === 0); down.dataset.boundary = String(index === routing.rules.length - 1);
    up.dataset.focus = `up-${rule.id}`; down.dataset.focus = `down-${rule.id}`;
    actions.append(toggle, element('span', 'divider'), up, down, iconButton(`ทดลองกฎ ${rule.name}`, 'play', () => simulateRule(rule)), iconButton(`แก้ไขกฎ ${rule.name}`, 'edit', () => openRule(rule)), iconButton(`ทำสำเนากฎ ${rule.name}`, 'copy', () => openRule(rule, true)), iconButton(`ลบกฎ ${rule.name}`, 'trash', async () => {
      if (await confirmAction('ลบกฎส่งต่อนี้?', `“${rule.name}” จะถูกลบจากฉบับแก้ไข และมีผลเมื่อบันทึก`, 'ลบกฎ')) {
        routing.rules = routing.rules.filter(item => item.id !== rule.id); changed(); render();
      }
    }));
    row.append(element('span', 'rule-number', String(index + 1).padStart(2, '0')), main, actions); return row;
  }));
  if (!matches.length) $('rules').append(emptyState(routing.rules.length ? 'ไม่พบกฎที่ค้นหา' : 'เส้นทางพื้นฐานครอบคลุมอยู่แล้ว', routing.rules.length ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ' : 'เพิ่มกฎเมื่ออยากแยกข้อความ ปุ่ม หรือเหตุการณ์ไปยังแอปอื่น เลือกแม่แบบด้านบนเพื่อเริ่มได้เลย', routing.rules.length ? { label: 'ล้างตัวกรอง', run: () => { $('rule-search').value = ''; $('rule-filter').value = 'all'; renderRules(); updateSaveState(); } } : { label: 'เพิ่มกฎส่งต่อ', run: () => openRule() }));
  if (focusKey) {
    const focus = [...$('rules').querySelectorAll('[data-focus]')].find(node => node.dataset.focus === focusKey);
    if (focus && focus.dataset.boundary !== 'true') focus.focus({ preventScroll: true });
  }
}
function renderApps() {
  const query = $('app-search').value.trim().toLocaleLowerCase();
  const matches = routing.apps.filter(app => `${app.name} ${app.url}`.toLocaleLowerCase().includes(query));
  $('apps-result-count').textContent = `${matches.length} / ${routing.apps.length} แอป`;
  $('apps').replaceChildren(...matches.map((app, index) => {
    const card = element('article', 'panel app-card'), head = element('div', 'app-card-head'), mark = element('span', `stat-icon ${['peach', 'lavender', 'sage', 'sand'][index % 4]}`);
    mark.append(icon('apps')); head.append(mark);
    if (app.id === routing.fallbackAppId) head.append(badge('แอปสำรอง', 'default-chip'));
    const meta = element('div', 'app-meta'), count = routing.rules.filter(rule => rule.appId === app.id).length;
    meta.append(badge(app.id === 'sso' ? 'รับ MFA อัตโนมัติ' : `${count} กฎเพิ่มเติม${app.id === routing.fallbackAppId ? ' + ปลายทางเริ่มต้น' : ''}`), badge('HTTPS', 'active-chip'), badge(app.id === 'sso' ? 'LINE เดิม + Gateway token' : 'JSON ราย event + Gateway token'));
    const actions = element('div', 'app-card-actions');
    actions.append(button('แก้ไขแอป', () => openApp(app), 'button secondary', 'edit'), iconButton(`คัดลอก URL ${app.name}`, 'copy', async () => {
      try { await navigator.clipboard.writeText(app.url); status('คัดลอก URL แล้ว'); }
      catch { status('คัดลอกอัตโนมัติไม่ได้ สามารถเลือก URL แล้วคัดลอกได้โดยตรง', true); }
    }), iconButton(`ลบแอป ${app.name}`, 'trash', async () => {
      if (app.id === 'sso') return status('CUSA SSO เป็นปลายทาง MFA ที่ระบบป้องกันไว้ จึงลบไม่ได้', true);
      if (count || app.id === routing.fallbackAppId) { status('เปลี่ยนแอปสำรองและกฎที่อ้างถึงแอปนี้ก่อนลบ', true, { label: 'ไปยังกฎส่งต่อ', run: () => switchView('rules') }); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
      if (await confirmAction('ลบแอปปลายทางนี้?', `ลบ “${app.name}” ออกจากฉบับแก้ไข การลบจะมีผลเมื่อบันทึก`, 'ลบแอป')) {
        routing.apps = routing.apps.filter(item => item.id !== app.id); changed(); render();
      }
    }));
    card.append(head, element('h3', '', app.name), element('p', 'app-url', app.url), meta, actions); return card;
  }));
  if (!matches.length) $('apps').append(emptyState('ไม่พบแอปที่ค้นหา', 'ลองค้นหาด้วยชื่อแอปหรือส่วนหนึ่งของ URL', { label: 'ล้างคำค้นหา', run: () => { $('app-search').value = ''; renderApps(); updateSaveState(); } }));
  if (!query && routing.apps.length < 30) {
    const add = button('', () => openApp(), 'app-add-card', 'plus'); add.id = 'add-app';
    add.append(element('strong', '', 'เพิ่มแอปปลายทาง'), element('small', '', 'ต่อยอดการเชื่อมต่อของคุณ')); $('apps').append(add);
  }
}
function render(focusKey) { renderRecent(); renderOverview(); renderRules(focusKey); renderApps(); appOptions($('fallback'), routing.fallbackAppId); updateSaveState(); }
$('rule-search').addEventListener('input', () => { renderRules(); updateSaveState(); });
$('rule-filter').addEventListener('change', () => { renderRules(); updateSaveState(); });
$('app-search').addEventListener('input', () => { renderApps(); updateSaveState(); });
$('fallback').addEventListener('change', event => { routing.fallbackAppId = event.target.value === '!reject' ? null : event.target.value; changed(); render(); });

function field(title, id, value, options = {}) {
  const label = element('label', '', title), input = element('input'); input.id = id; input.name = id; input.value = value;
  input.type = options.type || 'text'; input.required = options.required !== false; input.maxLength = options.maxLength || 100;
  if (options.list) input.setAttribute('list', options.list);
  if (options.placeholder) input.placeholder = options.placeholder;
  input.addEventListener('input', () => { input.setCustomValidity(''); $('edit-error').hidden = true; });
  label.append(input); return label;
}
function configureDialog(title, description, iconName, draft, kind, originalId) {
  if (!routing || busy) return false;
  editing?.controller?.destroy();
  editing = { kind, draft, originalId };
  $('edit-dialog').classList.toggle('rule-builder-dialog', kind === 'rule'); $('edit-title').textContent = title; $('edit-description').textContent = description;
  $('edit-icon').replaceChildren(icon(iconName)); $('edit-fields').replaceChildren(); $('edit-error').hidden = true;
  $('edit-submit').textContent = originalId ? 'ใช้การแก้ไขนี้' : 'เพิ่มลงฉบับแก้ไข'; return true;
}
function openApp(app) {
  if (!app && routing.apps.length >= 30) return status('เพิ่มได้สูงสุด 30 แอป', true);
  const draft = app ? structuredClone(app) : { id: crypto.randomUUID(), name: '', url: '' };
  if (!configureDialog(app ? 'แก้ไขแอปปลายทาง' : 'เพิ่มแอปปลายทาง', 'ระบุแอปที่ต้องการรับข้อมูลจาก Gateway', 'apps', draft, 'app', app?.id)) return;
  $('edit-fields').append(field('ชื่อแอป', 'app-name', draft.name, { placeholder: 'เช่น ระบบลงทะเบียน' }), field('URL รับ Webhook', 'app-url', draft.url, { type: 'url', maxLength: 2048, placeholder: 'https://app.example.com/webhook' }), element('p', 'field-hint', 'ใช้ HTTPS และปลายทางที่คุณเชื่อถือ แอปนี้จะได้รับข้อมูล event พร้อมรหัสยืนยันตัวตนของ Gateway'));
  if (app?.id === 'sso') {
    $('app-url').readOnly = true;
    $('edit-fields').append(element('p', 'field-hint', 'SSO รับข้อมูล LINE เดิมทั้งชุดพร้อมลายเซ็น URL ผูกกับ SSO_WEBHOOK_URL บนเซิร์ฟเวอร์ เพื่อป้องกันการส่ง MFA ไปผิดปลายทาง'));
  }
  $('edit-dialog').showModal(); $('app-name').focus();
}
function openRule(rule, duplicate = false, template = 'postback', example) {
  if ((!rule || duplicate) && routing.rules.length >= 100) return status('เพิ่มได้สูงสุด 100 กฎ', true);
  const draft = rule ? structuredClone(rule) : { id: crypto.randomUUID(), name: '', enabled: true, eventType: template, ...(routing.fallbackAppId === null ? { action: 'reject' } : { appId: routing.fallbackAppId }) };
  if (example?.postback) draft.postback = { ...example.postback };
  if (duplicate) { draft.id = crypto.randomUUID(); draft.name = `${draft.name.slice(0, 90)} (สำเนา)`; }
  if (!configureDialog(duplicate ? 'ทำสำเนากฎส่งต่อ' : rule ? 'แก้ไขกฎส่งต่อ' : 'สร้างกฎส่งต่อ', 'เลือกเหตุการณ์ → เลือกแอป → ตรวจสรุป แล้วเพิ่มลงฉบับแก้ไข', 'route', draft, 'rule', duplicate ? undefined : rule?.id)) return;
  editing.controller = window.RuleEditor.mount({ container: $('edit-fields'), draft, routing, originalId: editing.originalId, autoName: !rule, ui: { element, field, button } });
  $('edit-dialog').showModal(); $('rule-type').focus();
}
for (const node of document.querySelectorAll('[data-rule-template]')) node.addEventListener('click', () => openRule(undefined, false, node.dataset.ruleTemplate));
function closeEdit() { editing?.controller?.destroy(); $('edit-dialog').close(); editing = undefined; }
for (const node of document.querySelectorAll('[data-close-dialog]')) node.addEventListener('click', closeEdit);
$('edit-dialog').addEventListener('close', () => { editing?.controller?.destroy(); editing = undefined; $('edit-fields').replaceChildren(); });
function fieldInvalid(id, message) { $(id).setCustomValidity(message); $(id).reportValidity(); }
$('edit-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!editing || busy) return;
  const { draft, kind, originalId } = editing;
  if (kind === 'app') {
    draft.name = $('app-name').value.trim(); draft.url = $('app-url').value.trim();
    if (!draft.name) return fieldInvalid('app-name', 'กรุณาระบุชื่อแอป');
    try {
      const url = new URL(draft.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
      draft.url = url.href;
    } catch { return fieldInvalid('app-url', 'ใช้ URL แบบ HTTPS ที่ไม่มีชื่อผู้ใช้ รหัสผ่าน หรือ #'); }
    if (originalId) routing.apps[routing.apps.findIndex(app => app.id === originalId)] = draft; else routing.apps.push(draft);
  } else {
    const value = editing.controller.read();
    if (!value.name) return fieldInvalid('rule-name', 'กรุณาระบุชื่อกฎ');
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(value.eventType)) return fieldInvalid('rule-custom-type', 'ใช้ชื่อ event เช่น message หรือ postback');
    if (value.postback) {
      const { key, value: match } = value.postback;
      if (!key || key.trim() !== key || /[\u0000-\u001f\u007f]/.test(key)) return fieldInvalid('rule-key', 'ระบุชื่อพารามิเตอร์ ไม่มีช่องว่างหัวท้ายหรืออักขระควบคุม');
      if (key === 'cusa_mfa') return fieldInvalid('rule-key', 'cusa_mfa มีเส้นทางไป SSO ให้อยู่แล้ว ไม่ต้องสร้างกฎเพิ่ม');
      if (!match || match.trim() !== match || /[\u0000-\u001f\u007f]/.test(match)) return fieldInvalid('rule-value', 'ระบุค่าที่ต้องตรง ไม่มีช่องว่างหัวท้ายหรืออักขระควบคุม');
    }
    const newApp = editing.controller.newApp();
    if (newApp) {
      if (!newApp.name) return fieldInvalid('rule-new-name', 'กรุณาระบุชื่อแอปใหม่');
      try {
        const url = new URL(newApp.url);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error();
        newApp.url = url.href;
      } catch { return fieldInvalid('rule-new-url', 'ใช้ URL แบบ HTTPS ที่ไม่มีชื่อผู้ใช้ รหัสผ่าน หรือ #'); }
      routing.apps.push(newApp);
    }
    routing.rules = window.RuleBuilder.placeRule(routing.rules, value, originalId, editing.controller.beforeId());
  }
  closeEdit(); changed(); render();
});
function confirmAction(title, description, accept) {
  $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-accept').textContent = accept;
  $('confirm-dialog').showModal(); return new Promise(resolve => { confirmResolve = resolve; });
}
function finishConfirm(value) { const resolve = confirmResolve; confirmResolve = undefined; $('confirm-dialog').close(); resolve?.(value); }
$('confirm-cancel').addEventListener('click', () => finishConfirm(false));
$('confirm-accept').addEventListener('click', () => finishConfirm(true));
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); finishConfirm(false); });

const reasons = { disabled: 'ข้าม: กฎนี้ปิดอยู่', event_type: 'ประเภท event ไม่ตรง', condition: 'เงื่อนไข postback ไม่ตรง หรือมีพารามิเตอร์ชื่อเดียวกันซ้ำ', matched: 'ตรงเงื่อนไข เลือกกฎนี้', mfa: 'ผ่านรูปแบบ MFA ส่ง LINE envelope เดิมไป SSO', invalid_mfa: 'MFA ไม่ถูกต้อง หมดอายุ หรือมีพารามิเตอร์ซ้ำ: ไม่ส่งต่อไปแอปอื่น' };
$('test-type').addEventListener('input', () => { $('test-data-label').hidden = $('test-type').value !== 'postback'; clearSimulation(); });
for (const id of ['test-data', 'test-source', 'test-user', 'test-age']) $(id).addEventListener('input', clearSimulation);
for (const node of document.querySelectorAll('[data-sample]')) node.addEventListener('click', () => {
  $('test-type').value = node.dataset.sample === 'mfa' ? 'postback' : node.dataset.sample;
  $('test-data').value = node.dataset.sample === 'mfa' ? `cusa_mfa=11111111-1111-4111-8111-111111111111&choice=${'x'.repeat(43)}` : '';
  $('test-source').value = 'user'; $('test-user').value = `U${'0'.repeat(32)}`; $('test-age').value = '0';
  $('test-data-label').hidden = $('test-type').value !== 'postback'; clearSimulation();
});
function runSimulation() {
  if (!routing) return;
  const result = window.RoutingPreview.previewRoute({ type: $('test-type').value, postback: { data: $('test-data').value }, source: { type: $('test-source').value, userId: $('test-user').value }, timestamp: Date.now() - Number($('test-age').value) * 1000 }, routing);
  $('test-placeholder').hidden = true; $('test-result').hidden = false;
  const heading = element('div', 'result-heading'); heading.append(icon('check-circle'), document.createTextNode(result.drop ? (result.rejected ? 'Reject ตามกฎ' : 'ปฏิเสธ MFA') : result.protected ? 'เส้นทาง MFA ที่ป้องกันไว้' : result.rule ? 'พบกฎที่ตรงเงื่อนไข' : 'ใช้แอปสำรอง'));
  $('test-result').replaceChildren(heading, element('h2', 'result-app', result.drop ? 'ไม่ส่งต่อไปแอปใด' : result.app?.name), element('p', 'result-url', result.app?.url || ''), element('p', 'result-reason', result.rejected ? (result.rule ? `กฎ “${result.rule.name}” กำหนดให้รับแล้วไม่ส่งต่อ` : 'ปลายทางเริ่มต้นกำหนดให้ Reject เหตุการณ์ที่ไม่ตรงกฎ') : result.protected ? 'ตรวจ MFA ก่อนกฎทั่วไปเสมอ โดยใช้ข้อมูลผู้ใช้และอายุ event ที่จำลองด้านซ้าย' : result.rule ? `เลือกกฎ “${result.rule.name}” ซึ่งเป็นกฎแรกที่ตรง` : 'ไม่มีเงื่อนไขใดตรง จึงส่งต่อไปยังแอปสำรอง'), element('h3', 'trace-heading', 'ลำดับการตรวจสอบ'));
  for (const step of result.steps) {
    const row = element('div', `trace-step${step.reason === 'matched' ? ' matched' : ''}`), copy = element('div', '', step.name);
    copy.append(element('small', '', reasons[step.reason])); row.append(icon(step.reason === 'matched' ? 'check-circle' : step.reason === 'disabled' ? 'pause' : 'corner'), copy); $('test-result').append(row);
  }
  if (!result.steps.length) $('test-result').append(element('p', 'muted small', 'ยังไม่มีกฎส่งต่อ ใช้แอปสำรองสำหรับทุก event'));
}

$('simulation-form').addEventListener('submit', event => { event.preventDefault(); runSimulation(); });
function simulateRule(rule) {
  $('test-type').value = rule.eventType;
  $('test-data').value = rule.postback ? new URLSearchParams([[rule.postback.key, rule.postback.value]]).toString() : '';
  $('test-data-label').hidden = rule.eventType !== 'postback';
  $('test-source').value = 'user'; $('test-user').value = `U${'0'.repeat(32)}`; $('test-age').value = '0';
  switchView('test'); runSimulation();
}

function recentRouteText(item) {
  const result = item.route;
  if (result.kind === 'protected') return 'MFA → CUSA SSO (ตรวจความปลอดภัยแยก)';
  if (result.kind === 'unknown') return 'ข้อมูลไม่พอประเมินเส้นทาง';
  const name = result.kind === 'reject' ? 'Reject · ไม่ส่งต่อ' : result.appName || 'ไม่พบแอป';
  return `${name} · ${result.fallback ? 'ปลายทางเริ่มต้น' : result.ruleName || 'กฎที่ตรง'}`;
}
function renderRecent() {
  if (!routing) return;
  const newerRouting = recentRevision && recentRevision !== routing.revision;
  $('recent-draft-note').hidden = !dirty && !newerRouting;
  $('recent-draft-note').textContent = newerRouting ? 'กฎบนเซิร์ฟเวอร์เปลี่ยนแล้ว โหลดการตั้งค่าใหม่ก่อนแก้กฎ ผลนี้อ้างอิงกฎตอนโหลดเหตุการณ์'
    : 'ผลที่เห็นอ้างอิงกฎที่บันทึกแล้ว ยังไม่รวมฉบับแก้ไขในหน้านี้';
  const query = $('recent-search').value.trim().toLocaleLowerCase(), filter = $('recent-filter').value;
  const items = recentItems.filter(item => {
    const text = [item.type, item.messageType, recentRouteText(item), ...item.parameters.map(param => `${param.key} ${param.value || ''}`)].join(' ').toLocaleLowerCase();
    return text.includes(query) && (filter === 'all' || (filter === 'fallback' ? item.route.fallback
      : filter === 'rule' ? Boolean(item.route.ruleId) : item.route.kind === filter));
  });
  $('recent-count').textContent = `${items.length} / ${recentItems.length} รายการ`;
  $('recent-list').replaceChildren(...items.map(item => {
    const card = element('article', 'panel recent-card'), header = element('div', 'recent-heading'), copy = element('div');
    const time = new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(item.receivedAt));
    copy.append(element('h3', '', window.RuleBuilder.eventLabel(item.type)), element('p', 'muted small', `รับเข้าคิว ${time}${item.redelivery ? ' · LINE ส่งซ้ำ' : ''}`));
    header.append(copy, badge(item.protected ? 'เส้นทางที่ป้องกันไว้' : item.type, item.protected ? 'active-chip' : 'event-chip')); card.append(header);
    if (item.messageType) card.append(element('p', 'muted small', `ชนิดข้อความ: ${item.messageType} · ไม่เก็บเนื้อหา`));
    const parameters = element('div', 'recent-parameters');
    for (const param of item.parameters) parameters.append(element('code', 'condition-code', `${param.key}=${param.ambiguous ? '[ชื่อซ้ำ]' : param.value ?? '[ปิดบังค่า]'}`));
    if (item.protected) parameters.append(element('p', 'muted small', 'ไม่แสดง challenge, choice หรือข้อมูลผู้ใช้ และไม่สร้างกฎทับเส้นทาง MFA'));
    else if (item.type === 'postback' && !item.parameters.length) parameters.append(element('p', 'muted small', 'ไม่มีพารามิเตอร์ที่เปิดเผยได้'));
    if (item.truncated) parameters.append(element('p', 'muted small', 'แสดงพารามิเตอร์บางส่วนเพื่อจำกัดข้อมูล'));
    card.append(parameters, element('p', `recent-route${item.route.kind === 'reject' ? ' rejected' : ''}`, recentRouteText(item)));
    if (!item.protected && item.type !== 'unknown') {
      const actions = element('div', 'recent-actions'), available = item.parameters.filter(param => param.value !== undefined && !param.ambiguous);
      const existing = routing.rules.find(rule => rule.id === item.route.ruleId);
      if (existing) actions.append(button('แก้กฎที่ตรง', () => openRule(existing), 'button secondary', 'edit'));
      actions.append(button('สร้างกฎจากเหตุการณ์นี้', () => {
        const pair = available.find(param => param.key === 'action') || available[0];
        const postback = pair ? { key: pair.key, value: pair.value } : undefined;
        openRule(undefined, false, item.type, { postback });
        if (item.type === 'postback' && !postback) {
          $('edit-error').textContent = 'ค่าถูกปิดบังหรือกำกวม จึงไม่เติมเงื่อนไขให้อัตโนมัติ กรุณาระบุคู่ชื่อ–ค่าจากแอป หรือเลือกทุกปุ่มโดยตั้งใจ'; $('edit-error').hidden = false;
        }
      }, 'button primary', 'plus'));
      card.append(actions);
    }
    return card;
  }));
  if (!items.length) $('recent-list').append(emptyState(recentItems.length ? 'ไม่พบเหตุการณ์ที่ค้นหา' : 'ยังไม่มีตัวอย่างเหตุการณ์',
    recentItems.length ? 'ลองเปลี่ยนคำค้นหาหรือตัวกรอง' : 'หลังอัปเดตโฮสต์ ให้ส่งข้อความหรือกดปุ่ม LINE แล้วกดโหลดเหตุการณ์ล่าสุด คำขอ Verify ที่ไม่มี event จะไม่แสดง'));
}
async function loadRecent() {
  if (!routing || !csrfToken) return;
  if (recentBusy) { recentReload = true; return; }
  recentBusy = true; $('recent-refresh').disabled = true; $('recent-refresh').textContent = 'กำลังโหลด…'; $('recent-error').hidden = true;
  const session = csrfToken;
  try {
    const result = await api('/v1/admin/recent-events');
    if (!routing || csrfToken !== session) return;
    recentItems = result.items; recentRevision = result.routingRevision; renderRecent();
  } catch (error) {
    if (routing && csrfToken === session) { $('recent-error').textContent = error.message; $('recent-error').hidden = false; }
  } finally {
    recentBusy = false; $('recent-refresh').disabled = false; $('recent-refresh').replaceChildren(icon('refresh'), document.createTextNode('โหลดเหตุการณ์ล่าสุด'));
    if (recentReload) { recentReload = false; if (currentView === 'recent') void loadRecent(); }
  }
}
$('recent-refresh').addEventListener('click', loadRecent);
$('recent-search').addEventListener('input', renderRecent);
$('recent-filter').addEventListener('change', renderRecent);
const queueView = window.QueueMonitor.mount({ api, session: () => csrfToken, ui: { element, badge, icon } });

const errors = {
  routing_conflict: 'มีผู้ดูแลคนอื่นเปลี่ยนข้อมูลแล้ว กรุณาโหลดข้อมูลล่าสุดก่อนบันทึก',
  invalid_routing: 'ตรวจชื่อแอป, URL HTTPS, ประเภท event และเงื่อนไขให้ครบถ้วน',
  routing_admin_required: 'บัญชีนี้ไม่มีสิทธิ์ admin ของแอป API Gateway',
  sso_not_configured: 'ยังไม่ได้ตั้งค่าการเชื่อมต่อ CUSA SSO สำหรับระบบนี้',
  sso_unavailable: 'ติดต่อระบบยืนยันตัวตนไม่ได้ กรุณาลองใหม่ภายหลัง',
  routing_unavailable: 'อ่านหรือบันทึกข้อมูลไม่ได้ กรุณาลองใหม่ภายหลัง',
  recent_events_unavailable: 'โหลดเหตุการณ์ล่าสุดไม่ได้ ตรวจว่าอัปเดตไฟล์เซิร์ฟเวอร์ครบและเชื่อมต่อ Redis ได้',
  queue_monitor_unavailable: 'อ่านสถานะคิวไม่ได้ กรุณาตรวจการเชื่อมต่อ Redis แล้วลองใหม่',
  invalid_queue_page: 'หน้าคิวไม่ถูกต้อง กรุณาเปิดเมนูคิวงานใหม่',
  csrf_required: 'เซสชันไม่ถูกต้อง กรุณาเข้าสู่ระบบอีกครั้ง',
  unauthorized: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'
};
function expireSession() {
  queueView.reset();
  csrfToken = undefined; clearInterval(sessionTimer); $('logout').hidden = true;
  $('session-label').replaceChildren(icon('lock'), document.createTextNode(routing ? 'เซสชันหมดอายุ' : 'สำหรับผู้ดูแล'));
  $('session-label').classList.toggle('expiring', Boolean(routing));
  if (routing) {
    if ($('edit-dialog').open) {
      $('edit-error').textContent = 'เซสชันหมดอายุ สามารถเก็บการแก้ไขนี้ไว้ในหน้า แล้วเข้าสู่ระบบใหม่ก่อนบันทึก';
      $('edit-error').hidden = false;
    }
    updateSaveState(); status('เซสชันหมดอายุ ฉบับแก้ไขยังอยู่ในหน้านี้ กรุณาเข้าสู่ระบบใหม่ก่อนบันทึก', true, { label: 'เข้าสู่ระบบใหม่', run: reauthenticate });
  } else $('login').hidden = false;
}
function reauthenticate() {
  // Keep unsaved data in this page. Complete login in a separate same-origin
  // browser tab, then fetch the new cookie-bound session without replacing drafts.
  window.open('/auth/sso/login', '_blank', 'noopener,noreferrer');
  status('เข้าสู่ระบบในแท็บใหม่ แล้วกลับมากด “ตรวจสอบการเข้าสู่ระบบ” ฉบับแก้ไขจะยังอยู่', false, { label: 'ตรวจสอบการเข้าสู่ระบบ', run: async () => {
    try { const session = await api('/auth/sso/session'); setSession(session); updateSaveState(); status('เข้าสู่ระบบแล้ว สามารถบันทึกฉบับแก้ไขต่อได้'); }
    catch (error) { showError(error); }
  } });
}
function setSession(session) {
  csrfToken = session.csrfToken; expiresAt = session.expiresAt; $('logout').hidden = false;
  clearInterval(sessionTimer);
  const tick = () => {
    const remaining = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
    if (!remaining) { expireSession(); return; }
    $('session-label').classList.toggle('expiring', remaining < 60);
    $('session-label').replaceChildren(icon('shield'), document.createTextNode(`Admin · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`));
  };
  sessionTimer = setInterval(tick, 1000); tick();
  if (routing && csrfToken) queueView.setActive(currentView === 'queue');
}
async function api(url, options = {}) {
  let response, body;
  try {
    response = await fetch(url, { ...options, credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12000) });
    body = await response.json();
  } catch { throw new Error('ติดต่อระบบไม่ได้ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง'); }
  if (!response.ok) {
    if (response.status === 401) expireSession();
    const error = new Error(errors[body.error] || 'ดำเนินการไม่สำเร็จ กรุณาลองใหม่'); error.status = response.status; error.code = body.error; throw error;
  }
  return body;
}
function showError(error) {
  if (error.status === 401 && routing) return;
  status(error.message, true, error.code === 'routing_conflict' ? { label: 'โหลดข้อมูลล่าสุด', run: reload } : undefined);
  window.scrollTo({ top: 0, behavior: 'instant' });
}
async function load() {
  const session = await api('/auth/sso/session');
  const current = await api('/v1/admin/webhook-routing');
  setSession(session); routing = current; savedRouting = structuredClone(current); dirty = false;
  setNavigation(true);
  render(); clearSimulation(); $('login').hidden = true; $('editor').hidden = false; switchView(currentView);
}
async function reload() {
  if (busy) return;
  if (dirty && !await confirmAction('โหลดข้อมูลล่าสุด?', 'รายการที่ยังไม่บันทึกจะถูกแทนที่ด้วยข้อมูลล่าสุดจากระบบ', 'โหลดและยกเลิกการแก้ไข')) return;
  setBusy(true);
  try { await load(); status('โหลดข้อมูลล่าสุดแล้ว'); } catch (error) { showError(error); }
  finally { setBusy(false); }
}
$('reload').addEventListener('click', reload);
async function save() {
  if (!dirty || busy || !csrfToken || editing) return;
  setBusy(true);
  try {
    routing = await api('/v1/admin/webhook-routing', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(routing) });
    savedRouting = structuredClone(routing); dirty = false; render(); if (currentView === 'recent') void loadRecent(); status('บันทึกการส่งต่อเรียบร้อยแล้ว');
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}
$('save').addEventListener('click', save);
$('logout').addEventListener('click', async () => {
  if (busy) return;
  if (dirty && !await confirmAction('ออกจากระบบ?', 'คุณมีรายการที่ยังไม่บันทึก การออกจากระบบจะยกเลิกรายการเหล่านี้', 'ยกเลิกรายการและออกจากระบบ')) return;
  setBusy(true);
  try {
    await api('/auth/sso/logout', { method: 'POST', headers: { 'x-csrf-token': csrfToken } });
    queueView.reset();
    recentItems = []; recentRevision = undefined; $('recent-list').replaceChildren();
    csrfToken = undefined; routing = undefined; savedRouting = undefined; dirty = false; clearInterval(sessionTimer);
    setNavigation(false);
    for (const id of ['apps', 'rules', 'fallback', 'overview-rules', 'flow-destinations', 'test-result']) $(id).replaceChildren();
    $('editor').hidden = true; $('logout').hidden = true; $('login').hidden = false;
    $('session-label').replaceChildren(icon('lock'), document.createTextNode('สำหรับผู้ดูแล')); $('session-label').classList.remove('expiring');
    status('ออกจากระบบแล้ว');
  } catch (error) { showError(error); }
  finally { setBusy(false); }
});
window.addEventListener('beforeunload', event => { if (dirty || editing) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('menu-open')) { closeMenu(); $('menu-toggle').focus(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && routing) { event.preventDefault(); if (!document.querySelector('dialog[open]')) save(); }
});
if (new URLSearchParams(location.search).get('login') === 'failed') {
  status('เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้งและตรวจว่าบัญชีมีสิทธิ์ admin ของแอปนี้', true);
  history.replaceState(null, '', '/admin/routes'); $('loading').hidden = true; $('login').hidden = false;
} else {
  load().catch(error => { if (error.status !== 401) status(error.message, true); $('login').hidden = false; }).finally(() => { $('loading').hidden = true; });
}
