/**
 * HR NEXUS — admin.js
 * Admin Dashboard Logic
 * Handles: Employees, Attendance, Announcements, Salary, Reports
 */

/* ══════════════════════════════════════════════
   ▌ STATE
   ══════════════════════════════════════════════ */
const AdminState = {
  employees:     [],
  attendance:    [],
  announcements: [],
  salary:        [],
  editTarget:    null,
  currentDetailEmp: null  // employee being viewed in detail tab
};

/* ══════════════════════════════════════════════
   ▌ INIT
   ══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Guard: admin only
  const user = requireAuth(true);
  if (!user) return;

  // Load initial tab (overview)
  showAdminTab('tab-overview', null);
  await loadOverview();

  // Tab navigation
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId   = btn.dataset.tab;
      const loadFn  = btn.dataset.load;
      showAdminTab(tabId, loadFn);

      // Update sidebar active
      document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Search / filter listeners
  document.getElementById('empSearch')?.addEventListener('input', debounce(filterEmployees, 300));
  document.getElementById('attEmpFilter')?.addEventListener('change', filterAttendance);
  document.getElementById('attDateFilter')?.addEventListener('change', filterAttendance);
  document.getElementById('annSearch')?.addEventListener('input', debounce(filterAnnouncements, 300));
  document.getElementById('salEmpFilter')?.addEventListener('change', filterSalary);
});

/* ══════════════════════════════════════════════
   ▌ TAB SYSTEM
   ══════════════════════════════════════════════ */
function showAdminTab(tabId, loadFn) {
  document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
  const el = document.getElementById(tabId);
  if (el) el.classList.add('active');

  // Load data for the tab
  if (loadFn) {
    const loaders = {
      loadEmployees,
      loadAttendance,
      loadAnnouncements,
      loadSalary,
      loadReports,
      loadOverview,
      populateSalaryEmployeeFilter,
      loadRequests
    };
    if (loaders[loadFn]) loaders[loadFn]();
  }
}

/* ══════════════════════════════════════════════
   ▌ REPORTS / OVERVIEW
   ══════════════════════════════════════════════ */

// ── Helper: parse any date value to yyyy-MM-dd ──
function normDate(val) {
  if (!val) return '';
  const s = String(val);
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!isNaN(d) && d.getFullYear() > 1970) {
    return d.getFullYear() + '-' +
      String(d.getMonth()+1).padStart(2,'0') + '-' +
      String(d.getDate()).padStart(2,'0');
  }
  return '';
}

// ── Helper: parse time string or Date-based time ──
function normTime(val) {
  if (!val) return '';
  const s = String(val);
  const t = s.match(/(\d{2}:\d{2}:\d{2})/);
  if (t) return t[1];
  const d = new Date(s);
  if (!isNaN(d)) {
    return String(d.getHours()).padStart(2,'0') + ':' +
           String(d.getMinutes()).padStart(2,'0') + ':' +
           String(d.getSeconds()).padStart(2,'0');
  }
  return s;
}

// ── Helper: time string to minutes since midnight ──
function timeToMins(t) {
  if (!t) return null;
  const p = t.split(':');
  if (p.length < 2) return null;
  return parseInt(p[0])*60 + parseInt(p[1]);
}

// ── Helper: minutes to HH:mm ──
function minsToTime(m) {
  if (m === null || m === undefined) return '—';
  return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
}

// ── Helper: duration between two HH:mm:ss strings ──
function calcDuration(checkIn, checkOut) {
  const a = timeToMins(checkIn), b = timeToMins(checkOut);
  if (a === null || b === null || b <= a) return '—';
  const diff = b - a;
  return `${Math.floor(diff/60)}h ${diff%60}m`;
}

