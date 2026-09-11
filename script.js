// ==========================================
// CREATE ISSUE (Updated ID generation)
// ==========================================
const newIssue = {
    id: crypto.randomUUID(), // More robust than Date.now()
    title: title,
    category: category,
    location: location,
    description: description,
    status: "Pending",
    date: new Date().toLocaleDateString()
};

// ==========================================
// DISPLAY ISSUES (Updated to use data attributes)
// ==========================================
function displayIssues(filteredIssues = issues) {
    if (!issueContainer) return;

    issueContainer.innerHTML = "";

    if (filteredIssues.length === 0) {
        issueContainer.innerHTML = `
            <div class="no-issues">
                <p>No civic issues found.</p>
            </div>
        `;
        return;
    }

    filteredIssues.forEach(issue => {
        const issueCard = document.createElement("div");
        issueCard.className = "issue-card";

        // Note: Removed inline onclick, added data-id attributes
        issueCard.innerHTML = `
            <div class="issue-card-header">
                <h3>${escapeHTML(issue.title)}</h3>
                <span class="issue-status ${getStatusClass(issue.status)}">
                    ${issue.status}
                </span>
            </div>
            <p><strong>Category:</strong> ${escapeHTML(issue.category)}</p>
            <p><strong>Location:</strong> 📍 ${escapeHTML(issue.location)}</p>
            <p>${escapeHTML(issue.description)}</p>
            <p><strong>Reported:</strong> ${issue.date}</p>
            <div class="issue-actions">
                <button class="status-button" data-id="${issue.id}">Update Status</button>
                <button class="delete-button" data-id="${issue.id}">Delete</button>
            </div>
        `;

        issueContainer.appendChild(issueCard);
    });
}

// ==========================================
// EVENT DELEGATION (Add this in DOMContentLoaded)
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    displayIssues();
    updateStatistics();

    // Handle clicks on dynamically created buttons
    if (issueContainer) {
        issueContainer.addEventListener("click", (event) => {
            const target = event.target;
            const issueId = target.dataset.id;

            if (!issueId) return; // Clicked outside a button

            if (target.classList.contains("status-button")) {
                changeStatus(issueId);
            } else if (target.classList.contains("delete-button")) {
                deleteIssue(issueId);
            }
        });
    }
});

// ==========================================
// UPDATE CHANGE STATUS & DELETE TO ACCEPT STRING ID
// ==========================================
function changeStatus(id) {
    const issue = issues.find(issue => issue.id === id);
    if (!issue) return;

    if (issue.status === "Pending") issue.status = "In Progress";
    else if (issue.status === "In Progress") issue.status = "Resolved";
    else issue.status = "Pending";

    saveIssues();
    displayIssues();
    updateStatistics();
}

function deleteIssue(id) {
    const confirmation = confirm("Are you sure you want to delete this issue?");
    if (!confirmation) return;

    issues = issues.filter(issue => issue.id !== id);
    saveIssues();
    displayIssues();
    updateStatistics();
}