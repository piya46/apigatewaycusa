'use strict';

// Guided rule authoring; changes are committed to the page draft only on submit.
window.RuleEditor = {
  mount({ container, draft, routing, originalId, autoName, ui }) {
    const { element, field, button } = ui;
    const $ = id => document.getElementById(id);
    const builder = window.RuleBuilder;
    const newAppId = crypto.randomUUID();
    let automaticName = autoName;
    function selectField(label, id, choices, value) {
      const wrapper = element('label', '', label), select = element('select'); select.id = id;
      for (const [key, text] of choices) {
        const option = element('option', '', text); option.value = key; option.selected = key === value; select.append(option);
      }
      wrapper.append(select); return wrapper;
    }
    function section(number, title, description) {
      const block = element('section', 'builder-section'), header = element('div', 'builder-heading'), copy = element('div');
      copy.append(element('h3', '', title), element('p', 'field-hint', description));
      header.append(element('span', 'builder-number', number), copy); block.append(header); return block;
    }
    const known = builder.events.some(([id]) => id === draft.eventType);
    const trigger = section('1', 'เมื่อเกิดอะไรขึ้น?', 'เลือกเหตุการณ์จาก LINE ที่ต้องการส่งให้แอป');
    trigger.append(selectField('ประเภท event', 'rule-type', [...builder.events, ['!custom', 'ประเภทอื่น (ขั้นสูง)']], known ? draft.eventType : '!custom'));
    const custom = field('ชื่อ event แบบกำหนดเอง', 'rule-custom-type', known ? '' : draft.eventType, { required: false, maxLength: 64, placeholder: 'เช่น beacon' });
    custom.id = 'rule-custom-label'; trigger.append(custom);
    const conditions = element('div', 'condition-fields'); conditions.id = 'rule-conditions';
    conditions.append(selectField('เลือกปุ่มที่ต้องการรับ', 'rule-match', [
      ['parameter', 'เฉพาะปุ่มที่มีชื่อพารามิเตอร์และค่าตรงกัน'], ['all', 'ทุกปุ่มทั่วไป (ยกเว้นปุ่ม MFA ของ SSO)']
    ], !autoName && !draft.postback ? 'all' : 'parameter'));
    const specific = element('div', 'builder-specific'); specific.id = 'rule-specific';
    const sample = element('div', 'sample-reader');
    sample.append(field('วางตัวอย่างข้อมูลจากปุ่ม LINE', 'rule-sample', '', { required: false, maxLength: 4096, placeholder: 'action=register&source=richmenu' }),
      element('p', 'field-hint', 'คัดลอกค่า postback.data จากปุ่มหรือ Rich Menu อ่านตัวอย่างในหน้านี้เท่านั้น ไม่มีการส่งออกไป'),
      button('อ่านตัวอย่างและเติมเงื่อนไข', parseSample, 'button secondary', 'sparkles'));
    const sampleError = element('p', 'field-error'); sampleError.id = 'sample-error'; sampleError.hidden = true; sampleError.setAttribute('role', 'status');
    const choices = element('div', 'parameter-choices'); choices.id = 'sample-choices'; choices.setAttribute('aria-label', 'เลือกพารามิเตอร์จากตัวอย่าง');
    sample.append(sampleError, choices);
    const pair = element('div', 'field-row');
    pair.append(field('ชื่อพารามิเตอร์', 'rule-key', draft.postback?.key || '', { required: false, maxLength: 128, placeholder: 'action' }),
      field('ค่าที่ต้องตรง', 'rule-value', draft.postback?.value || '', { required: false, maxLength: 1024, placeholder: 'register' }));
    const manual = element('details', 'manual-condition'), manualTitle = element('summary', '', 'กรอกชื่อพารามิเตอร์และค่าเอง');
    manual.open = Boolean(draft.postback);
    manual.append(manualTitle, pair, element('p', 'field-hint', 'หนึ่งกฎตรวจหนึ่งคู่ชื่อ–ค่า เช่น action=register เลือกค่าที่บอกว่าต้องส่งไปแอปใด'));
    specific.append(sample, manual);
    conditions.append(specific); trigger.append(conditions);

    const destination = section('2', 'ส่งไปแอปไหน?', 'เลือกแอปที่รับเหตุการณ์นี้ หรือเพิ่มแอปใหม่ได้ในขั้นตอนเดียว');
    const appChoices = routing.apps.filter(app => app.id !== 'sso').map(app => [app.id, app.name]);
    if (routing.apps.length < 30) appChoices.push(['!new', '+ เพิ่มแอปปลายทางใหม่…']);
    destination.append(selectField('ส่งไปยังแอป', 'rule-app', appChoices, draft.appId));
    const newApp = element('div', 'new-app-fields'); newApp.id = 'rule-new-app';
    newApp.append(field('ชื่อแอปใหม่', 'rule-new-name', '', { required: false }),
      field('URL รับ Webhook ของแอปใหม่', 'rule-new-url', '', { required: false, type: 'url', maxLength: 2048, placeholder: 'https://your-app.example/webhook' }),
      element('p', 'field-hint', 'เพิ่มเฉพาะแอปที่คุณเชื่อถือ แอปจะได้รับ event และรหัสยืนยัน Gateway แอปใหม่กับกฎจะบันทึกพร้อมกัน'));
    destination.append(newApp);

    const review = section('3', 'ตรวจเส้นทางก่อนเพิ่ม', 'ชื่อกฎเติมให้อัตโนมัติและแก้ไขได้ การเปลี่ยนแปลงจะเริ่มใช้เมื่อบันทึกหน้าเว็บ');
    review.append(field('ชื่อกฎ', 'rule-name', draft.name, { placeholder: 'ระบบช่วยตั้งชื่อจากเหตุการณ์และปลายทาง' }));
    const others = routing.rules.filter(rule => rule.id !== originalId);
    const nextRule = originalId ? routing.rules[routing.rules.findIndex(rule => rule.id === originalId) + 1] : undefined;
    review.append(selectField('ลำดับการตรวจ', 'rule-position', [...others.map(rule => [rule.id, `ก่อน: ${rule.name}`]), ['', 'ท้ายกฎที่เพิ่มเอง · ก่อนปลายทางเริ่มต้น']], nextRule?.id || ''));
    const toggle = element('label', 'switch'), enabled = element('input'); enabled.type = 'checkbox'; enabled.id = 'rule-enabled'; enabled.checked = draft.enabled;
    toggle.append(enabled, document.createTextNode('เปิดใช้งานกฎนี้')); review.append(toggle);
    const summary = element('div', 'builder-summary'); summary.id = 'rule-summary'; summary.setAttribute('aria-live', 'polite');
    const warning = element('p', 'builder-warning'); warning.id = 'rule-warning'; warning.hidden = true; warning.setAttribute('role', 'status');
    const sampleOutput = element('div', 'builder-example'); sampleOutput.id = 'rule-example';
    review.append(summary, warning, sampleOutput); container.append(trigger, destination, review);
    $('rule-sample').autocomplete = 'off';
    for (const id of ['rule-key', 'rule-value']) $(id).addEventListener('invalid', () => { manual.open = true; });
    function eventType() { return $('rule-type').value === '!custom' ? $('rule-custom-type').value.trim() : $('rule-type').value; }
    function readDraft() {
      const value = { ...draft, name: $('rule-name').value.trim(), eventType: eventType(), enabled: $('rule-enabled').checked,
        appId: $('rule-app').value === '!new' ? newAppId : $('rule-app').value };
      delete value.postback;
      if (value.eventType === 'postback' && $('rule-match').value === 'parameter') value.postback = { key: $('rule-key').value, value: $('rule-value').value };
      return value;
    }
    function refresh() {
      const isPostback = eventType() === 'postback', isNew = $('rule-app').value === '!new';
      custom.hidden = $('rule-type').value !== '!custom'; $('rule-custom-type').disabled = custom.hidden; $('rule-custom-type').required = !custom.hidden;
      conditions.hidden = !isPostback;
      specific.hidden = !isPostback || $('rule-match').value === 'all';
      for (const id of ['rule-key', 'rule-value', 'rule-sample']) {
        $(id).disabled = specific.hidden; $(id).required = !specific.hidden && id !== 'rule-sample';
        if (specific.hidden) $(id).setCustomValidity('');
      }
      newApp.hidden = !isNew;
      for (const id of ['rule-new-name', 'rule-new-url']) { $(id).disabled = !isNew; $(id).required = isNew; if (!isNew) $(id).setCustomValidity(''); }
      const value = readDraft(), appName = isNew ? $('rule-new-name').value.trim() || 'แอปใหม่' : routing.apps.find(app => app.id === value.appId)?.name || 'เลือกแอป';
      manualTitle.textContent = value.postback?.key && value.postback.value
        ? `ใช้ ${value.postback.key}=${value.postback.value} · แตะเพื่อแก้ไข` : 'กรอกชื่อพารามิเตอร์และค่าเอง';
      if (automaticName) $('rule-name').value = `${builder.conditionLabel(value)} → ${appName}`.slice(0, 100);
      value.name = $('rule-name').value.trim();
      summary.replaceChildren(element('span', 'eyebrow', 'สรุปกฎ'), element('strong', '', `${builder.conditionLabel(value)} → ${appName}`),
        element('p', 'field-hint', value.enabled ? 'ใช้กับเหตุการณ์ที่ตรงเงื่อนไขและยังไม่ถูกกฎด้านบนเลือกไป' : 'กฎนี้ปิดอยู่ ยังไม่มีผลกับการส่งต่อ'));
      const planned = builder.placeRule(routing.rules, value, originalId, $('rule-position').value);
      const conflicts = builder.warnings(planned).filter(item => item.id === value.id || item.previousId === value.id);
      warning.hidden = !conflicts.length;
      warning.textContent = conflicts.map(item => item.id === value.id
        ? `กฎ “${planned.find(rule => rule.id === item.previousId).name}” รับเหตุการณ์นี้ไปก่อน เลือก “ลำดับการตรวจ” ให้อยู่ก่อนกฎนั้น หรือแก้เงื่อนไข`
        : `กฎนี้จะบังกฎ “${planned.find(rule => rule.id === item.id).name}” ด้านล่าง ตรวจลำดับก่อนบันทึก`).join('\n');
      sampleOutput.replaceChildren();
      if (value.postback?.key && value.postback.value && value.postback.key !== 'cusa_mfa') {
        const data = new URLSearchParams([[value.postback.key, value.postback.value]]).toString();
        sampleOutput.append(element('span', 'field-hint', 'ตัวอย่างข้อมูลปุ่มที่ตรงกับกฎนี้'), element('code', '', data), button('คัดลอกตัวอย่าง', async () => {
          try { await navigator.clipboard.writeText(data); sampleOutput.append(element('span', 'field-hint', 'คัดลอกแล้ว')); }
          catch { sampleOutput.append(element('span', 'field-hint', 'เลือกข้อความตัวอย่างแล้วคัดลอกได้โดยตรง')); }
        }, 'text-button', 'copy'));
      }
    }
    function parseSample() {
      const result = builder.parseSample($('rule-sample').value); choices.replaceChildren();
      sampleError.hidden = !result.error; sampleError.textContent = result.error || '';
      if (result.error) return;
      const choose = pair => {
        $('rule-key').value = pair.key; $('rule-value').value = pair.value;
        $('rule-key').setCustomValidity(''); $('rule-value').setCustomValidity('');
        for (const node of choices.querySelectorAll('button')) node.setAttribute('aria-pressed', String(node.dataset.parameter === pair.key));
        refresh();
      };
      choices.append(element('p', 'field-hint', 'เลือกหนึ่งพารามิเตอร์เพื่อแยกเส้นทาง:'));
      for (const pair of result.pairs) {
        const chip = button(`${pair.key}=${pair.value}`, () => choose(pair), 'chip-button'); chip.dataset.parameter = pair.key; choices.append(chip);
      }
      choose(result.pairs.find(pair => pair.key === 'action') || result.pairs[0]);
    }
    $('rule-sample').addEventListener('input', () => { sampleError.hidden = true; choices.replaceChildren(); });
    $('rule-name').addEventListener('input', () => { automaticName = false; });
    container.addEventListener('input', refresh); container.addEventListener('change', refresh);
    refresh();
    return { read: readDraft, beforeId: () => $('rule-position').value, newApp: () => $('rule-app').value === '!new'
      ? { id: newAppId, name: $('rule-new-name').value.trim(), url: $('rule-new-url').value.trim() } : undefined,
    destroy() { container.removeEventListener('input', refresh); container.removeEventListener('change', refresh); } };
  }
};
