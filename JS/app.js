// app.js - main frontend logic (login, index, create, edit, view, states, uploads)
(async () => {
  // After this file loads, pages call init functions below
})();

// ----------------- helpers -----------------
function getToken() {
  return localStorage.getItem("jwt_token");
}
function setToken(t) {
  localStorage.setItem("jwt_token", t);
}
function logout() {
  localStorage.removeItem("jwt_token");
  location.href = "login.html";
}
async function apiFetch(url, opts = {}) {
  opts.headers = opts.headers || {};
  const token = getToken();
  if (token) opts.headers["Authorization"] = "Bearer " + token;
  if (!opts.headers["Content-Type"] && !(opts.body instanceof FormData)) {
    opts.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(apiBaseUrl + url, opts);
  if (res.status === 401) {
    // Token expired / invalid
    logout();
    throw new Error("Unauthorized");
  }
  const text = await res.text();
  try { return JSON.parse(text || "{}"); } catch(e) { return text; }
}

// ----------------- Login page -----------------
async function initLoginPage() {
  const form = document.getElementById("loginForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const username = form.username.value.trim();
    const password = form.password.value.trim();
    if (!username || !password) {
      Swal.fire("Error", "Enter username and password", "error");
      return;
    }
    try {
      const res = await fetch(apiBaseUrl + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) {
        Swal.fire("Invalid Username or Password", "", "error");
        return;
      }
      const data = await res.json();
      setToken(data.token);
      location.href = "index.html";
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "Could not login", "error");
    }
  });
}

// ----------------- Protect pages -----------------
function guard() {
  if (!getToken()) {
    location.href = "login.html";
    return false;
  }
  return true;
}

// ----------------- Index page -----------------
async function initIndexPage() {
  if (!guard()) return;
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("btnCreate").addEventListener("click", () => location.href="create.html");

  const searchInput = document.getElementById("searchInput");
  const pageSizeSelect = document.getElementById("pageSize");

  let page = 1;
  let pageSize = parseInt(pageSizeSelect.value || "5");
  let search = "";

  async function load() {
    try {
      const q = `?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`;
      const data = await apiFetch("/student/list" + q, { method: "GET" });
      renderTable(data.items || [], data.total || 0, data.page || 1, data.pageSize || pageSize);
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "Could not fetch students", "error");
    }
  }

  function renderTable(items, total, currentPage, currentPageSize) {
    const tbody = document.querySelector("#studentsTable tbody");
    tbody.innerHTML = "";
    for (const s of items) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(s.name)}</td>
        <td>${s.age}</td>
        <td>${escapeHtml(s.address)}</td>
        <td>${escapeHtml(s.stateName)}</td>
        <td>${escapeHtml(s.phone)}</td>
        <td>${s.photos && s.photos.length ? `<img src="${escapeUrl(s.photos[0])}" style="width:60px;height:60px;object-fit:cover;border-radius:6px"/>` : ""}</td>
        <td>${escapeHtml(Array.isArray(s.subjects) ? s.subjects.join(", ") : "")}</td>
        <td>
          <button class="btn btn-sm btn-primary btn-edit" data-id="${s.studentId}">Edit</button>
          <button class="btn btn-sm btn-danger btn-delete" data-id="${s.studentId}">Delete</button>
          <button class="btn btn-sm btn-info btn-view" data-id="${s.studentId}">View</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // attach actions
    tbody.querySelectorAll(".btn-delete").forEach(b => b.addEventListener("click", onDelete));
    tbody.querySelectorAll(".btn-edit").forEach(b => b.addEventListener("click", e => location.href = `edit.html?id=${e.target.dataset.id}`));
    tbody.querySelectorAll(".btn-view").forEach(b => b.addEventListener("click", e => location.href = `view.html?id=${e.target.dataset.id}`));

    // pagination
    const totalPages = Math.max(1, Math.ceil(total / currentPageSize));
    const pag = document.getElementById("pagination");
    pag.innerHTML = '';
    for (let p = 1; p <= totalPages; p++) {
      const btn = document.createElement("button");
      btn.className = `btn btn-sm ${p===currentPage?'btn-secondary':'btn-light'} m-1`;
      btn.textContent = p;
      btn.addEventListener("click", () => { page = p; load(); });
      pag.appendChild(btn);
    }
  }

  async function onDelete(ev) {
    const id = ev.target.dataset.id;
    const ok = await Swal.fire({
      title: "Are you sure you want to delete this record?",
      showCancelButton: true,
      icon: "warning"
    });
    if (!ok.isConfirmed) return;
    try {
      await apiFetch(`/student/${id}`, { method: "DELETE" });
      Swal.fire("Deleted", "", "success");
      load();
    } catch (err) {
      Swal.fire("Error", "Could not delete", "error");
    }
  }

  searchInput.addEventListener("input", (e) => { search = e.target.value; page = 1; load(); });
  pageSizeSelect.addEventListener("change", (e) => { pageSize = parseInt(e.target.value); page = 1; load(); });

  // initial load
  load();
}