async function loadOverview() {
  // Set current month default
  const now = new Date();
  const monthVal = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const reportMonthEl = document.getElementById('reportMonth');
  if (reportMonthEl && !reportMonthEl.value) reportMonthEl.value = monthVal;

  try {
    // Fetch employees and all attendance in parallel
    const [empRes, attRes] = await Promise.all([API.getEmployees(), API.getAttendance({})]);
    if (!empRes.success) throw new Error(empRes.message);
    if (!attRes.success) throw new Error(attRes.message);

    AdminState.employees  = empRes.data || [];
    // Normalize attendance records
    AdminState.attendance = (attRes.data || []).map(r => ({
      employeeId: String(r.employeeId || r.EmployeeID || '').trim(),
      name:       String(r.name || r.Name || '').trim(),
      date:       normDate(r.date || r.Date || ''),
      checkIn:    normTime(r.checkIn || r.CheckIn || ''),
      checkOut:   normTime(r.checkOut || r.CheckOut || '')
    }));

    populateSalaryEmployeeFilter();
    renderTodayAttendance();
    renderMonthlyReport();
  } catch (e) {
    console.error('loadOverview:', e);
    Toast.error('Failed to load overview', e.message);
  }
}

function renderTodayAttendance() {
  // Use local date (not UTC) to match server timezone
  const _now = new Date();
  const today = _now.getFullYear() + '-' +
    String(_now.getMonth()+1).padStart(2,'0') + '-' +
    String(_now.getDate()).padStart(2,'0');
  const tbody = document.getElementById('todayAttBody');
  if (!tbody) return;

  const todayAtt = AdminState.attendance.filter(r => r.date === today);
  const attendedIds = new Set(todayAtt.map(r => r.employeeId.toLowerCase()));

  let present = 0, absent = 0;
  const rows = AdminState.employees
    .filter(e => e.role !== 'admin')
    .map(emp => {
      const rec = todayAtt.find(r => r.employeeId.toLowerCase() === emp.id.toLowerCase()
        || r.name.toLowerCase() === emp.name.toLowerCase());
      if (rec) present++; else absent++;
      const hasIn  = rec && rec.checkIn;
      const hasOut = rec && rec.checkOut;
      const status = !rec
        ? '<span class="badge badge-muted">Absent</span>'
        : hasOut
          ? '<span class="badge badge-blue">Complete</span>'
          : '<span class="badge badge-gold">In Progress</span>';
      return `<tr style="cursor:pointer" onclick="openEmpDetail('${escapeHtml(emp.id)}')">
        <td><strong>${escapeHtml(emp.name)}</strong><br><span class="text-muted" style="font-size:12px">${escapeHtml(emp.id)}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(emp.department || '—')}</span></td>
        <td><span class="badge badge-green">${hasIn  ? rec.checkIn  : '—'}</span></td>
        <td><span class="badge ${hasOut ? 'badge-blue' : 'badge-muted'}">${hasOut ? rec.checkOut : '—'}</span></td>
        <td>${status}</td>
      </tr>`;
    });

  setEl('todayPresentBadge', `${present} Present`);
  setEl('todayAbsentBadge',  `${absent} Absent`);
  tbody.innerHTML = rows.length ? rows.join('') :
    `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No employees found</div></div></td></tr>`;
}

function renderMonthlyReport() {
  const monthVal = document.getElementById('reportMonth')?.value;
  if (!monthVal) return;
  const [year, month] = monthVal.split('-').map(Number);
  const tbody = document.getElementById('monthlyReportBody');
  if (!tbody) return;

  // Working days in the month (Mon–Fri)
  const daysInMonth = new Date(year, month, 0).getDate();
  let workDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month-1, d).getDay();
    if (day !== 5) workDays++; // Only Friday is weekend
  }

  const rows = AdminState.employees
    .filter(e => e.role !== 'admin')
    .map(emp => {
      const recs = AdminState.attendance.filter(r => {
        const d = r.date;
        if (!d) return false;
        const [y,m] = d.split('-').map(Number);
        const empMatch = r.employeeId.toLowerCase() === emp.id.toLowerCase()
          || r.name.toLowerCase() === emp.name.toLowerCase();
        return empMatch && y === year && m === month;
      });

      const daysPresent = recs.length;
      const inMins  = recs.map(r => timeToMins(r.checkIn)).filter(v => v !== null);
      const outMins = recs.map(r => timeToMins(r.checkOut)).filter(v => v !== null);
      const avgIn  = inMins.length  ? Math.round(inMins.reduce((a,b)=>a+b,0)  / inMins.length)  : null;
      const avgOut = outMins.length ? Math.round(outMins.reduce((a,b)=>a+b,0) / outMins.length) : null;

      return `<tr style="cursor:pointer" onclick="openEmpDetail('${escapeHtml(emp.id)}')">
        <td><strong>${escapeHtml(emp.name)}</strong><br><span class="text-muted" style="font-size:12px">${escapeHtml(emp.id)}</span></td>
        <td><span class="badge badge-blue">${escapeHtml(emp.department||'—')}</span></td>
        <td><span class="badge ${daysPresent>0?'badge-green':'badge-muted'}">${daysPresent} / ${workDays} days</span></td>
        <td>${avgIn  !== null ? minsToTime(avgIn)  : '—'}</td>
        <td>${avgOut !== null ? minsToTime(avgOut) : '—'}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openEmpDetail('${escapeHtml(emp.id)}')">🔍 View</button></td>
      </tr>`;
    });

  tbody.innerHTML = rows.length ? rows.join('') :
    `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No data</div></div></td></tr>`;
}

