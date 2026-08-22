import type {
  CaptureAction,
  CaptureAuthConfig,
  CaptureConfig,
  CaptureScreenTarget,
  CaptureUserConfig,
  CaptureViewport,
} from "../config/types.ts";
import type { CognitiveAnalysisReport, EvaluatedCriterion } from "../validator/types.ts";

export interface ResolvedSessionAuth {
  readonly userId: string;
  readonly role: string;
  readonly name: string;
  readonly token?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly cookies?: readonly {
    readonly name: string;
    readonly value: string;
    readonly domain?: string;
    readonly path?: string;
  }[];
  readonly resolvedAt: string;
}

export interface AABB {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface ExtractedComputedStyles {
  readonly display: string;
  readonly position: string;
  readonly zIndex: number | string;
  readonly color: string;
  readonly backgroundColor: string;
  readonly overflowX: string;
  readonly overflowY: string;
  readonly fontSize?: string;
  readonly lineHeight?: string;
  readonly opacity?: string;
  readonly visibility?: string;
}

export interface ExtractedElementMetrics {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
}

export interface ExtractedElementPhysics {
  readonly selector: string;
  readonly tagName: string;
  readonly id?: string;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly bounds: AABB;
  readonly computedStyles: ExtractedComputedStyles;
  readonly metrics: ExtractedElementMetrics;
  readonly textSnippet?: string;
}

export interface LayoutOverflowEntry {
  readonly selector: string;
  readonly overflowX: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

export interface TextClippingEntry {
  readonly selector: string;
  readonly clippingY: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

export interface DomPhysicsSnapshot {
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor?: number;
  };
  readonly scrollPosition: { readonly x: number; readonly y: number };
  readonly elements: readonly ExtractedElementPhysics[];
  readonly layoutOverflows: readonly LayoutOverflowEntry[];
  readonly textClippings: readonly TextClippingEntry[];
  readonly capturedAt: string;
}

export interface CompanionManifest {
  readonly schema: "companion.manifest.v1";
  readonly screenId: string;
  readonly screenName: string;
  readonly path: string;
  readonly viewport: string;
  readonly dimensions: {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor: number;
  };
  readonly imageFile: string;
  readonly imageSizeBytes: number;
  readonly imageSha256?: string;
  readonly capturedAt: string;
  readonly authRole?: string;
  readonly physics: DomPhysicsSnapshot;
  readonly sidebarAnalysis?: {
    readonly position: string;
    readonly visible: boolean;
    readonly width: number;
  };
  readonly criteria?: readonly EvaluatedCriterion[] | undefined;
  readonly cognitiveAnalysis?: CognitiveAnalysisReport | undefined;
  readonly url: string;
}

export interface CaptureItemResult {
  readonly screenId: string;
  readonly screenName: string;
  readonly viewport: string;
  readonly imagePath: string;
  readonly manifestPath: string;
  readonly sizeBytes: number;
  readonly manifest: CompanionManifest;
}

export interface CaptureError {
  readonly screenId: string;
  readonly viewport: string;
  readonly error: string;
  readonly timestamp: string;
}

export interface CaptureRunResult {
  readonly success: boolean;
  readonly totalCaptures: number;
  readonly outDir: string;
  readonly captures: readonly CaptureItemResult[];
  readonly errors: readonly CaptureError[];
}

export interface CapturePageDriver {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  goto(
    url: string,
    options?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeout?: number },
  ): Promise<void>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>;
  screenshot(options: { path?: string; fullPage?: boolean }): Promise<Buffer | Uint8Array>;
  evaluate<T, A = unknown>(
    pageFunction: ((arg: A) => T | Promise<T>) | string,
    arg?: A,
  ): Promise<T>;
  click?(selector: string): Promise<void>;
  fill?(selector: string, value: string): Promise<void>;
  hover?(selector: string): Promise<void>;
  waitForTimeout?(ms: number): Promise<void>;
}

export interface CaptureBrowserDriver {
  newPage(): Promise<CapturePageDriver>;
  close(): Promise<void>;
}

export interface CaptureBrowserProvider {
  launch(options?: { headless?: boolean }): Promise<CaptureBrowserDriver>;
}

export interface CaptureRunOptions {
  readonly config?: CaptureConfig;
  readonly configPath?: string;
  readonly outDir?: string;
  readonly runId?: string;
  readonly capsuleDir?: string;
  readonly targetScreens?: readonly string[];
  readonly targetViewports?: readonly string[];
  readonly headless?: boolean;
  readonly baseUrl?: string;
  readonly browserProvider?: CaptureBrowserProvider;
}
