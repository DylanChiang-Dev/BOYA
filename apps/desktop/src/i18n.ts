import i18n from "i18next";
import { initReactI18next } from "react-i18next";

void i18n.use(initReactI18next).init({
  lng: "zh-Hant",
  fallbackLng: "zh-Hant",
  supportedLngs: ["zh-Hant"],
  interpolation: { escapeValue: false },
  resources: { "zh-Hant": { translation: {} } },
});

export default i18n;
