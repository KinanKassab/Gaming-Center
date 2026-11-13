/**
 * Configuration core: typed setting definitions/values and organization feature flags.
 * Domain logic lives here — React pages must not resolve or persist settings.
 */
export {
  listSettings,
  setOrganizationSetting,
  setBranchSetting,
  clearOrganizationSetting,
  clearBranchSetting,
  readEffectiveSettingValue,
  setSettingValueInputSchema,
  requireSettingKey,
  type SetSettingValueInput,
  type SettingPresentation,
} from "./settings";

export {
  listFeatures,
  setOrganizationFeature,
  setFeatureInputSchema,
  requireFeatureCode,
  type SetFeatureInput,
  type FeaturePresentation,
} from "./features";
