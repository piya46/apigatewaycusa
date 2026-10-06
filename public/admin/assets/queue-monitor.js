'use strict';

window.QueueMonitor = {
  mount({ api, session, ui }) {
    const { element, badge, icon } = ui;
    const $ = id => document.getElementById(id);
    let active = false, busy = false, pending = false, generation = 0, timer, snapshot;
    let state = 'waiting', offset = 0;
    const titles = { waiting: 'งานที่รอส่ง', processing: 'งานที่ Worker หยิบแล้ว', dlq: 'งานใน Dead Letter Queue' };
    const errors = { timeout: 'ปลายทางหมดเวลาตอบ', http_error: 'ปลายทางตอบ HTTP error', network_error: 'เชื่อมต่อปลายทางไม่ได้',
      invalid_job: 'รูปแบบงานไม่ถูกต้อง', interrupted: 'Worker ทำงานไม่จบภายในเวลาครอบครอง', invalid_mfa: 'MFA ไม่ผ่านเงื่อนไข',
      missing_original: 'ไม่มีข้อมูลดิบและลายเซ็นเดิม', partial_duplicate: 'ชุด MFA มี event ซ้ำบางส่วน', delivery_contract: 'รูปแบบการส่งไม่ผ่าน', unknown: 'ไม่มีรายละเอียดที่เปิดเผยได้' };
    const date = value => value === null || value === undefined ? 'ไม่ทราบเวลา' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
    function age(value, now) {
      if (value === null || value === undefined) return 'ไม่ทราบ';
      const seconds = Math.max(0, Math.floor((now - value) / 1000));
      if (seconds < 60) return `${seconds} วินาที`;
      if (seconds < 3600) return `${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`;
      if (seconds < 86400) return `${Math.floor(seconds / 3600)} ชม. ${Math.floor(seconds % 3600 / 60)} นาที`;
      return `${Math.floor(seconds / 86400)} วัน ${Math.floor(seconds % 86400 / 3600)} ชม.`;
    }
    function controls() {
      const ready = active && Boolean(session());
      $('queue-refresh').disabled = !ready || busy;
      $('queue-prev').disabled = !ready || busy || !snapshot || offset === 0;
      $('queue-next').disabled = !ready || busy || !snapshot?.hasMore;
      $('queue-first').disabled = !ready || busy || offset === 0;
      for (const node of document.querySelectorAll('[data-queue-state]')) {
        node.disabled = !ready || busy;
        node.setAttribute('aria-pressed', String(node.dataset.queueState === state));
      }
      $('queue-refresh').replaceChildren(icon('refresh'), document.createTextNode(busy ? 'กำลังอ่านคิว…' : 'รีเฟรชคิว'));
      $('queue-list').setAttribute('aria-busy', String(busy));
    }
    function render(data) {
      for (const key of ['waiting', 'processing', 'dlq']) $(`queue-count-${key}`).textContent = data.counts[key].toLocaleString('th-TH');
      $('queue-capacity').textContent = `ใช้งาน ${(data.counts.waiting + data.counts.processing).toLocaleString('th-TH')} / ${data.capacity.toLocaleString('th-TH')} งาน · DLQ แยกจากความจุนี้`;
      $('queue-oldest').textContent = data.counts.waiting ? `อายุงานหน้าแถว ${age(data.oldestReceivedAt, data.capturedAt)}` : 'ไม่มีงานรอส่ง';
      $('queue-updated').textContent = `ข้อมูล ณ ${date(data.capturedAt)}`;
      const warnings = [];
      if (data.counts.expiredLeases) warnings.push(`มี ${data.counts.expiredLeases} งานหมดเวลาครอบครอง รอ Worker ตรวจและย้ายเข้า DLQ`);
      if (data.inconsistent) warnings.push('จำนวนงานกับดัชนีการครอบครองไม่ตรงกัน รายการกำลังดำเนินการอาจไม่ครบ ให้ผู้ดูแลตรวจ Redis และ log');
      if (data.counts.waiting + data.counts.processing >= data.capacity) warnings.push('คิวเต็ม คำขอใหม่จะได้รับ HTTP 503 จนกว่าจะมีที่ว่าง');
      $('queue-warning').hidden = !warnings.length; $('queue-warning').textContent = warnings.join(' · ');
      $('queue-list-title').textContent = titles[state];
      $('queue-page').textContent = data.total ? `${offset + 1}–${offset + data.items.length} จาก ${data.total.toLocaleString('th-TH')} งาน` : '0 งาน';
      $('queue-order-note').textContent = state === 'waiting' ? 'อันดับ 1 คืองานที่รอให้ Worker หยิบถัดไป · ลำดับเปลี่ยนได้เมื่อคิวเดิน'
        : state === 'processing' ? 'เรียงตามเวลาหมดการครอบครอง · การถูกหยิบไปยังไม่ยืนยันว่าปลายทางรับสำเร็จ'
        : 'เรียงงานที่เข้า DLQ ก่อนขึ้นก่อน · งานเหล่านี้ไม่ถูกส่งซ้ำอัตโนมัติ';
      $('queue-list').replaceChildren(...data.items.map(item => {
        const row = element('article', 'queue-row');
        const order = element('span', 'queue-position', `#${item.position}`);
        const copy = element('div', 'queue-job');
        const title = item.kind === 'sso_batch' ? `ชุดข้อมูล SSO · ${item.eventCount} events`
          : item.kind === 'verification' ? 'LINE Verify → SSO'
          : item.kind === 'invalid' ? 'ข้อมูลรายการไม่สมบูรณ์' : window.RuleBuilder.eventLabel(item.eventType);
        copy.append(element('h3', '', title), element('p', 'muted small', `รับครั้งแรก ${date(item.receivedAt)}`));
        if (item.id) copy.append(element('code', 'queue-job-id', `Job ${item.id}`));
        const detail = element('div', 'queue-detail');
        detail.append(element('strong', '', `อายุงาน ${age(item.receivedAt, data.capturedAt)}`));
        if (state === 'processing') detail.append(element('p', 'muted small', `สิ้นสุดการครอบครอง ${date(item.leaseExpiresAt)}`));
        if (state === 'dlq') detail.append(element('p', 'muted small', `เข้า DLQ ${date(item.failedAt)}`),
          element('p', 'queue-failure', `${errors[item.error?.kind] || errors.unknown}${item.error?.status ? ` (HTTP ${item.error.status})` : ''}`));
        const label = state === 'dlq' ? 'รอตรวจใน DLQ' : state === 'processing' ? (item.leaseExpired ? 'หมดเวลาครอบครอง' : 'กำลังดำเนินการ') : 'รอส่ง';
        row.append(order, copy, detail, badge(label, state === 'waiting' ? 'event-chip' : state === 'processing' && !item.leaseExpired ? 'active-chip' : 'queue-alert-chip'));
        return row;
      }));
      if (!data.items.length) {
        const empty = element('div', 'empty-state');
        empty.append(icon('check-circle'), element('h3', '', 'ไม่มีรายการในคิวนี้'), element('p', '', 'สถานะนี้อ้างอิงเวลาที่อ่านข้อมูลล่าสุด งานที่จบแล้วจะออกจากรายการ'));
        $('queue-list').append(empty);
      }
    }
    function schedule() {
      clearTimeout(timer);
      if (active && session() && !document.hidden && $('queue-auto').checked) timer = setTimeout(load, 15000);
    }
    async function load() {
      clearTimeout(timer);
      if (!active || !session() || document.hidden) return;
      if (busy) { pending = true; return; }
      busy = true; controls();
      const token = session(), version = generation;
      try {
        const result = await api(`/v1/admin/queue?state=${state}&offset=${offset}`);
        if (!active || session() !== token || generation !== version) return;
        snapshot = result; offset = result.offset;
        $('queue-error').hidden = true; render(result);
      } catch (error) {
        if (active && session() === token && generation === version) {
          if (snapshot) offset = snapshot.offset;
          $('queue-error').textContent = `${error.message}${snapshot ? ' · ข้อมูลด้านล่างเป็นข้อมูลก่อนหน้า ดูเวลาที่อัปเดตล่าสุด' : ''}`;
          $('queue-error').hidden = false;
        }
      } finally {
        busy = false; controls();
        if (pending) { pending = false; void load(); } else schedule();
      }
    }
    for (const node of document.querySelectorAll('[data-queue-state]')) node.addEventListener('click', () => {
      state = node.dataset.queueState; offset = 0; generation++; snapshot = undefined;
      $('queue-list').replaceChildren(); $('queue-page').textContent = 'กำลังโหลด…'; $('queue-list-title').textContent = titles[state];
      void load();
    });
    $('queue-refresh').addEventListener('click', load);
    $('queue-auto').addEventListener('change', () => { if ($('queue-auto').checked) void load(); else clearTimeout(timer); });
    $('queue-next').addEventListener('click', () => { offset += snapshot.limit; generation++; void load(); });
    $('queue-prev').addEventListener('click', () => { offset = Math.max(0, offset - snapshot.limit); generation++; void load(); });
    $('queue-first').addEventListener('click', () => { offset = 0; generation++; void load(); });
    document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden && active && $('queue-auto').checked) void load(); });
    return {
      setActive(value) { active = value; generation++; clearTimeout(timer); controls(); if (active) void load(); },
      reset() {
        active = false; generation++; pending = false; clearTimeout(timer); snapshot = undefined; offset = 0; state = 'waiting';
        $('queue-auto').checked = false; $('queue-list').replaceChildren();
        for (const id of ['queue-count-waiting', 'queue-count-processing', 'queue-count-dlq', 'queue-capacity', 'queue-oldest', 'queue-page', 'queue-updated']) $(id).textContent = '—';
        $('queue-error').hidden = true; $('queue-warning').hidden = true; controls();
      }
    };
  }
};