// ----------------- Create page -----------------
async function initCreatePage() {
  if (!guard()) return;
  bindCommonCreateEdit();
  await loadStates();

  const form = document.getElementById("studentForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    // raw state value - supports either a select (id) or a text input (name)
    const rawState = (document.getElementById("state")?.value || "").toString().trim();

    // basic validation: ensure required fields present before server calls
    const nameVal = document.getElementById("name").value.trim();
    const ageVal = parseInt(document.getElementById("age").value);
    const dobVal = document.getElementById("dob").value;
    const phoneVal = document.getElementById("phone").value.trim();
    if (!nameVal || !ageVal || !dobVal || !phoneVal || !rawState) {
      Swal.fire("Please fill required fields", "", "error");
      return;
    }

    try {
      // Resolve stateId:
      let resolvedStateId = null;
      const maybeId = parseInt(rawState);
      if (!Number.isNaN(maybeId) && maybeId > 0) {
        resolvedStateId = maybeId;
      } else {
        // create new state on the server
        const r = await apiFetch("/student/states", {
          method: "POST",
          body: JSON.stringify({ StateName: rawState })
        });
        if (!r || !r.state_id) {
          Swal.fire("Error", "Could not save state", "error");
          return;
        }
        resolvedStateId = r.state_id;
        // refresh states to keep select in sync (if using select)
        if (typeof loadStates === "function") await loadStates();
      }

      const model = collectFormModel(resolvedStateId);
      // proceed with create
      const res = await apiFetch("/student/create", {
        method: "POST",
        body: JSON.stringify(model)
      });
      const id = res.student_id;
      // upload files if any
      const files = document.getElementById("photos").files;
      if (files && files.length) {
        await uploadFiles(id, files);
      }
      Swal.fire("Saved", "Student created successfully", "success").then(() => { location.href = "index.html"; });
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "Could not create student", "error");
    }
  });

  // add subject row button 
  document.getElementById("addSubjectBtn").addEventListener("click", addSubjectRow);
  // save state modal button
  const saveStateBtn = document.getElementById("btnSaveState");
  if (saveStateBtn) saveStateBtn.addEventListener("click", showSaveStateModal);
}

function bindCommonCreateEdit() {
  if (document.getElementById("btnLogout")) document.getElementById("btnLogout").addEventListener("click", logout);
  if (document.getElementById("btnBack")) document.getElementById("btnBack").addEventListener("click", () => location.href="index.html");
}

// collectFormModel now accepts a resolved stateId (number) if available
function collectFormModel(resolvedStateId = null) {
  const name = document.getElementById("name").value.trim();
  const age = parseInt(document.getElementById("age").value);
  const dob = document.getElementById("dob").value;
  const address = document.getElementById("address").value.trim();

  // If state element is a select (value is id) or resolvedStateId provided, use that.
  let stateId = null;
  const stateEl = document.getElementById("state");
  if (resolvedStateId) {
    stateId = resolvedStateId;
  } else if (stateEl) {
    const raw = stateEl.value;
    const maybe = parseInt(raw);
    if (!Number.isNaN(maybe) && maybe > 0) stateId = maybe;
  }

  const phone = document.getElementById("phone").value.trim();
  const subjects = [];
  document.querySelectorAll(".subject-name").forEach(i => { if (i.value.trim()) subjects.push(i.value.trim()); });
  return { Name: name, Age: age, Dob: dob, Address: address, StateId: stateId, Phone: phone, Subjects: subjects };
}

