import { getClientI18nScript, type Locale } from "./i18n.js";

export function getWebUIScript(initialLang: Locale): string {
  return `${getClientI18nScript(initialLang)}

    let todosData = [];
    let projectsData = [];
    let historyData = [];
    let focusedEntry = null;
    let activeProjectFilter = null;
    let activeGroupMode = 'grouped';
    let initialNavigation = true;

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
    applyI18n();

    async function fetchData() {
      try {
        const [projRes, histRes, statsRes, todosRes] = await Promise.all([
          fetch('/api/projects'),
          fetch('/api/history?limit=1000'),
          fetch('/api/stats'),
          fetch('/api/todos')
        ]);

        if (![projRes, histRes, statsRes, todosRes].every(response => response.ok)) throw new Error(t('entryLoadError'));
        projectsData = await projRes.json();
        if (histRes.ok) historyData = await histRes.json();
        if (statsRes.ok) {
          const stats = await statsRes.json();
          document.getElementById('statProjects').textContent = stats.totalProjects;
          document.getElementById('statActive').textContent = stats.statusCounts.active || 0;
          document.getElementById('statUpdates').textContent = stats.totalEntries;
        }

        if (!todosRes.ok) throw new Error('Todos unavailable');
        todosData = await todosRes.json();
        render();
        if (typeof location !== 'undefined') {
          const ref = new URLSearchParams(location.search).get('entry');
          if (ref) {
            if (initialNavigation) switchTab('activity');
            const response = await fetch('/api/entries/' + encodeURIComponent(ref));
            if (!response.ok) throw new Error('Entry unavailable');
            focusedEntry = await response.json();
            render();
          }
        }
        initialNavigation = false;
        return true;
      } catch (err) {
        document.getElementById('actionError').textContent = t('entryLoadError');
        console.error('Failed to load data', err);
        document.getElementById('timelineContainer').textContent = t('entryLoadError');
        return false;
      }
    }

    function switchTab(tab) {
      document.getElementById('tabTodos').classList.toggle('active', tab === 'todos');
      document.getElementById('viewTodos').classList.toggle('active', tab === 'todos');
      document.getElementById('tabProjects').classList.toggle('active', tab === 'projects');
      document.getElementById('tabActivity').classList.toggle('active', tab === 'activity');
      document.getElementById('viewProjects').classList.toggle('active', tab === 'projects');
      document.getElementById('viewActivity').classList.toggle('active', tab === 'activity');
    }

    function clearEntryFocus() {
      focusedEntry = null;
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('entry');
        window.history.replaceState(null, '', url);
      }
    }

    function returnToActivityList() {
      clearEntryFocus();
      activeProjectFilter = null;
      document.getElementById('searchInput').value = '';
      document.getElementById('activityDateInput').value = '';
      render();
    }

    function refreshData() {
      clearEntryFocus();
      return fetchData();
    }

    function changeActivityDate() {
      clearEntryFocus();
      render();
    }

    function setActivityDateToday() {
      clearEntryFocus();
      document.getElementById('activityDateInput').value = getTodayDateString();
      render();
    }

    function clearActivityDate() {
      clearEntryFocus();
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
      clearEntryFocus();
      activeProjectFilter = slug;
      switchTab('activity');
      render();
    }

    function clearProjectFilter() {
      clearEntryFocus();
      activeProjectFilter = null;
      render();
    }

    document.getElementById('searchInput').addEventListener('input', () => { clearEntryFocus(); render(); });

    function formatTime(isoStr) {
      if (!isoStr) return '';
      try {
        const d = new Date(isoStr);
        return d.toLocaleString(currentLang === 'zh' ? 'zh-CN' : 'en-US');
      } catch {
        return isoStr;
      }
    }

    function renderTimelineItem(item) {
      const status = item.effectiveStatus || item.status;
      return \`
        <div class="timeline-item" id="entry-\${escapeHtml(item.uid || item.id)}">
          <div class="timeline-header">
            <div class="timeline-meta">
              <span class="project-tag" data-action="filter-project" data-project="\${escapeHtml(item.project)}">\${escapeHtml(item.project)}</span>
              <span class="status-badge status-\${escapeHtml(status)}">\${escapeHtml(formatStatus(status))}</span>
              <span class="source-badge">\${escapeHtml(t(item.isCurrent ? "currentStatus" : "superseded"))}</span>
              <span class="source-badge">\${escapeHtml(t('sourcePrefix'))}\${escapeHtml(formatSource(item.source))}</span>
            </div>
            <div class="time-stamp">\${formatTime(item.occurredAt)}</div>
          </div>
          <div class="entry-summary">\${escapeHtml(item.summary)}</div>
          \${item.completedBy ? \`<div class="completion-evidence">
            <a class="link-btn" href="?entry=\${encodeURIComponent(item.completedBy.uid)}">\${escapeHtml(t('completedBy'))}: #\${item.completedBy.id} — \${escapeHtml(item.completedBy.summary)}</a>
            <div>\${escapeHtml(t('followUpTime'))} \${formatTime(item.completedBy.occurredAt)}</div>
            <div>\${escapeHtml(t('completionRecorded'))} \${formatTime(item.completedBy.recordedAt)}</div>
          </div><details><summary>\${escapeHtml(t('originalRecord'))} · \${escapeHtml(t('originalStatus'))} \${escapeHtml(formatStatus(item.status))}</summary>\` : ''}
          \${item.progress ? \`<div class="entry-progress"><strong>\${escapeHtml(t('progressLabel'))}</strong> \${escapeHtml(item.progress)}</div>\` : ''}

          \${item.blockers && item.blockers.length ? \`
            <div class="section-box">
              <div class="section-title blockers">\${escapeHtml(t('blockersTitle'))}</div>
              <ul class="bullet-list">
                \${item.blockers.map(b => \`<li>\${escapeHtml(b)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}

          \${item.nextSteps && item.nextSteps.length ? \`
            <div class="section-box">
              <div class="section-title next-steps">\${escapeHtml(t('nextStepsTitle'))}</div>
              <ul class="bullet-list">
                \${item.nextSteps.map((n, index) => todosData.some(todo => todo.entryUid === (item.nextStepsSourceUid || item.uid) && todo.stepIndex === index) ? '' : \`<li>\${escapeHtml(n)} <button class="btn btn-sm" data-action="convert-todo" data-entry="\${escapeHtml(item.uid)}" data-index="\${index}">\${escapeHtml(t('convertTodo'))}</button></li>\`).join('')}
              </ul>
            </div>
          \` : ''}

          \${item.decisions && item.decisions.length ? \`
            <div class="section-box">
              <div class="section-title decisions">\${escapeHtml(t('decisionsTitle'))}</div>
              <ul class="bullet-list">
                \${item.decisions.map(d => \`<li>\${escapeHtml(d)}</li>\`).join('')}
              </ul>
            </div>
          \` : ''}

          \${item.tags && item.tags.length ? \`
            <div class="tags-container">
              \${item.tags.map(tag => \`<span class="pill-tag">#\${escapeHtml(tag)}</span>\`).join('')}
            </div>
          \` : ''}
          \${item.completedBy ? '</details>' : ''}
          <div class="section-box">
            <button class="btn" data-action="add-todo" data-entry="\${escapeHtml(item.uid)}">\${escapeHtml(t('addTodo'))}</button>
            \${status !== 'completed' ? \`<button class="btn" data-action="complete-entry" data-entry="\${escapeHtml(item.uid)}">\${escapeHtml(t('complete'))}</button>\` : ''}
            \${todosData.filter(todo => todo.entryUid === item.uid || todo.entryUid === item.nextStepsSourceUid).map(renderTodo).join('')}
          </div>
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

      renderTodos(query);
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
        const status = p.latestStatus ? p.latestStatus.status : 'none';
        return p.project.toLowerCase().includes(query) ||
               p.displayName.toLowerCase().includes(query) ||
               status.toLowerCase().includes(query) ||
               formatStatus(status).toLowerCase().includes(query) ||
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
                  <span class="status-badge status-\${status}">\${escapeHtml(formatStatus(status))}</span>
                </div>
                <div class="card-body">
                  \${p.description ? \`<div class="card-description">\${escapeHtml(p.description)}</div>\` : ''}
                  \${p.notes ? \`<div class="card-notes">\${escapeHtml(p.notes)}</div>\` : ''}
                  \${p.latestStatus ? \`
                    <div class="latest-summary">
                      <div class="latest-summary-title">\${escapeHtml(t('latestUpdate'))} (\${formatTime(p.latestStatus.occurredAt)})</div>
                      <div>\${escapeHtml(p.latestStatus.summary)}</div>
                    </div>
                  \` : ''}
                </div>
              </div>
              <div class="card-footer">
                <span>\${escapeHtml(t('createdLabel'))} \${formatTime(p.createdAt)}</span>
                <button class="btn" data-action="project-todos" data-project="\${escapeHtml(p.project)}">\${escapeHtml(t('viewTodos'))}</button>
                <a class="link-btn" data-action="filter-project" data-project="\${escapeHtml(p.project)}">\${escapeHtml(t('viewActivity'))}</a>
              </div>
            </div>
          \`;
        }).join('');
      }

      document.getElementById('btnBackToActivities').hidden = !focusedEntry;

      // Render Timeline Feed
      const timelineContainer = document.getElementById('timelineContainer');
      const filteredHistory = focusedEntry ? [focusedEntry] : historyData.filter(h => {
        if (activeProjectFilter && h.project !== activeProjectFilter) return false;
        if (selectedDate && getLocalDateString(h.occurredAt) !== selectedDate) return false;
        if (!query) return true;
        return h.project.toLowerCase().includes(query) ||
               (h.effectiveStatus || h.status).toLowerCase().includes(query) ||
               formatStatus(h.effectiveStatus || h.status).toLowerCase().includes(query) ||
               h.status.toLowerCase().includes(query) ||
               formatStatus(h.status).toLowerCase().includes(query) ||
               h.summary.toLowerCase().includes(query) ||
               (h.progress && h.progress.toLowerCase().includes(query)) ||
               h.tags.some(tag => tag.toLowerCase().includes(query));
      });

      if (filteredHistory.length === 0) {
        const emptyTitle = selectedDate
          ? t('noActivityOnDate').replace('{date}', selectedDate)
          : t('noActivityTitle');
        timelineContainer.innerHTML = \`
          <div class="empty-state">
            <h3>\${escapeHtml(emptyTitle)}</h3>
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
                  <span class="project-group-count">\${escapeHtml(formatUpdateCount(entries.length))}</span>
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


    function projectOptions(selected) {
      return '<option value="">' + escapeHtml(t('noProject')) + '</option>' + projectsData.map(p =>
        '<option value="' + escapeHtml(p.project) + '"' + (selected === p.project ? ' selected' : '') + '>' + escapeHtml(p.displayName) + '</option>').join('');
    }
    function renderTodo(todo) {
      return '<div class="section-box"><strong>' + escapeHtml(todo.title) + '</strong> · ' + escapeHtml(t('todo_' + todo.status)) +
        (todo.project ? ' · ' + escapeHtml(todo.project) : '') +
        (todo.entryUid ? ' <a class="link-btn" href="?entry=' + encodeURIComponent(todo.entryUid) + '">' + escapeHtml(t('sourceEntry')) + '</a>' :
          ' <label>' + escapeHtml(t('chooseProject')) + ' <select data-todo-project="' + escapeHtml(todo.uid) + '">' + projectOptions(todo.project) + '</select></label>') +
        ' <button class="btn" data-action="todo-status" data-uid="' + escapeHtml(todo.uid) + '" data-status="' + (todo.status === 'open' ? 'completed' : 'open') + '">' + escapeHtml(t(todo.status === 'open' ? 'complete' : 'reopen')) + '</button>' +
        (todo.status === 'open' ? ' <button class="btn" data-action="todo-status" data-uid="' + escapeHtml(todo.uid) + '" data-status="cancelled">' + escapeHtml(t('cancelTodo')) + '</button>' : '') + '</div>';
    }
    function renderTodos(query) {
      const select = document.getElementById('todoProject');
      select.innerHTML = projectOptions(select.value);
      const todos = todosData.filter(todo => (!activeProjectFilter || todo.project === activeProjectFilter) &&
        (!query || (todo.title + ' ' + (todo.project || '')).toLowerCase().includes(query)));
      document.getElementById('todosContainer').innerHTML = todos.length ? todos.map(renderTodo).join('') : '<p>' + escapeHtml(t('noTodos')) + '</p>';
    }
    async function mutate(path, data) {
      const response = await fetch(path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Request failed');
      if (!await fetchData()) { const error = new Error(t('savedRefreshError')); error.saved = true; throw error; }
    }
    async function runAction(element, action) {
      if (element.disabled) return;
      element.disabled = true;
      document.getElementById('actionError').textContent = '';
      try { await action(); }
      catch (error) { document.getElementById('actionError').textContent = error.message; }
      finally { element.disabled = false; }
    }
    document.getElementById('todoForm').addEventListener('submit', function(event) {
      event.preventDefault();
      const button = this.querySelector('button');
      runAction(button, async () => {
        try {
          await mutate('/api/todos', {title: document.getElementById('todoTitle').value, project: document.getElementById('todoProject').value || null});
          document.getElementById('todoTitle').value = '';
        } catch (error) {
          if (error.saved) document.getElementById('todoTitle').value = '';
          throw error;
        }
      });
    });
    document.addEventListener('change', function(event) {
      const select = event.target.closest('[data-todo-project]');
      if (select) runAction(select, () => mutate('/api/todos/' + select.dataset.todoProject, {project: select.value || null}));
    });
    document.addEventListener('click', function(event) {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const data = button.dataset;
      if (data.action === 'project-todos') { activeProjectFilter = data.project; switchTab('todos'); render(); document.getElementById('todoProject').value = data.project; return; }
      if (data.action === 'complete-entry') runAction(button, () => mutate('/api/entries/' + data.entry + '/complete', {}));
      if (data.action === 'convert-todo') runAction(button, () => mutate('/api/entries/' + data.entry + '/todos', {index: Number(data.index)}));
      if (data.action === 'todo-status') runAction(button, () => mutate('/api/todos/' + data.uid, {status: data.status}));
      if (data.action === 'add-todo') {
        const title = window.prompt(t('todoTitle'));
        if (title && title.trim()) runAction(button, () => mutate('/api/entries/' + data.entry + '/todos', {title}));
      }
    });

    fetchData();`;
}
