const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export type SiteChromeConfig = {
  brandName: string;
  showBrandMark: boolean;
};

function boolEnv(name: string, defaultValue: boolean) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  if (TRUE_VALUES.has(value)) {
    return true;
  }
  if (FALSE_VALUES.has(value)) {
    return false;
  }
  return defaultValue;
}

function textEnv(name: string, defaultValue: string) {
  const value = process.env[name]?.trim();
  return value || defaultValue;
}

export function getSiteChromeConfig(): SiteChromeConfig {
  return {
    brandName: textEnv("GIST_BRAND_NAME", "wavey"),
    showBrandMark: boolEnv("GIST_SHOW_BRANDING", false)
  };
}
