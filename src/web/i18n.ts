import { en } from "./locales/en.js";
import { zh, type I18nKey, type LocaleMessages } from "./locales/zh.js";

export type { I18nKey, LocaleMessages };
export type Locale = "zh" | "en";

export const DEFAULT_LOCALE: Locale = "zh";

export const locales: Record<Locale, LocaleMessages> = {
  zh,
  en,
};

export function resolveLocale(lang?: unknown): Locale {
  return lang === "en" ? "en" : DEFAULT_LOCALE;
}

export function getMessages(lang: Locale): LocaleMessages {
  return locales[lang];
}

export function getClientI18nScript(initialLang: Locale): string {
  return `    const i18n = ${JSON.stringify(locales)};

    let currentLang = "${initialLang}";
    try {
      const savedLang = localStorage.getItem("pmgr_lang");
      if (savedLang === "zh" || savedLang === "en") {
        currentLang = savedLang;
      }
    } catch {
      /* ignore storage errors */
    }

    function t(key) {
      return (i18n[currentLang] && i18n[currentLang][key]) || key;
    }

    function formatStatus(status) {
      const raw = status || "none";
      const key = "status_" + raw;
      const val = t(key);
      return val === key ? raw : val;
    }

    function formatSource(source) {
      const raw = source || "";
      const key = "source_" + raw;
      const val = t(key);
      return val === key ? raw : val;
    }

    function formatUpdateCount(count) {
      if (currentLang === "zh") {
        return \`\${count} 条动态\`;
      }
      return \`\${count} update\${count > 1 ? "s" : ""}\`;
    }

    function applyI18n() {
      document.documentElement.lang = t("htmlLang");
      document.title = t("pageTitle");
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        el.textContent = t(el.dataset.i18n);
      });
      document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
      });
      document.getElementById("langSwitch").setAttribute("aria-label", t("langSwitchAriaLabel"));
      document.getElementById("btnLangZh").classList.toggle("active", currentLang === "zh");
      document.getElementById("btnLangEn").classList.toggle("active", currentLang === "en");
    }

    function setLang(lang) {
      if (lang !== "zh" && lang !== "en") return;
      currentLang = lang;
      try {
        localStorage.setItem("pmgr_lang", currentLang);
      } catch {
        /* ignore storage errors */
      }
      applyI18n();
      render();
    }`;
}