function openEmpDetail(empId) {
  const emp = AdminState.employees.find(e => e.id === empId);
  if (!emp) return;
  AdminState.currentDetailEmp = emp;

  // Set current month
  const now = new Date();
  const monthVal = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');
  const detailMonthEl = document.getElementById('detailMonth');
  if (detailMonthEl) detailMonthEl.value = monthVal;

  setEl('detailEmpName', escapeHtml(emp.name));
  setEl('detailEmpInfo', `${escapeHtml(emp.department||'—')} • ${escapeHtml(emp.position||'—')} • ID: ${escapeHtml(emp.id)}`);

  switchAdminTab('tab-emp-detail', null, emp.name);
  renderEmpDetail();
}

function renderEmpDetail() {
  const emp = AdminState.currentDetailEmp;
  if (!emp) return;

  const monthVal = document.getElementById('detailMonth')?.value;
  if (!monthVal) return;
  const [year, month] = monthVal.split('-').map(Number);

  // Get all records for this employee this month
  const recs = AdminState.attendance.filter(r => {
    if (!r.date) return false;
    const [y,m] = r.date.split('-').map(Number);
    return (r.employeeId.toLowerCase() === emp.id.toLowerCase()
      || r.name.toLowerCase() === emp.name.toLowerCase())
      && y === year && m === month;
  });

  // Build full calendar for the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let daysPresent = 0, daysAbsent = 0;
  const inMins = [], outMins = [];
  const detailRows = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(year, month-1, d).getDay();
    const dayName = dayNames[dow];
    const isWeekend = dow === 5; // Only Friday is weekend
    const rec = recs.find(r => r.date === dateStr);

    if (rec) {
      daysPresent++;
      if (timeToMins(rec.checkIn)  !== null) inMins.push(timeToMins(rec.checkIn));
      if (timeToMins(rec.checkOut) !== null) outMins.push(timeToMins(rec.checkOut));
    } else if (!isWeekend) {
      // Only count weekday absences
      const isPast = new Date(dateStr) < new Date(new Date().toDateString());
      if (isPast) daysAbsent++;
    }

    const status = rec
      ? (rec.checkOut ? '<span class="badge badge-green">Complete</span>'
                      : '<span class="badge badge-gold">In Progress</span>')
      : isWeekend
        ? '<span class="badge badge-muted">Weekend</span>'
        : new Date(dateStr) > new Date(new Date().toDateString())
          ? '<span class="badge badge-muted">Upcoming</span>'
          : '<span class="badge badge-muted">Absent</span>';

    const rowStyle = isWeekend ? 'opacity:0.4' : '';
    detailRows.push(`<tr style="${rowStyle}">
      <td class="bold">${dateStr}</td>
      <td>${dayName}</td>
      <td><span class="badge badge-green">${rec?.checkIn  || '—'}</span></td>
      <td><span class="badge badge-blue">${rec?.checkOut || '—'}</span></td>
      <td>${rec ? calcDuration(rec.checkIn, rec.checkOut) : '—'}</td>
      <td>${status}</td>
    </tr>`);
  }

  const avgIn  = inMins.length  ? Math.round(inMins.reduce((a,b)=>a+b,0)  / inMins.length)  : null;
  const avgOut = outMins.length ? Math.round(outMins.reduce((a,b)=>a+b,0) / outMins.length) : null;

  setEl('detailDaysPresent', daysPresent);
  setEl('detailDaysAbsent',  daysAbsent);
  setEl('detailAvgIn',  avgIn  !== null ? minsToTime(avgIn)  : '—');
  setEl('detailAvgOut', avgOut !== null ? minsToTime(avgOut) : '—');
  setEl('detailTableBody', detailRows.join(''));
}