async function uploadFiles(studentId, files) {
  // compress each file to ~2KB using browser-image-compression
  const compressed = [];
  for (const f of files) {
    try {
      const opt = { maxSizeMB: 0.002, maxWidthOrHeight: 1600, useWebWorker: true };
      const blob = await imageCompression(f, opt);
      // ensure a file object
      const fileObj = new File([blob], f.name, { type: blob.type });
      compressed.push(fileObj);
    } catch (err) {
      console.warn("compression failed for", f.name, err);
      compressed.push(f); // fallback
    }
  }
  if (!compressed.length) return;
  const fd = new FormData();
  compressed.forEach(c => fd.append("files", c));
  await apiFetch(`/student/uploadPhotos/${studentId}`, { method: "POST", body: fd });
}

// ----------------- Edit page -----------------
async function initEditPage() {
  if (!guard()) return;
  bindCommonCreateEdit();
  await loadStates();
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) { Swal.fire("Missing id"); return; }

  // load student details
  const dto = await apiFetch(`/student/${id}`, { method: "GET" });
  // prefill form fields
  document.getElementById("name").value = dto.name || dto.Name || "";
  document.getElementById("age").value = dto.age || dto.Age || "";
  document.getElementById("dob").value = (dto.dob || "").split("T")[0] || "";
  document.getElementById("address").value = dto.address || "";
  document.getElementById("phone").value = dto.phone || "";

  // Try to set state field: if state is a select, set value to id; if it's an input, set name
  const stateEl = document.getElementById("state");
  if (stateEl) {
    if (stateEl.tagName.toLowerCase() === "select") {
      stateEl.value = dto.stateId || dto.StateId || "";
    } else {
      // show the name if available; fallback to id
      stateEl.value = dto.stateName || dto.StateName || (dto.stateId || dto.StateId ? String(dto.stateId || dto.StateId) : "");
    }
  }

  // subjects
  const container = document.getElementById("subjectsContainer");
  container.innerHTML = "";
  (dto.subjects || dto.Subjects || []).forEach(s => {
    appendSubjectRowValue(s);
  });
  // photos show preview 
  const preview = document.getElementById("photoPreview");
  preview.innerHTML = "";
  (dto.photos || dto.Photos || []).forEach(p => {
    const img = document.createElement("img");
    img.src = p;
    img.style.width = "80px";
    img.style.marginRight = "6px";
    preview.appendChild(img);
  });

  // Add/Remove subject controls
  const addBtn = document.getElementById("addSubjectBtn");
  if (addBtn) addBtn.addEventListener("click", addSubjectRow);

  // submit update -> show password prompt
  const studentForm = document.getElementById("studentForm");
  studentForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const passwordResp = await Swal.fire({
      title: "Enter password to update",
      input: "password",
      inputLabel: "Password",
      showCancelButton: true
    });
    if (!passwordResp.isConfirmed) return;
    const password = passwordResp.value;
    if (password !== "72991") {
      Swal.fire("Wrong Password", "", "error");
      return;
    }

    // raw state value
    const rawState = (document.getElementById("state")?.value || "").toString().trim();

    // basic front validation
    const nameVal = document.getElementById("name").value.trim();
    const ageVal = parseInt(document.getElementById("age").value);
    const dobVal = document.getElementById("dob").value;
    const phoneVal = document.getElementById("phone").value.trim();
    if (!nameVal || !ageVal || !dobVal || !phoneVal || !rawState) {
      Swal.fire("Please fill required fields", "", "error");
      return;
    }

    try {
      let resolvedStateId = null;
      const maybeId = parseInt(rawState);
      if (!Number.isNaN(maybeId) && maybeId > 0) {
        resolvedStateId = maybeId;
      } else {
        // create new state
        const r = await apiFetch("/student/states", {
          method: "POST",
          body: JSON.stringify({ StateName: rawState })
        });
        if (!r || !r.state_id) { Swal.fire("Error", "Could not save state", "error"); return; }
        resolvedStateId = r.state_id;
        if (typeof loadStates === "function") await loadStates();
      }

      const model = collectFormModel(resolvedStateId);

      await apiFetch(`/student/update/${id}?password=${encodeURIComponent(password)}`, {
        method: "PUT",
        body: JSON.stringify(model)
      });
      // upload any new photos
      const files = document.getElementById("photos").files;
      if (files && files.length) await uploadFiles(id, files);
      Swal.fire("Updated", "", "success").then(()=> location.href = "index.html");
    } catch (err) {
      console.error(err);
      Swal.fire("Error", "Could not update", "error");
    }
  });
}

