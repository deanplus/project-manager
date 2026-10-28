import {
  DEFAULT_LOCALE,
  getMessages,
  resolveLocale,
  type Locale,
} from "./i18n.js";
import { getWebUIScript } from "./script.js";
import { WEB_UI_STYLES } from "./styles.js";

export type { I18nKey, Locale, LocaleMessages } from "./i18n.js";

export function getWebUIHTML(defaultLang: Locale = DEFAULT_LOCALE): string {
  const initialLang = resolveLocale(defaultLang);
  const dict = getMessages(initialLang);
  return `<!DOCTYPE html>
<html lang="${dict.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${dict.pageTitle}</title>
  <style>
${WEB_UI_STYLES}
  </style>
</head>
<body>
  <header>
    <div class="header-container">
      <div class="brand">
        <div class="logo-icon">PM</div>
        <div>
          <h1 id="appTitle" data-i18n="appTitle">${dict.appTitle}</h1>
        </div>
      </div>
      <div class="header-right">
        <div class="stats-bar" id="statsBar">
          <div class="stat-pill"><span id="labelStatProjects" data-i18n="statProjectsLabel">${dict.statProjectsLabel}</span> <span class="stat-val" id="statProjects">-</span></div>
          <div class="stat-pill"><span id="labelStatActive" data-i18n="statActiveLabel">${dict.statActiveLabel}</span> <span class="stat-val" id="statActive">-</span></div>
          <div class="stat-pill"><span id="labelStatUpdates" data-i18n="statUpdatesLabel">${dict.statUpdatesLabel}</span> <span class="stat-val" id="statUpdates">-</span></div>
        </div>
        <div class="lang-switch" id="langSwitch" role="group" aria-label="${dict.langSwitchAriaLabel}">
          <button type="button" class="lang-btn ${initialLang === "zh" ? "active" : ""}" id="btnLangZh" onclick="setLang('zh')">中文</button>
          <button type="button" class="lang-btn ${initialLang === "en" ? "active" : ""}" id="btnLangEn" onclick="setLang('en')">English</button>
        </div>
      </div>
    </div>
  </header>

  <div class="controls">
    <div class="search-box">
      <span class="search-icon">🔍</span>
      <input type="text" id="searchInput" class="search-input" data-i18n-placeholder="searchPlaceholder" placeholder="${dict.searchPlaceholder}" />
    </div>
    <div class="nav-tabs">
      <button class="tab-btn active" id="tabProjects" data-i18n="projects" onclick="switchTab('projects')">${dict.projects}</button>
      <button class="tab-btn" id="tabActivity" data-i18n="activityFeed" onclick="switchTab('activity')">${dict.activityFeed}</button>
      <button class="tab-btn" id="tabTodos" data-i18n="todos" onclick="switchTab('todos')">${dict.todos}</button>
    </div>
    <button class="btn" id="btnRefresh" data-i18n="refresh" onclick="refreshData()">${dict.refresh}</button>
  </div>

  <main>
    <div id="filterBarContainer" class="filter-bar" style="display: none;">
      <span id="labelFilterByProject" data-i18n="filteringByProject">${dict.filteringByProject}</span> <span id="activeFilterChip" class="filter-chip"></span>
    </div>

    <div id="actionError" role="alert"></div>
    <div id="viewTodos" class="view-panel">
      <form id="todoForm" class="section-box">
        <label for="todoTitle" data-i18n="todoTitle">${dict.todoTitle}</label>
        <input id="todoTitle" class="search-input" required maxlength="2000" />
        <label for="todoProject" data-i18n="projects">${dict.projects}</label>
        <select id="todoProject" class="date-input"></select>
        <button class="btn" type="submit" data-i18n="addTodo">${dict.addTodo}</button>
      </form>
      <div id="todosContainer"></div>
    </div>
    <!-- Projects View -->
    <div id="viewProjects" class="view-panel active">
      <div id="projectsContainer" class="projects-grid"></div>
    </div>

    <!-- Activity Feed View -->
    <div id="viewActivity" class="view-panel">
      <div class="activity-toolbar">
        <div class="date-picker-wrapper">
          <label for="activityDateInput" id="labelActivityDate" data-i18n="dateLabel">${dict.dateLabel}</label>
          <input type="date" id="activityDateInput" class="date-input" onchange="changeActivityDate()" />
          <button class="btn btn-sm" id="btnDateToday" data-i18n="today" onclick="setActivityDateToday()">${dict.today}</button>
          <button class="btn btn-sm" id="btnShowAllDates" data-i18n="showAllDates" onclick="clearActivityDate()">${dict.showAllDates}</button>
        </div>
        <div class="view-mode-toggle">
          <button class="mode-btn active" id="modeGrouped" data-i18n="groupByProject" onclick="setActivityGroupMode('grouped')">${dict.groupByProject}</button>
          <button class="mode-btn" id="modeFlat" data-i18n="flatList" onclick="setActivityGroupMode('flat')">${dict.flatList}</button>
        </div>
      </div>
      <button id="btnBackToActivities" class="btn" type="button" data-i18n="backToActivities" onclick="returnToActivityList()" hidden>${dict.backToActivities}</button>
      <div id="timelineContainer" class="timeline"></div>
    </div>
  </main>

  <script>
${getWebUIScript(initialLang)}
  </script>
</body>
</html>`;
}
