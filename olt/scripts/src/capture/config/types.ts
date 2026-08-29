export interface CaptureViewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor?: number;
}

export interface CaptureUserConfig {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly username?: string;
  readonly email?: string;
  readonly password?: string;
  readonly token?: string;
  readonly avatarUrl?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly cookies?: readonly {
    readonly name: string;
    readonly value: string;
    readonly domain?: string;
    readonly path?: string;
    readonly url?: string;
    readonly httpOnly?: boolean;
    readonly secure?: boolean;
    readonly sameSite?: "Strict" | "Lax" | "None";
  }[];
}

export interface CaptureAuthConfig {
  readonly defaultUser?: string;
  readonly loginUrl?: string;
  readonly usernameSelector?: string;
  readonly passwordSelector?: string;
  readonly submitSelector?: string;
  readonly tokenHeaderName?: string;
  readonly users: Readonly<Record<string, CaptureUserConfig>>;
}

export type SidebarPosition = "top-left" | "top" | "bottom-left" | "bottom" | "none";

export interface SidebarLayoutSelectors {
  readonly container?: string;
  readonly logo?: string;
  readonly userProfile?: string;
  readonly navLinks?: string;
  readonly collapseToggle?: string;
}

export interface SidebarLayoutConfig {
  readonly enabled: boolean;
  readonly logoPosition: SidebarPosition;
  readonly userProfilePosition: SidebarPosition;
  readonly requireZeroNavbar: boolean;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly collapsible?: boolean;
  readonly selectors?: SidebarLayoutSelectors;
}

export interface CaptureAction {
  readonly type: "click" | "fill" | "wait" | "hover";
  readonly selector?: string;
  readonly value?: string;
  readonly timeoutMs?: number;
}

export interface CaptureScreenTarget {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly viewports?: readonly string[];
  readonly auth?: string;
  readonly waitForSelector?: string;
  readonly actions?: readonly CaptureAction[];
  readonly hideSelectors?: readonly string[];
  readonly maskSelectors?: readonly string[];
  readonly fullPage?: boolean;
}

export interface CapturePreset {
  readonly name: string;
  readonly description: string;
  readonly viewports: readonly CaptureViewport[];
  readonly sidebar?: SidebarLayoutConfig;
  readonly authRequired?: boolean;
}

export interface CaptureConfig {
  readonly version: string | number;
  readonly baseUrl: string;
  readonly outputDir?: string;
  readonly auth?: CaptureAuthConfig;
  readonly viewports: Readonly<Record<string, CaptureViewport>>;
  readonly defaultViewport?: string;
  readonly presets?: Readonly<Record<string, CapturePreset>>;
  readonly sidebar?: SidebarLayoutConfig;
  readonly screens: readonly CaptureScreenTarget[];
}
