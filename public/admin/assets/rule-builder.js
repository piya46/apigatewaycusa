'use strict';

// Browser-only authoring helpers. Stored rules keep the existing version-2 schema.
(function (root) {
  const events = [
    ['postback', 'กดปุ่มหรือเมนู LINE'], ['message', 'ส่งข้อความ รูป หรือไฟล์'],
    ['follow', 'เพิ่มเพื่อน / ปลดบล็อก'], ['unfollow', 'บล็อกบัญชี LINE'],
    ['join', 'เชิญบอตเข้ากลุ่ม'], ['leave', 'นำบอตออกจากกลุ่ม'],
    ['memberJoined', 'สมาชิกเข้ากลุ่ม'], ['memberLeft', 'สมาชิกออกจากกลุ่ม'],
    ['unsend', 'ยกเลิกข้อความ'], ['videoPlayComplete', 'ดูวิดีโอจบ'], ['accountLink', 'เชื่อมบัญชี']
  ];
  const eventLabel = type => events.find(([id]) => id === type)?.[1] || type;
  function conditionLabel(rule) {
    if (rule.postback && (!rule.postback.key || !rule.postback.value)) return 'กดปุ่มตามเงื่อนไข';
    if (rule.postback) return `กดปุ่มที่ ${rule.postback.key}=${rule.postback.value}`;
    return rule.eventType === 'postback' ? 'กดปุ่มทั่วไปทุกปุ่ม (ยกเว้น MFA)' : eventLabel(rule.eventType);
  }
  function parseSample(raw) {
    if (!raw.trim() || raw.length > 4096) return { error: 'วางข้อมูลจากปุ่ม LINE เช่น action=register&source=menu (ไม่เกิน 4,096 ตัวอักษร)' };
    if (!raw.includes('=') || /^[{[]|^https?:\/\//i.test(raw.trim()) || /%(?![\da-f]{2})/i.test(raw)) {
      return { error: 'ใช้เฉพาะค่า postback.data เช่น action=register ไม่ใช่ JSON หรือ URL ของเว็บ' };
    }
    const params = new URLSearchParams(raw);
    if (params.has('cusa_mfa')) return { error: 'ตัวอย่างนี้เป็น CUSA MFA ซึ่งมีเส้นทางไป SSO อยู่แล้ว ไม่ต้องสร้างกฎเพิ่ม' };
    const pairs = [];
    for (const [key, value] of params) {
      if (params.getAll(key).length !== 1) return { error: 'มีชื่อพารามิเตอร์ซ้ำ กรุณาใช้ตัวอย่างที่แต่ละชื่อมีค่าเดียว' };
      if (!key || !value || key.length > 128 || value.length > 1024 || key.trim() !== key || value.trim() !== value
        || /[\u0000-\u001f\u007f]/.test(key + value)) return { error: 'ชื่อและค่าต้องไม่ว่าง ไม่มีอักขระควบคุมหรือช่องว่างหัวท้าย' };
      pairs.push({ key, value });
    }
    return { pairs };
  }
  // Report only complete shadowing. Different parameter keys can overlap, but
  // neither covers the other, so do not mislabel them as unreachable.
  function warnings(rules) {
    const found = [];
    for (let index = 0; index < rules.length; index++) {
      const current = rules[index];
      if (!current.enabled) continue;
      const previous = rules.slice(0, index).find(rule => rule.enabled && rule.eventType === current.eventType
        && (!rule.postback || (current.postback && rule.postback.key === current.postback.key && rule.postback.value === current.postback.value)));
      if (previous) found.push({ id: current.id, previousId: previous.id,
        kind: Boolean(previous.postback) === Boolean(current.postback) ? 'duplicate' : 'shadowed' });
    }
    return found;
  }
  function placeRule(rules, draft, originalId, beforeId) {
    const next = rules.filter(rule => rule.id !== originalId);
    const index = next.findIndex(rule => rule.id === beforeId);
    next.splice(index < 0 ? next.length : index, 0, draft);
    return next;
  }
  const helpers = { events, eventLabel, conditionLabel, parseSample, warnings, placeRule };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  else root.RuleBuilder = helpers;
})(typeof window === 'undefined' ? globalThis : window);
