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

    // ---------- GPS & LOCATION FALLBACK ----------
    // We try the device's real GPS first. If the browser blocks GPS (common when
    // opening index.html directly), automatically fall back to an IP-based
    // approximate location so the demo can still place the report on the map.
    async function reverseGeocode(lat, lng) {
        try {
            const ctrl = new AbortController();
            const timeoutId = setTimeout(() => ctrl.abort(), 4500);
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, {
                signal: ctrl.signal,
                headers: { "Accept": "application/json" }
            });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error("Reverse geocoding failed");
            const data = await res.json();
            return data?.display_name ? data.display_name.split(",").slice(0, 3).join(", ").trim() : "";
        } catch {
            return "";
        }
    }

    async function getApproximateIPLocation() {
        const endpoints = [
            "https://ipapi.co/json/",
            "https://ipwho.is/"
        ];

        for (const endpoint of endpoints) {
            try {
                const ctrl = new AbortController();
                const timeoutId = setTimeout(() => ctrl.abort(), 5000);
                const res = await fetch(endpoint, {
                    signal: ctrl.signal,
                    headers: { "Accept": "application/json" }
                });
                clearTimeout(timeoutId);
                if (!res.ok) continue;
                const data = await res.json();
                const lat = Number(data.latitude ?? data.lat);
                const lng = Number(data.longitude ?? data.lon);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

                const parts = [
                    data.city,
                    data.region ?? data.region_name,
                    data.country_name ?? data.country
                ].filter(Boolean);

                return {
                    lat,
                    lng,
                    label: parts.slice(0, 3).join(", ") || `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                };
            } catch {
                // Try the next location service.
            }
        }
        return null;
    }

    async function applyLocation(lat, lng, accuracy, approximate = false, fallbackLabel = "") {
        currentLat = lat;
        currentLng = lng;
        const accuracyText = accuracy ? `Accurate to ~${Math.round(accuracy)}m` : "Approximate area from internet";

        showPreviewMap(lat, lng);
        setGPSCapsule(
            approximate ? "Approximate location ✓" : "Location locked ✓",
            accuracyText,
            true
        );

        const address = await reverseGeocode(lat, lng);
        if (address) {
            locationInput.value = address;
        } else if (fallbackLabel) {
            locationInput.value = fallbackLabel;
        } else if (!locationInput.value) {
            locationInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }

    async function tryApproximateLocation(reason = "") {
        setLocationStatus("🌐 GPS unavailable — finding your approximate current area…");
        setGPSCapsule("Finding approximate location…", "Using your internet connection to locate the city/area.", true);

        const fallback = await getApproximateIPLocation();
        if (fallback) {
            await applyLocation(fallback.lat, fallback.lng, null, true, fallback.label);
            setLocationStatus(
                `✅ Approximate location found: ${fallback.label}. For exact GPS, allow location access and use this button again.`,
                "ok"
            );
            return true;
        }

        setGPSCapsule("Location not locked", "Please allow browser location access or enter the location manually.");
        setLocationStatus(
            reason || "❌ Could not get your current location. Please allow location access and try again.",
            "error"
        );
        return false;
    }

    getLocationBtn?.addEventListener("click", () => {
        getLocationBtn.disabled = true;
        setLocationStatus("📡 Locating your current position…");
        setGPSCapsule("Locating…", "Trying your device GPS first.", true);

        if (!("geolocation" in navigator)) {
            tryApproximateLocation("❌ Device GPS is not supported. Trying approximate location instead.")
                .finally(() => { getLocationBtn.disabled = false; });
            return;
        }

        // Do NOT block file:// pages here. Many hackathon demos are opened directly
        // from a folder, where browser GPS can fail even though the browser supports it.
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy || 0;

                await applyLocation(lat, lng, accuracy, false);
                setLocationStatus(`✅ Exact location captured: ${lat.toFixed(5)}, ${lng.toFixed(5)}`, "ok");
                getLocationBtn.disabled = false;
            },
            async (error) => {
                const messages = {
                    1: "⚠️ GPS permission was denied. Trying your approximate current area instead…",
                    2: "⚠️ GPS position is unavailable. Trying your approximate current area instead…",
                    3: "⚠️ GPS request timed out. Trying your approximate current area instead…"
                };
                await tryApproximateLocation(messages[error.code]);
                getLocationBtn.disabled = false;
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 30000
            }
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

/* ================= CIVIC AI ASSISTANT ================= */
document.addEventListener("DOMContentLoaded", () => {
    const aiButton = document.getElementById("civicAiButton");
    const aiPanel = document.getElementById("civicAiPanel");
    const aiClose = document.getElementById("civicAiClose");
    const aiForm = document.getElementById("civicAiForm");
    const aiInput = document.getElementById("civicAiInput");
    const aiMessages = document.getElementById("civicAiMessages");
    const languageSelect = document.getElementById("languageSelect");

    if (!aiButton || !aiPanel || !aiForm || !aiInput || !aiMessages) return;

    const addMessage = (text, type) => {
        const message = document.createElement("div");
        message.className = `civic-ai-message ${type}`;
        message.textContent = text;
        aiMessages.appendChild(message);
        aiMessages.scrollTop = aiMessages.scrollHeight;
    };

    const detectIntent = (question) => {
        const q = question.toLowerCase();
        const patterns = {
            report: ["report", "problem", "issue", "समस्या", "रिपोर्ट", "ఫిర్యాదు", "సమస్య", "புகார்", "பிரச்சனை", "तक्रार", "অভিযোগ", "সমস্যা"],
            gps: ["gps", "location", "map", "लोकेशन", "स्थान", "స్థానం", "లొకేషన్", "இடம்", "வரைபடம்", "नकाशा", "অবস্থান", "মানচিত্র"],
            photo: ["photo", "image", "picture", "फोटो", "तस्वीर", "ఫోటో", "చిత్రం", "புகைப்படம்", "படம்", "छायाचित्र", "ছবি"],
            track: ["track", "status", "progress", "स्थिति", "प्रगति", "ట్రాక్", "స్థితి", "முன்னேற்றம்", "நிலை", "स्थिती", "प्रगती", "অবস্থা", "অগ্রগতি"],
            language: ["language", "भाषा", "भाषे", "భాష", "மொழி", "ভাষা"],
            hello: ["hello", "hi", "hey", "नमस्ते", "हाय", "హలో", "నమస్కారం", "வணக்கம்", "हॅलो", "नमस्कार", "হ্যালো", "নমস্কার"]
        };
        for (const [intent, words] of Object.entries(patterns)) {
            if (words.some(word => q.includes(word))) return intent;
        }
        return "general";
    };

    const answers = {
        en: {
            report: "Go to Report a Problem, enter the title, category, location and description, then submit it.",
            gps: "Use the Use My Location button to get your location. You can also enter a location manually and open the map.",
            photo: "You can add photos in the optional photo upload area. Photos help explain the civic problem clearly.",
            track: "Open Statistics and the progress tracker to see pending, in-progress and resolved reports.",
            language: "Use the language selector to switch between English, Hindi, Telugu, Tamil, Marathi and Bengali.",
            hello: "Hi! I am Civic AI. Ask me about reporting a problem, GPS, photos, languages or tracking.",
            general: "I can help with reporting problems, GPS/location, photos, languages and report progress."
        },
        hi: {
            report: "Report a Problem पर जाएँ, शीर्षक, श्रेणी, स्थान और विवरण भरें, फिर समस्या सबमिट करें।",
            gps: "अपना स्थान पाने के लिए Use My Location दबाएँ। आप स्थान मैन्युअल रूप से भी दर्ज कर सकते हैं।",
            photo: "आप वैकल्पिक फोटो अपलोड क्षेत्र में तस्वीरें जोड़ सकते हैं। तस्वीरें समस्या को समझाने में मदद करती हैं।",
            track: "लंबित, कार्यरत और हल की गई रिपोर्ट देखने के लिए Statistics और Progress Tracker खोलें।",
            language: "भाषा चयन से English, Hindi, Telugu, Tamil, Marathi और Bengali में बदल सकते हैं।",
            hello: "नमस्ते! मैं Civic AI हूँ। आप रिपोर्ट, GPS, फोटो, भाषा या प्रगति के बारे में पूछ सकते हैं।",
            general: "मैं रिपोर्ट, GPS/स्थान, फोटो, भाषाओं और रिपोर्ट की प्रगति में मदद कर सकता हूँ।"
        },
        te: {
            report: "Report a Problem కు వెళ్లి శీర్షిక, వర్గం, స్థానం మరియు వివరణ నమోదు చేసి సమస్యను పంపండి.",
            gps: "మీ స్థానం కోసం Use My Location బటన్‌ను నొక్కండి. మీరు స్థానాన్ని మాన్యువల్‌గా కూడా నమోదు చేయవచ్చు.",
            photo: "ఐచ్చిక ఫోటో అప్‌లోడ్ ప్రాంతంలో ఫోటోలను జోడించవచ్చు. అవి సమస్యను స్పష్టంగా చూపించడంలో సహాయపడతాయి.",
            track: "పెండింగ్, ప్రోగ్రెస్‌లో మరియు పరిష్కరించిన రిపోర్ట్‌లను చూడటానికి Statistics మరియు Progress Tracker తెరవండి.",
            language: "Language selector ద్వారా English, Hindi, Telugu, Tamil, Marathi మరియు Bengali ఎంచుకోవచ్చు.",
            hello: "నమస్కారం! నేను Civic AI. రిపోర్ట్, GPS, ఫోటోలు, భాషలు లేదా ప్రోగ్రెస్ గురించి అడగండి.",
            general: "రిపోర్టులు, GPS/స్థానం, ఫోటోలు, భాషలు మరియు రిపోర్ట్ ప్రోగ్రెస్ గురించి నేను సహాయం చేయగలను."
        },
        ta: {
            report: "Report a Problem பகுதிக்குச் சென்று தலைப்பு, வகை, இடம் மற்றும் விவரத்தை உள்ளிட்டு சமர்ப்பிக்கவும்.",
            gps: "உங்கள் இருப்பிடத்தைப் பெற Use My Location பொத்தானை அழுத்துங்கள். இடத்தை கைமுறையாகவும் உள்ளிடலாம்.",
            photo: "விருப்ப புகைப்படப் பதிவேற்ற பகுதியில் புகைப்படங்களைச் சேர்க்கலாம். அவை பிரச்சனையை தெளிவாக காட்ட உதவும்.",
            track: "நிலுவையில், செயல்பாட்டில் மற்றும் தீர்க்கப்பட்ட புகார்களைப் பார்க்க Statistics மற்றும் Progress Tracker திறக்கவும்.",
            language: "Language selector மூலம் English, Hindi, Telugu, Tamil, Marathi மற்றும் Bengali தேர்வு செய்யலாம்.",
            hello: "வணக்கம்! நான் Civic AI. புகார், GPS, புகைப்படங்கள், மொழிகள் அல்லது முன்னேற்றம் பற்றி கேளுங்கள்.",
            general: "புகார்கள், GPS/இடம், புகைப்படங்கள், மொழிகள் மற்றும் புகார் முன்னேற்றம் குறித்து உதவ முடியும்."
        },
        mr: {
            report: "Report a Problem मध्ये जाऊन शीर्षक, श्रेणी, स्थान आणि वर्णन भरा आणि समस्या सबमिट करा.",
            gps: "तुमचे स्थान मिळवण्यासाठी Use My Location दाबा. तुम्ही स्थान स्वतःही टाइप करू शकता.",
            photo: "पर्यायी फोटो अपलोड विभागात फोटो जोडू शकता. फोटो समस्येचे स्पष्टीकरण देण्यास मदत करतात.",
            track: "प्रलंबित, प्रगतीपथावर आणि निराकरण झालेल्या तक्रारी पाहण्यासाठी Statistics आणि Progress Tracker उघडा.",
            language: "Language selector मधून English, Hindi, Telugu, Tamil, Marathi आणि Bengali निवडू शकता.",
            hello: "नमस्कार! मी Civic AI आहे. रिपोर्ट, GPS, फोटो, भाषा किंवा प्रगतीबद्दल विचारा.",
            general: "मी रिपोर्ट, GPS/स्थान, फोटो, भाषा आणि रिपोर्टच्या प्रगतीबद्दल मदत करू शकतो."
        },
        bn: {
            report: "Report a Problem-এ যান, শিরোনাম, বিভাগ, অবস্থান ও বিবরণ দিন, তারপর সমস্যা জমা দিন।",
            gps: "আপনার অবস্থান পেতে Use My Location চাপুন। আপনি অবস্থান নিজেও লিখতে পারেন।",
            photo: "ঐচ্ছিক ছবি আপলোড অংশে ছবি যোগ করতে পারেন। ছবি সমস্যাটি পরিষ্কারভাবে বোঝাতে সাহায্য করে।",
            track: "অপেক্ষমাণ, চলমান এবং সমাধান হওয়া রিপোর্ট দেখতে Statistics ও Progress Tracker খুলুন।",
            language: "Language selector থেকে English, Hindi, Telugu, Tamil, Marathi এবং Bengali বেছে নিতে পারেন।",
            hello: "নমস্কার! আমি Civic AI। রিপোর্ট, GPS, ছবি, ভাষা বা অগ্রগতি সম্পর্কে জিজ্ঞাসা করুন।",
            general: "আমি রিপোর্ট, GPS/অবস্থান, ছবি, ভাষা এবং রিপোর্টের অগ্রগতি সম্পর্কে সাহায্য করতে পারি।"
        }
    };

    const getAnswer = (question) => {
        const lang = languageSelect?.value || localStorage.getItem("civicConnectLanguage") || "en";
        const pack = answers[lang] || answers.en;
        return pack[detectIntent(question)] || pack.general;
    };

    const openAi = () => {
        aiPanel.hidden = false;
        aiButton.setAttribute("aria-expanded", "true");
        window.setTimeout(() => aiInput.focus(), 50);
    };
    const closeAi = () => {
        aiPanel.hidden = true;
        aiButton.setAttribute("aria-expanded", "false");
    };

    aiButton.addEventListener("click", (event) => {
        event.stopPropagation();
        openAi();
    });

    aiClose?.addEventListener("click", (event) => {
        event.stopPropagation();
        closeAi();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !aiPanel.hidden) closeAi();
    });

    aiPanel.addEventListener("click", event => event.stopPropagation());

    aiForm.addEventListener("submit", event => {
        event.preventDefault();
        const question = aiInput.value.trim();
        if (!question) return;
        addMessage(question, "user");
        aiInput.value = "";
        window.setTimeout(() => addMessage(getAnswer(question), "bot"), 220);
    });

    document.querySelectorAll("[data-ai-question]").forEach(button => {
        button.addEventListener("click", () => {
            const question = button.dataset.aiQuestion;
            addMessage(question, "user");
            window.setTimeout(() => addMessage(getAnswer(question), "bot"), 220);
        });
    });
});

/* ================= COMMUNITY DONATION PAYMENT =================
   Add Civic Connect's real receiving UPI ID before deployment.
*/
const CIVIC_DONATION_UPI_ID = "YOUR_UPI_ID@upi";

window.addEventListener("DOMContentLoaded", () => {
    const donationCard = document.getElementById("donationCard");
    const donationModal = document.getElementById("donationModal");
    const donationClose = document.getElementById("donationClose");
    const donationAmount = document.getElementById("donationAmount");
    const donationPay = document.getElementById("donationPay");
    const amountButtons = document.querySelectorAll("[data-donation-amount]");
    const paymentMethods = document.querySelectorAll("[data-pay-method]");
    if (!donationCard || !donationModal || !donationAmount || !donationPay) return;

    let selectedPayment = "gpay";

    const syncAmount = () => {
        const amount = Math.max(1, Math.floor(Number(donationAmount.value) || 10));
        donationAmount.value = amount;
        donationPay.innerHTML = `Pay ₹${amount} securely <span>→</span>`;
        amountButtons.forEach(btn => btn.classList.toggle("selected", Number(btn.dataset.donationAmount) === amount));
    };

    const openDonation = () => {
        donationModal.setAttribute("aria-hidden", "false");
        syncAmount();
        setTimeout(() => donationAmount.focus(), 80);
    };
    const closeDonation = () => donationModal.setAttribute("aria-hidden", "true");

    donationCard.addEventListener("click", openDonation);
    donationClose?.addEventListener("click", closeDonation);
    donationModal.querySelector("[data-close-donation]")?.addEventListener("click", closeDonation);
    donationAmount.addEventListener("input", syncAmount);
    amountButtons.forEach(btn => btn.addEventListener("click", () => {
        donationAmount.value = btn.dataset.donationAmount;
        syncAmount();
    }));

    paymentMethods.forEach(btn => btn.addEventListener("click", () => {
        selectedPayment = btn.dataset.payMethod || "other";
        paymentMethods.forEach(item => item.classList.toggle("selected", item === btn));
    }));

    donationPay.addEventListener("click", () => {
        const amount = Math.max(1, Math.floor(Number(donationAmount.value) || 10));
        if (CIVIC_DONATION_UPI_ID.includes("YOUR_UPI_ID")) {
            alert("Set the Civic Connect recipient UPI ID in script.js first (CIVIC_DONATION_UPI_ID). Then users can pay from their UPI/bank app.");
            return;
        }

        const params = new URLSearchParams({
            pa: CIVIC_DONATION_UPI_ID,
            pn: "Civic Connect",
            am: amount.toFixed(2),
            cu: "INR",
            tn: "Civic Connect community support"
        });
        const upiUrl = `upi://pay?${params.toString()}`;
        const appUrls = {
            gpay: `tez://upi/pay?${params.toString()}`,
            phonepe: `phonepe://pay?${params.toString()}`,
            paytm: `paytmmp://pay?${params.toString()}`,
            bhim: `bhim://upi/pay?${params.toString()}`
        };

        if (appUrls[selectedPayment]) {
            window.location.href = appUrls[selectedPayment];
            setTimeout(() => { window.location.href = upiUrl; }, 900);
        } else {
            window.location.href = upiUrl;
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && donationModal.getAttribute("aria-hidden") === "false") closeDonation();
    });
    syncAmount();
});
