export const WEB_UI_STYLES = `    :root {
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

    .header-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .stats-bar {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .lang-switch {
      display: inline-flex;
      gap: 0.2rem;
      background: var(--bg);
      padding: 0.2rem;
      border-radius: 6px;
      border: 1px solid var(--border);
    }

    .lang-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      padding: 0.25rem 0.65rem;
      font-size: 0.8rem;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .lang-btn:hover {
      color: var(--heading);
    }

    .lang-btn.active {
      background: var(--accent);
      color: #ffffff;
      font-weight: 600;
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
    }`;
