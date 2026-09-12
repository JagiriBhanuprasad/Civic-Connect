(() => {
  const ADMIN_ID = "admin";
  const ADMIN_PASSWORD = "admin123";
  const SESSION_KEY = "civicAdminLoggedIn";
  const $ = id => document.getElementById(id);
  const loginView = $("loginView"), dashboardView = $("dashboardView");
  let issues = [];
  const objectUrlCache = new Map();

  function loadIssues(){
    try { issues = JSON.parse(localStorage.getItem("civicIssues")) || []; }
    catch { issues = []; }
  }
  function saveIssues(){ localStorage.setItem("civicIssues", JSON.stringify(issues)); }
  function escapeHTML(value){ const d=document.createElement("div"); d.textContent=value ?? ""; return d.innerHTML; }
  function statusClass(s){ return s === "Resolved" ? "resolved" : s === "In Progress" ? "progress" : "pending"; }

  function openPhotoDB(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB) return reject(new Error("IndexedDB unavailable"));
      const req=indexedDB.open("civicConnectPhotos",1);
      req.onupgradeneeded=()=>{ if(!req.result.objectStoreNames.contains("photos")) req.result.createObjectStore("photos",{keyPath:"id"}); };
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function getPhotoBlob(id){
    const db=await openPhotoDB();
    return new Promise((resolve,reject)=>{
      const req=db.transaction("photos","readonly").objectStore("photos").get(id);
      req.onsuccess=()=>resolve(req.result?.blob || null); req.onerror=()=>reject(req.error);
    });
  }
  async function photoUrl(id){
    if(objectUrlCache.has(id)) return objectUrlCache.get(id);
    try { const blob=await getPhotoBlob(id); if(!blob) return ""; const url=URL.createObjectURL(blob); objectUrlCache.set(id,url); return url; }
    catch { return ""; }
  }
  async function deletePhotos(issue){
    if(!issue?.photoIds?.length || !window.indexedDB) return;
    try {
      const db=await openPhotoDB();
      const tx=db.transaction("photos","readwrite"), store=tx.objectStore("photos");
      issue.photoIds.forEach(id=>store.delete(id));
      issue.photoIds.forEach(id=>{ const url=objectUrlCache.get(id); if(url){URL.revokeObjectURL(url);objectUrlCache.delete(id);} });
    } catch {}
  }

  function updateSummary(){
    $("adminTotal").textContent=issues.length;
    $("adminPending").textContent=issues.filter(x=>x.status==="Pending").length;
    $("adminProgress").textContent=issues.filter(x=>x.status==="In Progress").length;
    $("adminResolved").textContent=issues.filter(x=>x.status==="Resolved").length;
  }

  async function render(){
    loadIssues(); updateSummary();
    const box=$("adminReports");
    if(!issues.length){ box.innerHTML='<div class="empty"><h3>No reports yet</h3><p>Citizen submissions will appear here automatically.</p></div>'; return; }
    box.innerHTML=issues.map(issue=>{
      const photo=issue.photoIds?.[0] ? `<img class="report-photo" id="photo-${escapeHTML(issue.id)}" alt="Issue photo">` : '<div class="report-photo"></div>';
      return `<article class="report-card">
        ${photo}
        <div class="report-info">
          <h3>${escapeHTML(issue.title)}</h3>
          <div class="report-meta"><strong>Category:</strong> ${escapeHTML(issue.category)}<br><strong>Location:</strong> ${escapeHTML(issue.location)}<br><strong>Reported:</strong> ${escapeHTML(issue.date)}</div>
          <p class="report-desc">${escapeHTML(issue.description)}</p>
          <span class="status-pill ${statusClass(issue.status)}">${escapeHTML(issue.status)}</span>
        </div>
        <div class="report-actions">
          <select data-status-id="${escapeHTML(issue.id)}" aria-label="Change status for ${escapeHTML(issue.title)}">
            <option ${issue.status==='Pending'?'selected':''}>Pending</option>
            <option ${issue.status==='In Progress'?'selected':''}>In Progress</option>
            <option ${issue.status==='Resolved'?'selected':''}>Resolved</option>
          </select>
          ${issue.lat != null && issue.lng != null ? `<button type="button" data-map-id="${escapeHTML(issue.id)}">📍 Open Map</button>` : ''}
          <button type="button" class="delete" data-delete-id="${escapeHTML(issue.id)}">Delete Report</button>
        </div>
      </article>`;
    }).join("");
    await Promise.all(issues.map(async issue=>{
      if(!issue.photoIds?.[0]) return;
      const url=await photoUrl(issue.photoIds[0]); const img=$("photo-"+issue.id);
      if(img && url) img.src=url;
    }));
  }

  $("adminLoginForm").addEventListener("submit", e=>{
    e.preventDefault();
    if($("adminUsername").value.trim()===ADMIN_ID && $("adminPassword").value===ADMIN_PASSWORD){
      sessionStorage.setItem(SESSION_KEY,"1"); $("loginError").textContent=""; showDashboard();
    } else $("loginError").textContent="Invalid Admin ID or password.";
  });
  function showDashboard(){ loginView.classList.add("hidden"); dashboardView.classList.remove("hidden"); render(); }
  $("logoutBtn").addEventListener("click",()=>{sessionStorage.removeItem(SESSION_KEY);location.reload();});
  $("refreshBtn").addEventListener("click",render);
  $("adminReports").addEventListener("change",e=>{
    const id=e.target.dataset.statusId; if(!id) return;
    const issue=issues.find(x=>x.id===id); if(!issue) return;
    issue.status=e.target.value; saveIssues(); render();
  });
  $("adminReports").addEventListener("click",e=>{
    const mapId=e.target.dataset.mapId;
    if(mapId){ const issue=issues.find(x=>x.id===mapId); if(issue?.lat!=null) window.open(`https://www.google.com/maps?q=${encodeURIComponent(issue.lat+","+issue.lng)}`,"_blank"); return; }
    const deleteId=e.target.dataset.deleteId;
    if(deleteId){ const issue=issues.find(x=>x.id===deleteId); if(!issue) return; if(confirm(`Delete “${issue.title}”?`)){ issues=issues.filter(x=>x.id!==deleteId); saveIssues(); deletePhotos(issue); render(); } }
  });

  if(sessionStorage.getItem(SESSION_KEY)==="1") showDashboard();
})();
