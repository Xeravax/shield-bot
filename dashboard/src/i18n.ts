import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "@locales/en-US.json";
import nl from "@locales/nl.json";

void i18n.use(initReactI18next).init({
  resources: {
    "en-US": { translation: enUS },
    nl: { translation: nl },
  },
  lng: "en-US",
  fallbackLng: "en-US",
  interpolation: { escapeValue: false },
});

export default i18n;