// ----------------- View page -----------------
async function initViewPage() {
  if (!guard()) return;
  const back = document.getElementById("btnBack");
  if (back) back.addEventListener("click", () => location.href = "index.html");
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  if (!id) return;
  const dto = await apiFetch(`/student/${id}`, { method: "GET" });
  document.getElementById("vName").textContent = dto.name;
  document.getElementById("vAge").textContent = dto.age;
  document.getElementById("vDob").textContent = dto.dob ? dto.dob.split("T")[0] : "";
  document.getElementById("vAddress").textContent = dto.address;
  document.getElementById("vState").textContent = dto.stateName || dto.StateName || dto.stateId || dto.StateId;
  document.getElementById("vPhone").textContent = dto.phone;
  const sublist = document.getElementById("vSubjects");
  sublist.innerHTML = "";
  (dto.subjects || dto.Subjects || []).forEach(s => {
    const li = document.createElement("li"); li.textContent = s; sublist.appendChild(li);
  });
  const photos = document.getElementById("vPhotos");
  photos.innerHTML = "";
  (dto.photos || dto.Photos || []).forEach(p => {
    const img = document.createElement("img");
    img.src = p;
    img.style.width = "120px"; img.style.margin = "4px";
    photos.appendChild(img);
  });
}

// ----------------- States handling -----------------
async function loadStates() {
  try {
    const states = await apiFetch("/student/states", { method: "GET" });
    const sel = document.getElementById("state");
    if (!sel) return;
    // if the state element is an input (text), don't overwrite its value, but keep available list in case of select
    if (sel.tagName.toLowerCase() !== "select") return;
    sel.innerHTML = '<option value="">-- Select State --</option>';
    (states || []).forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.state_id;
      opt.textContent = s.state_name;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
  }
}
async function showSaveStateModal() {
  const { value: stateName } = await Swal.fire({
    title: "Save State Name",
    input: "text",
    inputLabel: "State name",
    showCancelButton: true
  });
  if (!stateName) return;
  try {
    const res = await apiFetch("/student/states", {
      method: "POST",
      body: JSON.stringify({ StateName: stateName })
    });
    await loadStates();
    Swal.fire("Saved", "", "success");
  } catch (err) {
    Swal.fire("Error", "Could not save state", "error");
  }
}

// ----------------- subjects helpers -----------------
function addSubjectRow() {
  appendSubjectRowValue("");
}
function appendSubjectRowValue(value) {
  const container = document.getElementById("subjectsContainer");
  const div = document.createElement("div");
  div.className = "d-flex mb-2";
  div.innerHTML = `
    <input class="form-control subject-name" value="${escapeHtmlAttr(value)}" placeholder="Subject name" />
    <button class="btn btn-danger ms-2 btn-remove-subject" type="button">Delete</button>
  `;
  container.appendChild(div);
  div.querySelector(".btn-remove-subject").addEventListener("click", () => div.remove());
}

// ----------------- small utils -----------------
function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (m)=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function escapeHtmlAttr(s) {
  return (s||"").replace(/"/g, "&quot;");
}
function escapeUrl(u) {
  if (!u) return "";
  // if u is absolute already, return as is
  if (u.startsWith("http")) return u;
  // build absolute using current host (preserve port)
  const base = location.origin.replace(/:\d+$/, ":" + location.port);
  // strip leading slashes
  return `${base}/${u.replace(/^\/+/, "")}`;
}

// Export page init functions for HTML to call
window.initLoginPage = initLoginPage;
window.initIndexPage = initIndexPage;
window.initCreatePage = initCreatePage;
window.initEditPage = initEditPage;
window.initViewPage = initViewPage;
window.logout = logout;
