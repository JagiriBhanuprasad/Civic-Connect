// =========================================================
// CIVIC CONNECT — 10/10 PRODUCTION SCRIPT
// IndexedDB Blob storage + Geolocation + Responsive UX
// =========================================================

// ---------- INDEXEDDB PHOTO STORAGE ENGINE ----------
const DB_NAME = "CivicConnectDB";
const DB_VERSION = 1;
const PHOTO_STORE = "issuePhotos";

function openPhotoDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(PHOTO_STORE)) {
                db.createObjectStore(PHOTO_STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function savePhotosToDB(issueId, fileList) {
    if (!fileList || !fileList.length) return [];
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, "readwrite");
        const store = tx.objectStore(PHOTO_STORE);
        const photoIds = [];

        fileList.forEach((file, index) => {
            const id = `${issueId}_photo_${index}`;
            photoIds.push(id);
            store.put({ id, issueId, blob: file });
        });

        tx.oncomplete = () => resolve(photoIds);
        tx.onerror = () => reject(tx.error);
    });
}

async function getPhotoBlob(photoId) {
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, "readonly");
        const store = tx.objectStore(PHOTO_STORE);
        const req = store.get(photoId);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => reject(req.error);
    });
}

async function deletePhotosForIssue(issueId) {
    const db = await openPhotoDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(PHOTO_STORE, "readwrite");
        const store = tx.objectStore(PHOTO_STORE);
        const req = store.openCursor();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                if (cursor.value.issueId === issueId) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ---------- MAIN APPLICATION LOGIC ----------
document.addEventListener("DOMContentLoaded", () => {
    const $ = (id) => document.getElementById(id);

    const issueForm = $("issueForm");
    const issueContainer = $("issueContainer");
    const searchInput = $("searchInput");
    const filterCategory = $("filterCategory");
    const reportButton = $("reportButton");

    const totalIssuesEl = $("totalIssues");
    const pendingIssuesEl = $("pendingIssues");
    const resolvedIssuesEl = $("resolvedIssues");
    const toast = $("toast");

    const locationInput = $("issueLocation");
    const getLocationBtn = $("getLocationBtn");
    const locationStatus = $("locationStatus");
    const mapPreview = $("mapPreview");
    const gpsCapsule = $("gpsCapsule");
    const gpsCapsuleTitle = $("gpsCapsuleTitle");
    const gpsCapsuleText = $("gpsCapsuleText");

    const navMenu = $("navMenu");
    const navLinks = document.querySelector(".nav-links");

    const photoInput = $("issuePhotos");
    const photoPreview = $("photoPreview");
    const photoUploadBox = $("photoUploadBox");
    const photoLightbox = $("photoLightbox");
    const lightboxImage = $("lightboxImage");
    const lightboxClose = $("photoLightboxClose");

    const progressModal = $("progressModal");
    const progressClose = $("progressClose");
    const progressOverview = $("progressOverview");
    const myReports = $("myReports");
    const myReportCount = $("myReportCount");

    let issues = [];
    try {
        issues = JSON.parse(localStorage.getItem("civicIssues")) || [];
    } catch {
        issues = [];
    }

    let reporterId = localStorage.getItem("civicReporterId");
    if (!reporterId) {
        reporterId = generateId();
        localStorage.setItem("civicReporterId", reporterId);
    }

    let currentLat = null;
    let currentLng = null;
    let toastTimer = null;
    let selectedPhotos = [];
    const objectUrlCache = new Map();

    function generateId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }

    function saveIssues() {
        try {
            localStorage.setItem("civicIssues", JSON.stringify(issues));
        } catch {
            showToast("❌ Local storage is full. Please clear past reports.");
        }
    }

    function escapeHTML(value) {
        const div = document.createElement("div");
        div.textContent = value ?? "";
        return div.innerHTML;
    }

    function getStatusClass(status) {
        return {
            "Pending": "status-pending",
            "In Progress": "status-progress",
            "Resolved": "status-resolved"
        }[status] || "status-pending";
    }

    function getProgress(status) {
        if (status === "Resolved") return 100;
        if (status === "In Progress") return 50;
        return 10;
    }

    function showToast(message) {
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
    }

    function setGPSCapsule(title, text, active = false) {
        if (gpsCapsuleTitle) gpsCapsuleTitle.textContent = title;
        if (gpsCapsuleText) gpsCapsuleText.textContent = text;
        gpsCapsule?.classList.toggle("gps-active", active);
    }

    function googleMapsEmbedUrl(lat, lng, zoom = 16) {
        return `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`;
    }

    function googleMapsLink(lat, lng) {
        return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    }

    function setLocationStatus(message, type = "") {
        if (!locationStatus) return;
        locationStatus.textContent = message;
        locationStatus.className = "location-status" + (type ? ` ${type}` : "");
    }

    function showPreviewMap(lat, lng) {
        if (!mapPreview) return;
        mapPreview.innerHTML = `<iframe title="Location preview" src="${googleMapsEmbedUrl(lat, lng)}" loading="lazy" allowfullscreen></iframe>`;
        mapPreview.classList.remove("hidden");
    }

    function clearLocation() {
        currentLat = null;
        currentLng = null;
        if (mapPreview) {
            mapPreview.innerHTML = "";
            mapPreview.classList.add("hidden");
        }
    }

    // ---------- GPS & REVERSE GEOCODING ----------
    getLocationBtn?.addEventListener("click", () => {
        if (!("geolocation" in navigator)) {
            setLocationStatus("❌ Geolocation is not supported by your browser.", "error");
            setGPSCapsule("Location unavailable", "Your browser does not support GPS.");
            return;
        }
        if (!window.isSecureContext) {
            setLocationStatus("❌ GPS requires HTTPS or localhost.", "error");
            setGPSCapsule("Secure connection required", "GPS operates over HTTPS or localhost.");
            return;
        }

        getLocationBtn.disabled = true;
        setLocationStatus("📡 Locating coordinate positions…");
        setGPSCapsule("Locating…", "Fixing report spot...", true);

        navigator.geolocation.getCurrentPosition(
            async (position) => {
                currentLat = position.coords.latitude;
                currentLng = position.coords.longitude;
                const accuracy = Math.round(position.coords.accuracy || 0);

                setLocationStatus(`✅ Location captured: ${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`, "ok");
                setGPSCapsule("Location locked ✓", `Accurate to ~${accuracy}m`, true);
                showPreviewMap(currentLat, currentLng);

                try {
                    const ctrl = new AbortController();
                    const timeoutId = setTimeout(() => ctrl.abort(), 4000);
                    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${currentLat}&lon=${currentLng}`, {
                        signal: ctrl.signal
                    });
                    clearTimeout(timeoutId);
                    const data = await res.json();
                    if (data?.display_name) {
                        locationInput.value = data.display_name.split(",").slice(0, 3).join(",").trim();
                    }
                } catch {
                    if (!locationInput.value) {
                        locationInput.value = `${currentLat.toFixed(5)}, ${currentLng.toFixed(5)}`;
                    }
                }
                getLocationBtn.disabled = false;
            },
            (error) => {
                getLocationBtn.disabled = false;
                setGPSCapsule("Location not locked", "Please enter location manually.");
                const messages = {
                    1: "❌ Location permission denied.",
                    2: "❌ GPS location unavailable.",
                    3: "❌ Location request timed out."
                };
                setLocationStatus(messages[error.code] || "❌ Could not obtain location.", "error");
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
    });

    locationInput?.addEventListener("input", () => {
        if (currentLat !== null) {
            clearLocation();
            setLocationStatus("✏️ Manual entry detected; GPS pin cleared.");
        }
        setGPSCapsule("Pin your exact spot", "One tap finds your location and places the report there.");
    });

    // ---------- PHOTO UPLOADS & OBJECTURL HANDLING ----------
    function addPhotoFiles(fileList) {
        Array.from(fileList || []).forEach(file => {
            if (!file.type.startsWith("image/")) {
                showToast("❌ Image files only.");
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                showToast(`❌ ${file.name} exceeds 5 MB limit.`);
                return;
            }
            if (selectedPhotos.length >= 5) {
                showToast("❌ Maximum 5 photos allowed.");
                return;
            }
            selectedPhotos.push(file);
        });
        renderPhotoPreview();
    }

    function renderPhotoPreview() {
        if (!photoPreview) return;
        photoPreview.innerHTML = "";
        selectedPhotos.forEach((file, index) => {
            const previewUrl = URL.createObjectURL(file);
            const item = document.createElement("div");
            item.className = "photo-preview-item";
            item.innerHTML = `
                <img src="${previewUrl}" alt="Selected issue photo ${index + 1}">
                <button type="button" class="photo-remove-btn" data-photo-index="${index}" aria-label="Remove photo">✕</button>
            `;
            photoPreview.appendChild(item);
        });
    }

    photoInput?.addEventListener("change", event => {
        addPhotoFiles(event.target.files);
        photoInput.value = "";
    });

    photoUploadBox?.addEventListener("dragover", event => {
        event.preventDefault();
        photoUploadBox.classList.add("dragover");
    });
    photoUploadBox?.addEventListener("dragleave", () => photoUploadBox.classList.remove("dragover"));
    photoUploadBox?.addEventListener("drop", event => {
        event.preventDefault();
        photoUploadBox.classList.remove("dragover");
        addPhotoFiles(event.dataTransfer.files);
    });

    photoPreview?.addEventListener("click", event => {
        const button = event.target.closest(".photo-remove-btn");
        if (!button) return;
        const idx = Number(button.dataset.photoIndex);
        selectedPhotos.splice(idx, 1);
        renderPhotoPreview();
    });

    function closeLightbox() {
        photoLightbox?.classList.remove("active");
        photoLightbox?.setAttribute("aria-hidden", "true");
        if (lightboxImage) lightboxImage.src = "";
    }

    photoLightbox?.addEventListener("click", event => {
        if (event.target === photoLightbox) closeLightbox();
    });
    lightboxClose?.addEventListener("click", closeLightbox);

    // ---------- ISSUE DISPLAY & INDEXEDDB HYDRATION ----------
    function getFilteredIssues() {
        const term = (searchInput?.value || "").trim().toLowerCase();
        const category = filterCategory?.value || "All";
        return issues.filter(issue => {
            const matchesCategory = category === "All" || issue.category === category;
            const haystack = [issue.title, issue.location, issue.description, issue.category].join(" ").toLowerCase();
            return matchesCategory && haystack.includes(term);
        });
    }

    async function loadIssuePhotoUrl(photoId) {
        if (objectUrlCache.has(photoId)) return objectUrlCache.get(photoId);
        const blob = await getPhotoBlob(photoId);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        objectUrlCache.set(photoId, url);
        return url;
    }

    function displayIssues(filteredIssues = getFilteredIssues()) {
        if (!issueContainer) return;
        issueContainer.innerHTML = "";

        if (!filteredIssues.length) {
            issueContainer.innerHTML = issues.length === 0
                ? `<div class="no-issues"><p><strong>No issues reported yet.</strong></p><p>Be the first to report a civic issue.</p></div>`
                : `<div class="no-issues"><p>No civic issues match your search.</p></div>`;
            return;
        }

        filteredIssues.forEach((issue, index) => {
            const hasCoords = issue.lat != null && issue.lng != null;
            const photoIds = Array.isArray(issue.photoIds) ? issue.photoIds : [];

            const card = document.createElement("article");
            card.className = "issue-card";
            card.style.animationDelay = `${Math.min(index * 50, 400)}ms`;
            const progress = getProgress(issue.status);
            const mine = issue.reporterId === reporterId;

            const photoPlaceholder = photoIds.length ? `
                <div class="issue-card-image" id="photo-box-${issue.id}">
                    <div class="photo-loading-spinner"></div>
                    ${photoIds.length > 1 ? `<span class="issue-photo-count">📷 ${photoIds.length} photos</span>` : ""}
                </div>` : "";

            const mapBlock = hasCoords ? `
                <div class="issue-map-actions">
                    <a class="map-link" target="_blank" rel="noopener" href="${googleMapsLink(issue.lat, issue.lng)}">🗺️ Open in Google Maps</a>
                    <button type="button" class="map-toggle" data-id="${issue.id}">Show Map</button>
                </div>
                <div class="issue-map hidden" data-map-for="${issue.id}"></div>` : "";

            card.innerHTML = `
                ${photoPlaceholder}
                <div class="issue-card-header">
                    <h3>${escapeHTML(issue.title)}</h3>
                    <span class="issue-status ${getStatusClass(issue.status)}">${escapeHTML(issue.status)}</span>
                </div>
                ${mine ? `<span class="my-report-label">✓ Your report</span>` : ""}
                <p><strong>Category:</strong> ${escapeHTML(issue.category)}</p>
                <p><strong>Location:</strong> 📍 ${escapeHTML(issue.location)}</p>
                ${mapBlock}
                <p>${escapeHTML(issue.description)}</p>
                <div class="mini-progress" aria-label="Issue progress ${progress}%">
                    <div class="mini-progress-top"><strong>Work progress</strong><span>${progress}%</span></div>
                    <div class="mini-progress-track"><span style="width:${progress}%"></span></div>
                </div>
                <p><strong>Reported:</strong> ${escapeHTML(issue.date)}</p>
                <div class="issue-actions">
                    <button class="status-button" data-id="${issue.id}">Update Status</button>
                    <button class="delete-button" data-id="${issue.id}">Delete</button>
                </div>`;

            issueContainer.appendChild(card);

            if (photoIds.length) {
                loadIssuePhotoUrl(photoIds[0]).then(url => {
                    const box = document.getElementById(`photo-box-${issue.id}`);
                    if (box && url) {
                        box.innerHTML = `
                            <img class="issue-photo" src="${url}" alt="Attachment for ${escapeHTML(issue.title)}">
                            ${photoIds.length > 1 ? `<span class="issue-photo-count">📷 ${photoIds.length} photos</span>` : ""}
                        `;
                    }
                });
            }
        });
    }

    // ---------- STATISTICS ----------
    function updateStatistics() {
        const total = issues.length;
        const pending = issues.filter(issue => issue.status === "Pending").length;
        const progress = issues.filter(issue => issue.status === "In Progress").length;
        const resolved = issues.filter(issue => issue.status === "Resolved").length;
        if (totalIssuesEl) totalIssuesEl.textContent = total;
        if (pendingIssuesEl) pendingIssuesEl.textContent = pending + progress;
        if (resolvedIssuesEl) resolvedIssuesEl.textContent = resolved;
    }

    function getOverallPercent(list) {
        if (!list.length) return 0;
        return Math.round(list.reduce((sum, issue) => sum + getProgress(issue.status), 0) / list.length);
    }

    function openProgressTracker(filter = "all") {
        if (!progressModal) return;

        const visibleIssues = filter === "pending"
            ? issues.filter(issue => issue.status !== "Resolved")
            : filter === "resolved"
                ? issues.filter(issue => issue.status === "Resolved")
                : issues;

        const myIssues = issues.filter(issue => issue.reporterId === reporterId);
        const overall = getOverallPercent(visibleIssues);
        const inProgress = visibleIssues.filter(issue => issue.status === "In Progress").length;
        const pending = visibleIssues.filter(issue => issue.status === "Pending").length;
        const resolved = visibleIssues.filter(issue => issue.status === "Resolved").length;

        progressOverview.innerHTML = `
            <div class="progress-summary-main">
                <div class="progress-summary-circle" style="--progress:${overall * 3.6}deg"><strong>${overall}%</strong><span>overall</span></div>
                <div class="progress-summary-copy">
                    <strong>${filter === "all" ? "All civic work" : filter === "pending" ? "Open civic work" : "Resolved civic work"}</strong>
                    <p>${visibleIssues.length} report${visibleIssues.length === 1 ? "" : "s"} in this view</p>
                </div>
            </div>
            <div class="progress-metrics">
                <div><strong>${pending}</strong><span>Pending</span></div>
                <div><strong>${inProgress}</strong><span>In progress</span></div>
                <div><strong>${resolved}</strong><span>Resolved</span></div>
            </div>`;

        myReportCount.textContent = `${myIssues.length} report${myIssues.length === 1 ? "" : "s"}`;

        if (!myIssues.length) {
            myReports.innerHTML = `<div class="tracker-empty"><strong>No reports from you yet.</strong><span>Submit an issue and its progress will appear here.</span></div>`;
        } else {
            myReports.innerHTML = myIssues.map(issue => {
                const pct = getProgress(issue.status);
                return `
                    <article class="tracker-report">
                        <div class="tracker-report-top">
                            <div><strong>${escapeHTML(issue.title)}</strong><span>${escapeHTML(issue.category)} • ${escapeHTML(issue.location)}</span></div>
                            <span class="issue-status ${getStatusClass(issue.status)}">${escapeHTML(issue.status)}</span>
                        </div>
                        <div class="tracker-progress-row"><span>Report progress</span><strong>${pct}%</strong></div>
                        <div class="tracker-progress-track"><span style="width:${pct}%"></span></div>
                        <div class="tracker-steps">
                            <span class="done">✓ Reported</span>
                            <span class="${pct >= 50 ? "done" : ""}">● In Work</span>
                            <span class="${pct === 100 ? "done" : ""}">✓ Resolved</span>
                        </div>
                        <small>Submitted ${escapeHTML(issue.date)}${issue.lat != null ? " • GPS location attached" : ""}</small>
                    </article>`;
            }).join("");
        }

        progressModal.classList.add("active");
        progressModal.setAttribute("aria-hidden", "false");
        document.body.classList.add("progress-open");
    }

    function closeProgressTracker() {
        progressModal?.classList.remove("active");
        progressModal?.setAttribute("aria-hidden", "true");
        document.body.classList.remove("progress-open");
    }

    document.querySelectorAll(".stat-card").forEach(card => {
        card.addEventListener("click", () => openProgressTracker(card.dataset.statFilter || "all"));
    });
    progressClose?.addEventListener("click", closeProgressTracker);
    progressModal?.addEventListener("click", event => {
        if (event.target.matches("[data-close-progress]")) closeProgressTracker();
    });

    // ---------- CREATE ISSUE ----------
    issueForm?.addEventListener("submit", async event => {
        event.preventDefault();

        const title = $("issueTitle").value.trim();
        const category = $("issueCategory").value;
        const location = locationInput.value.trim();
        const description = $("issueDescription").value.trim();
        if (!title || !category || !location || !description) return;

        const issueId = generateId();
        let photoIds = [];

        try {
            if (selectedPhotos.length > 0) {
                photoIds = await savePhotosToDB(issueId, selectedPhotos);
            }
        } catch {
            showToast("❌ Could not save attachments to offline database.");
            return;
        }

        const newIssue = {
            id: issueId,
            reporterId,
            title,
            category,
            location,
            lat: currentLat,
            lng: currentLng,
            description,
            photoIds,
            status: "Pending",
            date: new Date().toLocaleDateString()
        };

        issues.unshift(newIssue);
        saveIssues();
        displayIssues();
        updateStatistics();

        issueForm.reset();
        selectedPhotos = [];
        renderPhotoPreview();
        clearLocation();
        setLocationStatus("");
        setGPSCapsule("Pin your exact spot", "One tap finds your location and places the report there.");

        showToast("✅ Issue reported successfully!");
        document.getElementById("issues")?.scrollIntoView({ behavior: "smooth" });
    });

    function changeStatus(id) {
        const issue = issues.find(item => item.id === id);
        if (!issue) return;

        if (issue.status === "Pending") issue.status = "In Progress";
        else if (issue.status === "In Progress") issue.status = "Resolved";
        else issue.status = "Pending";

        saveIssues();
        displayIssues();
        updateStatistics();
    }

    function deleteIssue(id) {
        if (!confirm("Are you sure you want to delete this issue?")) return;

        const deleted = issues.find(issue => issue.id === id);
        issues = issues.filter(issue => issue.id !== id);
        saveIssues();
        if (deleted?.photoIds?.length) {
            deletePhotosForIssue(id).catch(() => {});
            deleted.photoIds.forEach(photoId => {
                const cached = objectUrlCache.get(photoId);
                if (cached) { URL.revokeObjectURL(cached); objectUrlCache.delete(photoId); }
            });
        }
        displayIssues();
        updateStatistics();
    }

    // ---------- EVENT DELEGATION ----------
    issueContainer.addEventListener("click", event => {
        const target = event.target;
        if (target.classList.contains("issue-photo")) {
            if (photoLightbox && lightboxImage) { lightboxImage.src=target.dataset.photo||target.src; photoLightbox.classList.add("active"); photoLightbox.setAttribute("aria-hidden","false"); }
            return;
        }
        const issueId = target.dataset.id;

        if (!issueId) return;

        if (target.classList.contains("map-toggle")) {
            const mapBox =
                issueContainer.querySelector(`[data-map-for="${issueId}"]`);

            if (!mapBox) return;

            if (mapBox.classList.contains("hidden")) {
                const issue = issues.find(item => item.id === issueId);

                if (issue && issue.lat != null && mapBox.innerHTML === "") {
                    mapBox.innerHTML = `
                        <iframe
                            title="Issue location map"
                            src="${googleMapsEmbedUrl(issue.lat, issue.lng)}"
                            loading="lazy"
                            allowfullscreen>
                        </iframe>`;
                }

                mapBox.classList.remove("hidden");
                target.textContent = "Hide Map";
            } else {
                mapBox.classList.add("hidden");
                target.textContent = "Show Map";
            }

            return;
        }

        if (target.classList.contains("status-button")) {
            changeStatus(issueId);
        } else if (target.classList.contains("delete-button")) {
            deleteIssue(issueId);
        }
    });

    searchInput.addEventListener("input", () => displayIssues());
    filterCategory.addEventListener("change", () => displayIssues());

    // ---------- HERO / NAVIGATION ----------
    reportButton.addEventListener("click", () => {
        document.getElementById("report").scrollIntoView({ behavior: "smooth" });
    });

    navMenu.addEventListener("click", () => {
        const open = navLinks.classList.toggle("open");
        navMenu.setAttribute("aria-expanded", String(open));
    });

    navLinks.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", () => {
            navLinks.classList.remove("open");
            navMenu.setAttribute("aria-expanded", "false");
        });
    });

    // Highlight navigation based on current section.
    const sections = [...document.querySelectorAll("main section[id]")];
    const navAnchors = [...document.querySelectorAll(".nav-links a")];

    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (!entry.isIntersecting) return;

            navAnchors.forEach(anchor => {
                anchor.classList.toggle(
                    "active",
                    anchor.getAttribute("href") === `#${entry.target.id}`
                );
            });
        });
    }, { threshold: 0.35 });

    sections.forEach(section => observer.observe(section));

    // ---------- INIT ----------
    displayIssues();
    updateStatistics();
});
