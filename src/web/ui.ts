export function getWebUIHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Project Manager - Projects & Activity Feed</title>
  <style>
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --border: #30363d;
      --text: #c9d1d9;
      --text-muted: #8b949e;
      --heading: #f0f6fc;
      --accent: #58a6ff;
      --accent-hover: #79c0ff;
      --success: #3fb950;
      --warning: #d29922;
      --danger: #f85149;
      --purple: #bc8cff;
      --cyan: #39c5cf;
      --radius: 8px;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 0;
      margin: 0;
      min-height: 100vh;
    }

    header {
      background-color: var(--card-bg);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 1rem 1.5rem;
    }

    .header-container {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, var(--accent), var(--purple));
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: bold;
      font-size: 1.1rem;
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--heading);
    }

    .stats-bar {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .stat-pill {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 0.25rem 0.75rem;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .stat-val {
      font-weight: 600;
      color: var(--heading);
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
      width: 100%;
      max-width: 1200px;
      margin: 1rem auto 0 auto;
      padding: 0 1.5rem;
    }

    .search-box {
      flex: 1;
      min-width: 240px;
      position: relative;
    }

    .search-input {
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.5rem 0.75rem 0.5rem 2.25rem;
      border-radius: var(--radius);
      font-size: 0.9rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent);
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
      font-size: 0.85rem;
    }

    .nav-tabs {
      display: flex;
      gap: 0.5rem;
      background: var(--card-bg);
      padding: 0.25rem;
      border-radius: var(--radius);
      border: 1px solid var(--border);
    }

    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.4rem 1rem;
      font-size: 0.875rem;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .tab-btn:hover {
      color: var(--heading);
    }

    .tab-btn.active {
      background: var(--accent);
      color: #ffffff;
    }

    .btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.45rem 0.85rem;
      border-radius: var(--radius);
      font-size: 0.875rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.2s;
    }

    .btn:hover {
      border-color: var(--text-muted);
      color: var(--heading);
    }

    .btn-sm {
      padding: 0.3rem 0.6rem;
      font-size: 0.8rem;
    }

    .btn-primary {
      background: var(--accent);
      color: #ffffff;
      border-color: var(--accent);
      margin-top: 0.75rem;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
      color: #ffffff;
    }

    main {
      max-width: 1200px;
      margin: 1.5rem auto;
      padding: 0 1.5rem;
    }

    .view-panel {
      display: none;
    }

    .view-panel.active {
      display: block;
    }

    /* Activity Feed Toolbar & Grouping Toggle */
    .activity-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 0.75rem 1rem;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
    }

    .date-picker-wrapper {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 0.9rem;
      color: var(--heading);
      font-weight: 500;
      flex-wrap: wrap;
    }

    .date-input {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--heading);
      padding: 0.35rem 0.65rem;
      border-radius: 6px;
      font-size: 0.875rem;
      outline: none;
      font-family: inherit;
    }

    .date-input:focus {
      border-color: var(--accent);
    }

    .view-mode-toggle {
      display: flex;
      gap: 0.25rem;
      background: var(--bg);
      padding: 0.2rem;
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    .mode-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.3rem 0.75rem;
      font-size: 0.8rem;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .mode-btn:hover {
      color: var(--heading);
    }

    .mode-btn.active {
      background: var(--accent);
      color: #ffffff;
      font-weight: 600;
    }

    /* Project Grouping Container */
    .project-group-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
      margin-bottom: 1.25rem;
    }

    .project-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
      margin-bottom: 1rem;
    }

    .project-group-title {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--heading);
    }

    .project-group-count {
      font-size: 0.8rem;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.06);
      padding: 0.15rem 0.55rem;
      border-radius: 12px;
    }

    /* Projects Grid */
    .projects-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.25rem;
    }

    .project-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: transform 0.15s, border-color 0.15s;
    }

    .project-card:hover {
      border-color: var(--text-muted);
      transform: translateY(-2px);
    }

    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .project-title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--heading);
    }

    .project-slug {
      font-size: 0.8rem;
      color: var(--text-muted);
      font-family: monospace;
    }

    .status-badge {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      padding: 0.2rem 0.55rem;
      border-radius: 12px;
      display: inline-block;
      white-space: nowrap;
    }

    .status-active { background: rgba(63, 185, 80, 0.15); color: var(--success); border: 1px solid rgba(63, 185, 80, 0.3); }
    .status-planned { background: rgba(88, 166, 255, 0.15); color: var(--accent); border: 1px solid rgba(88, 166, 255, 0.3); }
    .status-idea { background: rgba(188, 140, 255, 0.15); color: var(--purple); border: 1px solid rgba(188, 140, 255, 0.3); }
    .status-blocked { background: rgba(248, 81, 73, 0.15); color: var(--danger); border: 1px solid rgba(248, 81, 73, 0.3); }
    .status-paused { background: rgba(210, 153, 34, 0.15); color: var(--warning); border: 1px solid rgba(210, 153, 34, 0.3); }
    .status-completed { background: rgba(57, 197, 207, 0.15); color: var(--cyan); border: 1px solid rgba(57, 197, 207, 0.3); }
    .status-archived { background: rgba(139, 148, 158, 0.15); color: var(--text-muted); border: 1px solid rgba(139, 148, 158, 0.3); }

    .card-body {
      margin-bottom: 1rem;
      font-size: 0.9rem;
    }

    .card-description {
      color: var(--text);
      margin-bottom: 0.5rem;
    }

    .card-notes {
      color: var(--text-muted);
      font-size: 0.85rem;
      font-style: italic;
      border-left: 2px solid var(--border);
      padding-left: 0.5rem;
      margin-top: 0.5rem;
    }

    .latest-summary {
      background: rgba(0, 0, 0, 0.2);
      padding: 0.6rem;
      border-radius: 6px;
      margin-top: 0.75rem;
      font-size: 0.85rem;
    }

    .latest-summary-title {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 0.25rem;
    }

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--text-muted);
      border-top: 1px solid var(--border);
      padding-top: 0.75rem;
      margin-top: auto;
    }

    .link-btn {
      color: var(--accent);
      text-decoration: none;
      cursor: pointer;
      font-weight: 500;
    }

    .link-btn:hover {
      text-decoration: underline;
    }

    /* Timeline View */
    .timeline {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      position: relative;
    }

    .timeline-item {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem;
      position: relative;
    }

    .timeline-header {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .timeline-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .project-tag {
      background: rgba(88, 166, 255, 0.1);
      color: var(--accent);
      border: 1px solid rgba(88, 166, 255, 0.2);
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .time-stamp {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .source-badge {
      font-size: 0.75rem;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.05);
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
    }

    .entry-summary {
      font-size: 1rem;
      font-weight: 500;
      color: var(--heading);
      margin-bottom: 0.5rem;
    }

    .entry-progress {
      font-size: 0.9rem;
      color: var(--text);
      margin-bottom: 0.75rem;
    }

    .section-box {
      margin-top: 0.5rem;
      font-size: 0.875rem;
    }

    .section-title {
      font-weight: 600;
      font-size: 0.8rem;
      text-transform: uppercase;
      margin-bottom: 0.25rem;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .section-title.blockers { color: var(--danger); }
    .section-title.next-steps { color: var(--accent); }
    .section-title.decisions { color: var(--purple); }

    .bullet-list {
      list-style: disc inside;
      color: var(--text);
      padding-left: 0.25rem;
    }

    .bullet-list li {
      margin-bottom: 0.2rem;
    }

    .tags-container {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.75rem;
    }

    .pill-tag {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.75rem;
      padding: 0.1rem 0.45rem;
      border-radius: 12px;
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-muted);
    }

    .empty-state h3 {
      color: var(--heading);
      margin-bottom: 0.5rem;
    }

    .filter-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .filter-chip {
      background: rgba(88, 166, 255, 0.15);
      color: var(--accent);
      padding: 0.2rem 0.6rem;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
    }

    .filter-chip button {
      background: none;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-weight: bold;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-container">
      <div class="brand">
        <div class="logo-icon">PM</div>
        <div>
          <h1>Project Manager</h1>
        </div>
      </div>
      <div class="stats-bar" id="statsBar">
        <div class="stat-pill">Projects: <span class="stat-val" id="statProjects">-</span></div>
        <div class="stat-pill">Active: <span class="stat-val" id="statActive">-</span></div>
        <div class="stat-pill">Updates: <span class="stat-val" id="statUpdates">-</span></div>
      </div>
    </div>
  </header>

  <div class="controls">
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input type="text" id="searchInput" class="search-input" placeholder="Search projects, status, or activity..." />
    </div>
    <div class="nav-tabs">
      <button class="tab-btn active" id="tabProjects" onclick="switchTab('projects')">Projects</button>
      <button class="tab-btn" id="tabActivity" onclick="switchTab('activity')">Activity Feed</button>
    </div>
    <button class="btn" onclick="fetchData()">🔄 Refresh</button>
  </div>

  <main>
    <div id="filterBarContainer" class="filter-bar" style="display: none;">
      Filtering by project: <span id="activeFilterChip" class="filter-chip"></span>
    </div>

    <!-- Projects View -->
    <div id="viewProjects" class="view-panel active">
      <div id="projectsContainer" class="projects-grid"></div>
    </div>

    <!-- Activity Feed View -->
    <div id="viewActivity" class="view-panel">
      <div class="activity-toolbar">
        <div class="date-picker-wrapper">
          <label for="activityDateInput">📅 Date:</label>
          <input type="date" id="activityDateInput" class="date-input" onchange="render()" />
          <button class="btn btn-sm" onclick="setActivityDateToday()">Today</button>
          <button class="btn btn-sm" onclick="clearActivityDate()">Show All Dates</button>
        </div>
        <div class="view-mode-toggle">
          <button class="mode-btn active" id="modeGrouped" onclick="setActivityGroupMode('grouped')">📁 Group by Project</button>
          <button class="mode-btn" id="modeFlat" onclick="setActivityGroupMode('flat')">📜 Flat List</button>
        </div>
      </div>
      <div id="timelineContainer" class="timeline"></div>
    </div>
  </main>

  <script>
    // Reserved dictionary object for future i18n support
    const i18n = {
      en: {
        projects: "Projects",
        activityFeed: "Activity Feed",
        refresh: "Refresh",
        dateLabel: "Date:",
        today: "Today",
        showAllDates: "Show All Dates",
        groupByProject: "Group by Project",
        flatList: "Flat List",
        noProjectsTitle: "No projects found",
        noProjectsDesc: "No projects match your search or filter criteria.",
        noActivityTitle: "No activity entries",
        noActivityDesc: "No status updates match the selected date or search filter.",
      }
    };
    const currentLang = "en";
    function t(key) {
      return (i18n[currentLang] && i18n[currentLang][key]) || key;
    }

    let projectsData = [];
    let historyData = [];
    let activeProjectFilter = null;
    let activeGroupMode = 'grouped';

    function getTodayDateString() {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return \`\${year}-\${month}-\${day}\`;
    }

    function getLocalDateString(isoStr) {
      if (!isoStr) return '';
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return \`\${year}-\${month}-\${day}\`;
    }

    // Set default date input value to Today on page load
    document.getElementById('activityDateInput').value = getTodayDateString();

    async function fetchData() {
      try {
        const [projRes, histRes, statsRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/history?limit=1000'),
          fetch('/api/stats')
        ]);

        if (projRes.ok) projectsData = await projRes.json();
        if (histRes.ok) historyData = await histRes.json();
        if (statsRes.ok) {
          const stats = await statsRes.json();
          document.getElementById('statProjects').textContent = stats.totalProjects;
          document.getElementById('statActive').textContent = stats.statusCounts.active || 0;
          document.getElementById('statUpdates').textContent = stats.totalEntries;
        }

        render();
      } catch (err) {
        console.error('Failed to load data', err);
      }
    }

    function switchTab(tab) {
      document.getElementById('tabProjects').classList.toggle('active', tab === 'projects');
      document.getElementById('tabActivity').classList.toggle('active', tab === 'activity');
      document.getElementById('viewProjects').classList.toggle('active', tab === 'projects');
      document.getElementById('viewActivity').classList.toggle('active', tab === 'activity');
    }

    function setActivityDateToday() {
      document.getElementById('activityDateInput').value = getTodayDateString();
      render();
    }

    function clearActivityDate() {
      document.getElementById('activityDateInput').value = '';
      render();
    }

    function setActivityGroupMode(mode) {
      activeGroupMode = mode;
      document.getElementById('modeGrouped').classList.toggle('active', mode === 'grouped');
      document.getElementById('modeFlat').classList.toggle('active', mode === 'flat');
      render();
    }

    function filterByProject(slug) {
      activeProjectFilter = slug;
      switchTab('activity');
      render();
    }

    function clearProjectFilter() {
      activeProjectFilter = null;
      render();
    }

    document.getElementById('searchInput').addEventListener('input', render);

    function formatTime(isoStr) {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        return d.toLocaleString();
      } catch {
        return isoStr;
      }
    }

    function renderTimelineItem(item) {
      return \`
        <div class="timeline-item">
          <div class="timeline-header">
            <div class="timeline-meta">
              <span class="project-tag" data-action="filter-project" data-project="\${escapeHtml(item.project)}">\${escapeHtml(item.project)}</span>
              <span class="status-badge status-\${item.status}">\${item.status}</span>
              <span class="source-badge">source: \${item.source}</span>
            </div>
            <div class="time-stamp">\${formatTime(item.occurredAt)}</div>
          </div>
          <div class="entry-summary">\${escapeHtml(item.summary)}</div>
          \${item.progress ? \`<div class="entry-progress"><strong>Progress:</strong> \${escapeHtml(item.progress)}</div>\` : ''}

          \${item.blockers && item.blockers.length ? \`
            <div class="section-box">
              <div class="section-title blockers">⛔ Blockers</div>
              <ul class="bullet-list">
                \${item.blockers.map(b => \`<li>\${escapeHtml(b)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}

          \${item.nextSteps && item.nextSteps.length ? \`
            <div class="section-box">
              <div class="section-title next-steps">🎯 Next Steps</div>
              <ul class="bullet-list">
                \${item.nextSteps.map(n => \`<li>\${escapeHtml(n)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}

          \${item.decisions && item.decisions.length ? \`
            <div class="section-box">
              <div class="section-title decisions">💡 Decisions</div>
              <ul class="bullet-list">
                \${item.decisions.map(d => \`<li>\${escapeHtml(d)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}

          \${item.tags && item.tags.length ? \`
            <div class="tags-container">
              \${item.tags.map(t => \`<span class="pill-tag">#\${escapeHtml(t)}</span>\`).join('')}
            </div>
          \` : ''}
        </div>
      \`;
    }

    document.addEventListener('click', function(e) {
      const filterTarget = e.target.closest('[data-action="filter-project"]');
      if (filterTarget && filterTarget.dataset.project) {
        filterByProject(filterTarget.dataset.project);
      }
      if (e.target && e.target.id === 'btnClearFilter') {
        clearProjectFilter();
      }
    });

    function render() {
      const query = document.getElementById('searchInput').value.trim().toLowerCase();
      const selectedDate = document.getElementById('activityDateInput').value;

      // Render Active Filter Chip
      const filterBar = document.getElementById('filterBarContainer');
      const chip = document.getElementById('activeFilterChip');
      if (activeProjectFilter) {
        filterBar.style.display = 'flex';
        chip.innerHTML = \`\${escapeHtml(activeProjectFilter)} <button id="btnClearFilter">✕</button>\`;
      } else {
        filterBar.style.display = 'none';
      }

      // Render Projects
      const projContainer = document.getElementById('projectsContainer');
      const filteredProjects = projectsData.filter(p => {
        if (activeProjectFilter && p.project !== activeProjectFilter) return false;
        if (!query) return true;
        return p.project.toLowerCase().includes(query) ||
               p.displayName.toLowerCase().includes(query) ||
               (p.description && p.description.toLowerCase().includes(query)) ||
               (p.notes && p.notes.toLowerCase().includes(query)) ||
               (p.latestStatus && p.latestStatus.summary.toLowerCase().includes(query));
      });

      if (filteredProjects.length === 0) {
        projContainer.innerHTML = \`
          <div class="empty-state" style="grid-column: 1 / -1;">
            <h3>\${t('noProjectsTitle')}</h3>
            <p>\${t('noProjectsDesc')}</p>
          </div>\`;
      } else {
        projContainer.innerHTML = filteredProjects.map(p => {
          const status = p.latestStatus ? p.latestStatus.status : 'none';
          return \`
            <div class="project-card">
              <div>
                <div class="card-header">
                  <div>
                    <div class="project-title">\${escapeHtml(p.displayName)}</div>
                    <div class="project-slug">\${escapeHtml(p.project)}</div>
                  </div>
                  <span class="status-badge status-\${status}">\${status}</span>
                </div>
                <div class="card-body">
                  \${p.description ? \`<div class="card-description">\${escapeHtml(p.description)}</div>\` : ''}
                  \${p.notes ? \`<div class="card-notes">\${escapeHtml(p.notes)}</div>\` : ''}
                  \${p.latestStatus ? \`
                    <div class="latest-summary">
                      <div class="latest-summary-title">Latest Update (\${formatTime(p.latestStatus.occurredAt)})</div>
                      <div>\${escapeHtml(p.latestStatus.summary)}</div>
                    </div>
                  \` : ''}
                </div>
              </div>
              <div class="card-footer">
                <span>Created: \${formatTime(p.createdAt)}</span>
                <a class="link-btn" data-action="filter-project" data-project="\${escapeHtml(p.project)}">View Activity →</a>
              </div>
            </div>
          \`;
        }).join('');
      }

      // Render Timeline Feed
      const timelineContainer = document.getElementById('timelineContainer');
      const filteredHistory = historyData.filter(h => {
        if (activeProjectFilter && h.project !== activeProjectFilter) return false;
        if (selectedDate && getLocalDateString(h.occurredAt) !== selectedDate) return false;
        if (!query) return true;
        return h.project.toLowerCase().includes(query) ||
               h.status.toLowerCase().includes(query) ||
               h.summary.toLowerCase().includes(query) ||
               (h.progress && h.progress.toLowerCase().includes(query)) ||
               h.tags.some(t => t.toLowerCase().includes(query));
      });

      if (filteredHistory.length === 0) {
        timelineContainer.innerHTML = \`
          <div class="empty-state">
            <h3>\${t('noActivityTitle')} \${selectedDate ? 'on ' + selectedDate : ''}</h3>
            <p>\${t('noActivityDesc')}</p>
            \${selectedDate ? \`<button class="btn btn-primary" onclick="clearActivityDate()">\${t('showAllDates')}</button>\` : ''}
          </div>\`;
      } else {
        if (activeGroupMode === 'grouped') {
          // Group by Project
          const groups = {};
          filteredHistory.forEach(item => {
            if (!groups[item.project]) groups[item.project] = [];
            groups[item.project].push(item);
          });

          timelineContainer.innerHTML = Object.keys(groups).map(projSlug => {
            const projMeta = projectsData.find(p => p.project === projSlug);
            const titleName = projMeta ? projMeta.displayName : projSlug;
            const entries = groups[projSlug];

            return \`
              <div class="project-group-card">
                <div class="project-group-header">
                  <div class="project-group-title">
                    📁 <span>\${escapeHtml(titleName)}</span>
                    <span class="project-slug">(\${escapeHtml(projSlug)})</span>
                  </div>
                  <span class="project-group-count">\${entries.length} update\${entries.length > 1 ? 's' : ''}</span>
                </div>
                <div class="timeline">
                  \${entries.map(renderTimelineItem).join('')}
                </div>
              </div>
            \`;
          }).join('');
        } else {
          // Flat Timeline
          timelineContainer.innerHTML = filteredHistory.map(renderTimelineItem).join('');
        }
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    fetchData();
  </script>
</body>
</html>`;
}
