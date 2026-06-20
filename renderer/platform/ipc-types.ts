export type MediaAccessType = "microphone" | "camera" | "screen";
export type AskForMediaAccessType = "microphone" | "camera";
export type PermissionStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";
export type SystemPreferencesAuthorizationType = string;

export interface NativeThemeInfo {
  shouldUseDarkColors: boolean;
  themeSource: "system" | "light" | "dark";
}

export interface OpenDialogOptions {
  [k: string]: unknown;
}

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
}

export interface SaveDialogOptions {
  [k: string]: unknown;
}

export interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export interface MessageBoxOptions {
  [k: string]: unknown;
}

export interface MessageBoxResult {
  response: number;
  checkboxChecked: boolean;
}

export interface DatePickerOptions {
  [k: string]: unknown;
}

export interface DatePickerResult {
  canceled: boolean;
  date?: string;
}

export interface LocationPosition {
  latitude: number;
  longitude: number;
}

export interface LocationPositionOptions {
  [k: string]: unknown;
}

export interface PermissionDiagnostic {
  name: string;
  status: PermissionStatus;
}

export interface MenuItemConstructorOptions {
  [k: string]: unknown;
}

export interface PopupOptions {
  [k: string]: unknown;
}

export interface PopupResult {
  [k: string]: unknown;
}
