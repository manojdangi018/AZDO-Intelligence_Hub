document.addEventListener("DOMContentLoaded", () => {
  const orgInput = document.getElementById("org-input");
  const endpointPreview = document.getElementById("endpoint-url");
  const btnConnect = document.getElementById("btn-connect");
  const btnBack = document.getElementById("btn-back");
  const loginScreen = document.getElementById("login-screen");
  const workspaceScreen = document.getElementById("workspace-screen");
  const darkToggle = document.getElementById("dark-mode-toggle");

  // Dynamic Endpoint URL update
  orgInput.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    endpointPreview.textContent = val 
      ? `https://dev.azure.com/${val}` 
      : "https://dev.azure.com/YourOrg";
  });

  // Switch from Login to Workspace
  btnConnect.addEventListener("click", () => {
    const org = orgInput.value.trim();
    const pat = document.getElementById("pat-input").value.trim();

    if (!org || !pat) {
      alert("Please provide both Organization and PAT.");
      return;
    }

    // Update Header State
    document.getElementById("bc-org").textContent = org;
    
    // Switch Screen
    loginScreen.classList.remove("active");
    workspaceScreen.classList.add("active");

    // Initialize module functions if present
    if (window.loadRepositories) window.loadRepositories(org, pat);
  });

  // Switch back to Login
  btnBack.addEventListener("click", () => {
    workspaceScreen.classList.remove("active");
    loginScreen.classList.add("active");
  });

  // Dark Mode Toggle
  darkToggle.addEventListener("click", () => {
    document.body.classList.toggle("dark-theme");
  });

  // Tab switching in workspace screen
  document.querySelectorAll(".nav-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      
      tab.classList.add("active");
      const target = document.getElementById(tab.dataset.target);
      if (target) target.classList.add("active");
    });
  });
});