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
  editTarget:    null   // current row being edited
};

/* ══════════════════════════════════════════════
   ▌ INIT
   ══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // Guard: admin only
  const user = requireAuth(true);
  if (!user) return;

  // Load initial tab (overview/reports)
  showAdminTab('tab-overview', null);
  await loadReports();

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
      populateSalaryEmployeeFilter
    };
    if (loaders[loadFn]) loaders[loadFn]();
  }
}

/* ══════════════════════════════════════════════
   ▌ REPORTS / OVERVIEW
   ══════════════════════════════════════════════ */
async function loadReports() {
  try {
    Loader.show('Loading reports...');
    const res = await API.getStats();
    if (res.success) {
      const s = res.data;
      setEl('statTotalEmployees', s.totalEmployees ?? 0);
      setEl('statTotalAttendance', s.totalAttendance ?? 0);
      setEl('statTotalBonuses', formatCurrency(s.totalBonuses ?? 0));
      setEl('statTotalDeductions', formatCurrency(s.totalDeductions ?? 0));
    }
  } catch (e) {
    console.error('loadReports:', e);
    Toast.error('Failed to load statistics', e.message);
  } finally {
    Loader.hide();
  }
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
  if (!confirm(`Delete employee "${emp?.name || id}"? This cannot be undone.`)) return;

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
  if (!confirm('Delete this announcement?')) return;
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
  if (!confirm('Delete this salary record?')) return;
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
   ▌ UTIL — Set inner HTML by element ID
   ══════════════════════════════════════════════ */
function setEl(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}
