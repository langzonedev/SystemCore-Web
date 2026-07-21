globalThis.SystemCoreConfig = Object.freeze({
  APP_NAME: "SystemCore",
  APP_VERSION: "0.5.4",
  PROJECT_SCHEMA_VERSION: "1.0",
  STORAGE_KEY: "systemcore.project.v1",
  LEGACY_STORAGE_KEYS: ["trueru.project.v1", "systemcore.prototype.v2"],
  NATURAL_SORT: new Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
});