async function loadReports() {
  // Legacy — redirect to loadOverview
  await loadOverview();
}

/* ══════════════════════════════════════════════
   ▌ EMPLOYEES — CRUD
   ══════════════════════════════════════════════ */
async function loadEmployees() {
  setEl('empTableBody', `<tr><td colspan="8" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading employees...</td></tr>`);
  try {
    const res = await API.getEmployees();
    if (res.success) {
      AdminState.employees = res.data || [];
      renderEmployeeTable(AdminState.employees);
      populateSalaryEmployeeFilter();
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    console.error('loadEmployees:', e);
    setEl('empTableBody', `<tr><td colspan="8" class="loading-rows text-red">Failed to load employees</td></tr>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderEmployeeTable(data) {
  if (!data.length) {
    setEl('empTableBody', `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-title">No employees found</div></div></td></tr>`);
    return;
  }
  setEl('empTableBody', data.map(emp => `
    <tr>
      <td class="bold">${escapeHtml(emp.id)}</td>
      <td class="bold">${escapeHtml(emp.name)}</td>
      <td><span class="badge badge-blue">${escapeHtml(emp.department)}</span></td>
      <td>${escapeHtml(emp.position)}</td>
      <td>${escapeHtml(emp.phone || '—')}</td>
      <td>${escapeHtml(emp.email || '—')}</td>
      <td>${formatDate(emp.hireDate)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditEmployee('${escapeHtml(emp.id)}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteEmployee('${escapeHtml(emp.id)}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>
  `).join(''));
}

function filterEmployees() {
  const q = document.getElementById('empSearch')?.value.toLowerCase() || '';
  const filtered = AdminState.employees.filter(e =>
    e.id?.toLowerCase().includes(q) ||
    e.name?.toLowerCase().includes(q) ||
    e.department?.toLowerCase().includes(q) ||
    e.position?.toLowerCase().includes(q)
  );
  renderEmployeeTable(filtered);
}

// Open ADD modal
function openAddEmployee() {
  AdminState.editTarget = null;
  document.getElementById('empModalTitle').textContent = 'Add New Employee';
  document.getElementById('empForm').reset();
  document.getElementById('empId').readOnly = false;
  openModal('empModal');
}

// Open EDIT modal
function openEditEmployee(id) {
  const emp = AdminState.employees.find(e => e.id === id);
  if (!emp) return;
  AdminState.editTarget = emp;
  document.getElementById('empModalTitle').textContent = 'Edit Employee';
  document.getElementById('empId').value         = emp.id;
  document.getElementById('empId').readOnly       = true;
  document.getElementById('empName').value        = emp.name;
  document.getElementById('empDepartment').value  = emp.department;
  document.getElementById('empPosition').value    = emp.position;
  document.getElementById('empPhone').value       = emp.phone;
  document.getElementById('empEmail').value       = emp.email;
  document.getElementById('empHireDate').value    = emp.hireDate;
  document.getElementById('empPassword').value    = emp.password || '';
  openModal('empModal');
}

// SAVE employee (add or edit)
async function saveEmployee() {
  const data = {
    id:         document.getElementById('empId').value.trim(),
    name:       document.getElementById('empName').value.trim(),
    department: document.getElementById('empDepartment').value.trim(),
    position:   document.getElementById('empPosition').value.trim(),
    phone:      document.getElementById('empPhone').value.trim(),
    email:      document.getElementById('empEmail').value.trim(),
    hireDate:   document.getElementById('empHireDate').value,
    password:   document.getElementById('empPassword').value.trim()
  };

  if (!data.id || !data.name || !data.department) {
    Toast.warning('Validation', 'ID, Name, and Department are required.');
    return;
  }

  const saveBtn = document.getElementById('empSaveBtn');
  saveBtn.disabled = true;
  saveBtn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const isEdit = !!AdminState.editTarget;
    const res = isEdit ? await API.updateEmployee(data) : await API.addEmployee(data);
    if (res.success) {
      Toast.success(isEdit ? 'Employee Updated' : 'Employee Added', `${data.name} has been saved.`);
      closeModal('empModal');
      loadEmployees();
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    Toast.error('Save Failed', e.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = 'Save Employee';
  }
}

// DELETE employee
async function deleteEmployee(id) {
  const emp = AdminState.employees.find(e => e.id === id);
  if (!window.confirm(`Delete employee "${emp?.name || id}"? This cannot be undone.`)) return;

  try {
    Loader.show('Deleting...');
    const res = await API.deleteEmployee(id);
    if (res.success) {
      Toast.success('Employee Deleted', `${emp?.name} has been removed.`);
      loadEmployees();
    } else {
      throw new Error(res.message);
    }
  } catch (e) {
    Toast.error('Delete Failed', e.message);
  } finally {
    Loader.hide();
  }
}

/* ══════════════════════════════════════════════
   ▌ ATTENDANCE
   ══════════════════════════════════════════════ */
async function loadAttendance() {
  setEl('attTableBody', `<tr><td colspan="5" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading attendance...</td></tr>`);
  try {
    const res = await API.getAttendance();
    if (res.success) {
      AdminState.attendance = res.data || [];
      renderAttendanceTable(AdminState.attendance);
    } else throw new Error(res.message);
  } catch (e) {
    setEl('attTableBody', `<tr><td colspan="5" class="loading-rows text-red">Failed to load</td></tr>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderAttendanceTable(data) {
  if (!data.length) {
    setEl('attTableBody', `<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No attendance records</div></div></td></tr>`);
    return;
  }

  // Sort newest first
  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  setEl('attTableBody', sorted.map(r => {
    const hasCheckout = r.checkOut && r.checkOut !== '—';
    return `
      <tr>
        <td class="bold">${escapeHtml(r.employeeId)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${formatDate(r.date)}</td>
        <td><span class="badge badge-green">${escapeHtml(r.checkIn || '—')}</span></td>
        <td>${hasCheckout ? `<span class="badge badge-blue">${escapeHtml(r.checkOut)}</span>` : '<span class="badge badge-muted">Pending</span>'}</td>
      </tr>
    `;
  }).join(''));
}

function filterAttendance() {
  const empId = document.getElementById('attEmpFilter')?.value.toLowerCase() || '';
  const date  = document.getElementById('attDateFilter')?.value || '';
  const filtered = AdminState.attendance.filter(r => {
    const matchEmp  = !empId || r.employeeId?.toLowerCase().includes(empId) || r.name?.toLowerCase().includes(empId);
    const matchDate = !date  || r.date === date;
    return matchEmp && matchDate;
  });
  renderAttendanceTable(filtered);
}

/* ══════════════════════════════════════════════
   ▌ ANNOUNCEMENTS — CRUD
   ══════════════════════════════════════════════ */
async function loadAnnouncements() {
  setEl('annList', `<div class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div> Loading...</div>`);
  try {
    const res = await API.getAnnouncements();
    if (res.success) {
      AdminState.announcements = res.data || [];
      renderAnnouncementList(AdminState.announcements);
    } else throw new Error(res.message);
  } catch (e) {
    setEl('annList', `<div class="loading-rows text-red">Failed to load announcements</div>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderAnnouncementList(data) {
  if (!data.length) {
    setEl('annList', `<div class="empty-state"><div class="empty-icon">📢</div><div class="empty-title">No announcements yet</div></div>`);
    return;
  }
  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  setEl('annList', sorted.map(ann => `
    <div class="announcement-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div>
          <div class="announcement-title">${escapeHtml(ann.title)}</div>
          <div class="announcement-body">${escapeHtml(ann.message)}</div>
          <div class="announcement-meta">📅 ${formatDate(ann.date)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditAnnouncement('${escapeHtml(ann.id || ann.title)}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteAnnouncement('${escapeHtml(ann.id || ann.title)}')" title="Delete">🗑️</button>
        </div>
      </div>
    </div>
  `).join(''));
}

function filterAnnouncements() {
  const q = document.getElementById('annSearch')?.value.toLowerCase() || '';
  const filtered = AdminState.announcements.filter(a =>
    a.title?.toLowerCase().includes(q) || a.message?.toLowerCase().includes(q)
  );
  renderAnnouncementList(filtered);
}

function openAddAnnouncement() {
  AdminState.editTarget = null;
  document.getElementById('annModalTitle').textContent = 'New Announcement';
  document.getElementById('annForm').reset();
  document.getElementById('annDate').value = new Date().toISOString().split('T')[0];
  openModal('annModal');
}

function openEditAnnouncement(id) {
  const ann = AdminState.announcements.find(a => (a.id || a.title) === id);
  if (!ann) return;
  AdminState.editTarget = ann;
  document.getElementById('annModalTitle').textContent = 'Edit Announcement';
  document.getElementById('annTitle').value   = ann.title;
  document.getElementById('annMessage').value = ann.message;
  document.getElementById('annDate').value    = ann.date;
  openModal('annModal');
}

async function saveAnnouncement() {
  const data = {
    id:      AdminState.editTarget?.id || null,
    title:   document.getElementById('annTitle').value.trim(),
    message: document.getElementById('annMessage').value.trim(),
    date:    document.getElementById('annDate').value
  };

  if (!data.title || !data.message) {
    Toast.warning('Validation', 'Title and message are required.');
    return;
  }

  const btn = document.getElementById('annSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const isEdit = !!AdminState.editTarget;
    const res = isEdit ? await API.updateAnnouncement(data) : await API.addAnnouncement(data);
    if (res.success) {
      Toast.success(isEdit ? 'Announcement Updated' : 'Announcement Added');
      closeModal('annModal');
      loadAnnouncements();
    } else throw new Error(res.message);
  } catch (e) {
    Toast.error('Save Failed', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function deleteAnnouncement(id) {
  if (!window.confirm('Delete this announcement?')) return;
  try {
    Loader.show('Deleting...');
    const res = await API.deleteAnnouncement(id);
    if (res.success) { Toast.success('Deleted'); loadAnnouncements(); }
    else throw new Error(res.message);
  } catch (e) {
    Toast.error('Delete Failed', e.message);
  } finally {
    Loader.hide();
  }
}

/* ══════════════════════════════════════════════
   ▌ SALARY / BONUSES & DEDUCTIONS — CRUD
   ══════════════════════════════════════════════ */
async function loadSalary() {
  setEl('salTableBody', `<tr><td colspan="7" class="loading-rows"><div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:8px"></div>Loading...</td></tr>`);
  try {
    const res = await API.getSalary();
    if (res.success) {
      AdminState.salary = res.data || [];
      renderSalaryTable(AdminState.salary);
    } else throw new Error(res.message);
  } catch (e) {
    setEl('salTableBody', `<tr><td colspan="7" class="loading-rows text-red">Failed to load</td></tr>`);
    Toast.error('Load Failed', e.message);
  }
}

function renderSalaryTable(data) {
  if (!data.length) {
    setEl('salTableBody', `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">💰</div><div class="empty-title">No salary records</div></div></td></tr>`);
    return;
  }
  const sorted = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
  setEl('salTableBody', sorted.map(r => `
    <tr>
      <td class="bold">${escapeHtml(r.employeeId)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="text-green font-bold">+${formatCurrency(r.bonus)}</td>
      <td class="text-red font-bold">-${formatCurrency(r.deduction)}</td>
      <td>${escapeHtml(r.notes || '—')}</td>
      <td>${formatDate(r.date)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="openEditSalary('${escapeHtml(r.id)}')" title="Edit">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteSalary('${escapeHtml(r.id)}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>
  `).join(''));
}

function filterSalary() {
  const empId = document.getElementById('salEmpFilter')?.value.toLowerCase() || '';
  const filtered = !empId ? AdminState.salary
    : AdminState.salary.filter(r => r.employeeId?.toLowerCase() === empId || r.name?.toLowerCase().includes(empId));
  renderSalaryTable(filtered);
}

function populateSalaryEmployeeFilter() {
  const sel = document.getElementById('salEmpFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Employees</option>' +
    AdminState.employees.map(e =>
      `<option value="${escapeHtml(e.id.toLowerCase())}">${escapeHtml(e.name)} (${escapeHtml(e.id)})</option>`
    ).join('');
  sel.value = current;

  // Also populate salary form employee select
  const formSel = document.getElementById('salEmployeeId');
  if (formSel) {
    formSel.innerHTML = '<option value="">Select Employee</option>' +
      AdminState.employees.map(e =>
        `<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)} — ${escapeHtml(e.id)}</option>`
      ).join('');
  }
}

function openAddSalary() {
  AdminState.editTarget = null;
  document.getElementById('salModalTitle').textContent = 'Add Bonus / Deduction';
  document.getElementById('salForm').reset();
  document.getElementById('salDate').value = new Date().toISOString().split('T')[0];
  openModal('salModal');
}

function openEditSalary(id) {
  const r = AdminState.salary.find(s => s.id == id);
  if (!r) return;
  AdminState.editTarget = r;
  document.getElementById('salModalTitle').textContent = 'Edit Record';
  document.getElementById('salEmployeeId').value = r.employeeId;
  document.getElementById('salBonus').value      = r.bonus;
  document.getElementById('salDeduction').value  = r.deduction;
  document.getElementById('salNotes').value      = r.notes;
  document.getElementById('salDate').value       = r.date;
  openModal('salModal');
}

async function saveSalary() {
  const employeeSelect = document.getElementById('salEmployeeId');
  const selectedId = employeeSelect?.value;
  const selectedEmp = AdminState.employees.find(e => e.id === selectedId);

  const data = {
    id:          AdminState.editTarget?.id || null,
    employeeId:  selectedId,
    name:        selectedEmp?.name || '',
    bonus:       parseFloat(document.getElementById('salBonus').value) || 0,
    deduction:   parseFloat(document.getElementById('salDeduction').value) || 0,
    notes:       document.getElementById('salNotes').value.trim(),
    date:        document.getElementById('salDate').value
  };

  if (!data.employeeId) {
    Toast.warning('Validation', 'Please select an employee.');
    return;
  }

  const btn = document.getElementById('salSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-sm"></span> Saving...';

  try {
    const isEdit = !!AdminState.editTarget;
    const res = isEdit ? await API.updateSalaryRecord(data) : await API.addSalaryRecord(data);
    if (res.success) {
      Toast.success(isEdit ? 'Record Updated' : 'Record Added');
      closeModal('salModal');
      loadSalary();
    } else throw new Error(res.message);
  } catch (e) {
    Toast.error('Save Failed', e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'Save';
  }
}

async function deleteSalary(id) {
  if (!window.confirm('Delete this salary record?')) return;
  try {
    Loader.show('Deleting...');
    const res = await API.deleteSalaryRecord(id);
    if (res.success) { Toast.success('Deleted'); loadSalary(); }
    else throw new Error(res.message);
  } catch (e) {
    Toast.error('Delete Failed', e.message);
  } finally {
    Loader.hide();
  }
}


/* ══════════════════════════════════════════════
   ▌ REQUESTS
   ══════════════════════════════════════════════ */
let allRequests = [];
let currentReqFilter = 'all';

async function loadRequests() {
  const listEl = document.getElementById('requestsList');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading-rows"><div class="spinner" style="margin:0 auto 12px"></div>Loading...</div>';

  try {
    const res = await API.getRequests({});
    if (!res.success) throw new Error(res.message);

    allRequests = (res.data || []).sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return new Date(b.date) - new Date(a.date);
    });

    const pending = allRequests.filter(r => r.status === 'pending').length;
    const badge = document.getElementById('pendingRequestsBadge');
    if (badge) badge.textContent = pending > 0 ? pending : '';

    renderRequests();
  } catch (e) {
    const listEl2 = document.getElementById('requestsList');
    if (listEl2) listEl2.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Failed</div><div class="empty-desc">' + e.message + '</div></div>';
  }
}

function filterRequestsTab(filter) {
  currentReqFilter = filter;
  ['all','leave','outside'].forEach(f => {
    const el = document.getElementById('reqTab' + f.charAt(0).toUpperCase() + f.slice(1));
    if (el) el.classList.toggle('active', f === filter);
  });
  renderRequests();
}

function renderRequests() {
  const listEl = document.getElementById('requestsList');
  if (!listEl) return;

  let filtered = allRequests;
  if (currentReqFilter === 'leave')   filtered = allRequests.filter(r => String(r.type||'').startsWith('leave'));
  if (currentReqFilter === 'outside') filtered = allRequests.filter(r => String(r.type||'').includes('outside'));

  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-title">No requests</div></div>';
    return;
  }

  const typeLabel = t => {
    if (!t) return '—';
    if (t.includes('annual'))    return '🌴 Annual Leave';
    if (t.includes('sick'))      return '🏥 Sick Leave';
    if (t.includes('emergency')) return '🚨 Emergency Leave';
    if (t.includes('outside'))   return '📍 Outside Office';
    if (t.includes('leave'))     return '🌴 Leave';
    return t;
  };
  const statusBadge = s => {
    if (s === 'approved') return '<span class="badge badge-green">✅ Approved</span>';
    if (s === 'rejected') return '<span class="badge badge-muted" style="background:#f43f5e20;color:#f43f5e">❌ Rejected</span>';
    return '<span class="badge badge-gold">⏳ Pending</span>';
  };

  listEl.innerHTML = filtered.map(r => {
    // Debug: log the id to console
    const rid = String(r.id || r.at || r.AT || '').trim();
    let extra = {};
    try { extra = JSON.parse(r.extra || '{}'); } catch(e) {}
    const isPending = r.status === 'pending';
    const borderColor = isPending ? 'var(--gold-500)' : (r.status === 'approved' ? '#22c55e' : '#f43f5e');
    return `<div class="card" style="margin-bottom:12px;border-right:4px solid ${borderColor}">
      <div style="padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div>
            <div style="font-weight:700;font-size:15px">${escapeHtml(r.name||'—')}</div>
            <div style="color:var(--text-muted);font-size:13px">${escapeHtml(r.employeeId||'')} · ${r.date||''}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${statusBadge(r.status)}
            <span class="badge badge-blue">${typeLabel(r.type)}</span>
          </div>
        </div>
        <div style="color:var(--text-secondary);font-size:14px;margin-bottom:10px">
          ${escapeHtml(r.message||'—')}
        </div>
        ${extra.note ? `<div style="font-size:13px;background:rgba(245,158,11,0.08);padding:8px 12px;border-radius:6px;margin-bottom:10px;color:var(--text-primary)">📝 ${escapeHtml(extra.note)}</div>` : ''}
        ${extra.photoUrl ? `
        <div style="margin-bottom:12px">
          <a href="${extra.photoUrl}" target="_blank" title="کلیک بکە بۆ گەورەکردن">
            <img src="${extra.photoUrl}" style="width:100%;max-height:200px;object-fit:cover;border-radius:8px;border:1px solid var(--border-color);cursor:pointer"
              onerror="this.parentElement.innerHTML='<div style=\'font-size:13px;color:var(--text-muted)\'>📷 وێنەکە بەردەست نیە</div>'">
          </a>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">📷 وێنەی شوێن — کلیک بکە بۆ گەورەکردن</div>
        </div>` : ''}
        ${isPending && rid ? `
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn btn-primary btn-sm" onclick="doApproveReq('${rid}')">✅ Approve</button>
          <button class="btn btn-danger btn-sm" onclick="doRejectReq('${rid}')">❌ Reject</button>
        </div>` : (isPending ? '<div style="color:red;font-size:12px">⚠️ Missing request ID</div>' : '')}
      </div>
    </div>`;
  }).join('');
}

async function doApproveReq(id) {
  if (!id) { Toast.error('Error', 'Missing request ID'); return; }
  if (!window.confirm('Approve this request?')) return;
  try {
    Loader.show('Approving...');
    const res = await API.approveRequest({ id });
    if (res.success) { Toast.success('Approved ✅'); await loadRequests(); }
    else throw new Error(res.message || JSON.stringify(res));
  } catch (e) {
    Toast.error('Failed', e.message);
    console.error('approveRequest error:', e);
  } finally { Loader.hide(); }
}

async function doRejectReq(id) {
  if (!id) { Toast.error('Error', 'Missing request ID'); return; }
  if (!window.confirm('Reject this request?')) return;
  try {
    Loader.show('Rejecting...');
    const res = await API.rejectRequest({ id });
    if (res.success) { Toast.warning('Rejected ❌'); await loadRequests(); }
    else throw new Error(res.message || JSON.stringify(res));
  } catch (e) {
    Toast.error('Failed', e.message);
    console.error('rejectRequest error:', e);
  } finally { Loader.hide(); }
}

/* ══════════════════════════════════════════════
   ▌ UTIL — Set inner HTML by element ID
   ══════════════════════════════════════════════ */
function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
