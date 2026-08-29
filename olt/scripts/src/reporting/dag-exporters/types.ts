import type {
  SugiyamaDagReport,
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaNode,
  SugiyamaRankedNode,
  SugiyamaWaveMetrics,
} from "../sugiyama-dag/types.ts";

export type DagExportFormat = "svg" | "mermaid" | "ascii" | "dot" | "json";

export interface DagLayoutNodePoint {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rank: number;
  readonly order: number;
  readonly wave: number;
  readonly lane: number;
  readonly role?: string | undefined;
  readonly assignedAgent?: string | null | undefined;
  readonly validatorAgent?: string | null | undefined;
  readonly gate?: string | undefined;
  readonly effort?: number | undefined;
  readonly badges?: readonly string[] | undefined;
}

export interface DagLayoutEdgePoint {
  readonly from: string;
  readonly to: string;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly waypoints: readonly { readonly x: number; readonly y: number }[];
  readonly type?: string | undefined;
  readonly reason?: string | undefined;
}

export interface DagLayoutCluster {
  readonly id: string;
  readonly label: string;
  readonly rank: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly nodeIds: readonly string[];
}

export interface DagOptimizedLayout {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly DagLayoutNodePoint[];
  readonly edges: readonly DagLayoutEdgePoint[];
  readonly clusters: readonly DagLayoutCluster[];
  readonly metrics: SugiyamaWaveMetrics;
  readonly title?: string | undefined;
}

export interface DagExporterTheme {
  readonly background: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly border: string;
  readonly edgeColor: string;
  readonly edgeHighlight: string;
  readonly nodeFill: string;
  readonly statusColors: Readonly<
    Record<string, { readonly fill: string; readonly stroke: string; readonly text: string }>
  >;
  readonly fontFamily: string;
  readonly fontSize: number;
}

export interface DagExportOptions {
  readonly format?: DagExportFormat | undefined;
  readonly theme?: "dark" | "light" | "high-contrast" | DagExporterTheme | undefined;
  readonly title?: string | undefined;
  readonly nodeWidth?: number | undefined;
  readonly nodeHeight?: number | undefined;
  readonly layerSpacing?: number | undefined;
  readonly nodeSpacing?: number | undefined;
  readonly showBadges?: boolean | undefined;
  readonly showEdgeLabels?: boolean | undefined;
  readonly showClusters?: boolean | undefined;
  readonly includeMetadata?: boolean | undefined;
  readonly direction?: "TB" | "LR" | "BT" | "RL" | undefined;
  readonly customTheme?: Partial<DagExporterTheme> | undefined;
}

export interface DagExportResult {
  readonly format: DagExportFormat;
  readonly content: string;
  readonly mimeType: string;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly layerCount: number;
}

export interface MultiFormatExportResult {
  readonly svg?: DagExportResult | undefined;
  readonly mermaid?: DagExportResult | undefined;
  readonly ascii?: DagExportResult | undefined;
  readonly dot?: DagExportResult | undefined;
  readonly json?: DagExportResult | undefined;
}

export type {
  SugiyamaDagReport,
  SugiyamaEdge,
  SugiyamaLayer,
  SugiyamaNode,
  SugiyamaRankedNode,
  SugiyamaWaveMetrics,
};
