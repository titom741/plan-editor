import { useCallback, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { getProjectBoundsM, type BoundsM } from "../../domain/bounds";
import { createSheet } from "../../domain/sheets";
import { DEFAULT_LABEL_DISPLAY } from "../../domain/display";
import type { PlanObject, Project, Sheet } from "../../domain/types";
import {
  computePrintRaster,
  computeSheetLayout,
  computeTiledSheetLayouts,
  type PrintRaster,
  type SheetLayout,
} from "../../printing/sheetLayout";
import { measureStandLegibility } from "../../printing/standLabels";

/** Screen CSS pixels per inch — the reference for turning a print DPI into a stroke/label multiplier. */
export const CSS_PIXELS_PER_INCH = 96;

/** How many sheets a single tiled export may span before it is refused as a mistake. */
const MAX_TILED_SHEETS = 10;

export type ExportTarget = "pdf" | "png" | "multipage";

interface MultiPageExport {
  layouts: SheetLayout[];
  index: number;
  captures: string[];
}

interface UseSheetExportOptions {
  project: Project;
  /** Objects in draw order — the same list the editor shows, so what prints is what was seen. */
  orderedObjects: readonly PlanObject[];
  visibleLayerIds: ReadonlySet<string>;
  commitChange: (updater: (project: Project) => Project) => void;
  /** Where a failed export reports itself; the hook owns no UI of its own. */
  onError: (message: string) => void;
}

/**
 * Everything about putting the plan on paper: which sheet is being edited,
 * the page layout it implies, and the two-phase export — mount an
 * off-screen stage, wait for it to be ready, rasterise, write the file.
 *
 * It lives outside `Editor` because that two-phase dance needs several
 * pieces of state that mean nothing to the rest of the editor
 * (`pendingExport`, the multi-page cursor, the stage ref, and the
 * print-only toggles), and because "what a sheet is" has nothing to do
 * with selection, layers or history.
 *
 * The export is deliberately *hybrid*: only image objects and the
 * background go through the raster, while every vector shape is handed to
 * the PDF writer as real path operators. A plan printed this way stays
 * sharp and measurable at any zoom in a PDF viewer, instead of being a
 * photograph of a screen.
 */
export function useSheetExport({
  project,
  orderedObjects,
  visibleLayerIds,
  commitChange,
  onError,
}: UseSheetExportOptions) {
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [printGrid, setPrintGrid] = useState(false);
  const [transparentPng, setTransparentPng] = useState(false);
  /**
   * Whether this export holds every text to the readable floor (KL-043).
   *
   * A print setting, not a document one, so it lives here beside the grid
   * and the transparent PNG rather than on the `Sheet`: it says how this
   * sheet is being *printed today*, and writing it into the project would
   * put a rescue into a file that is otherwise a faithful record of what
   * was drawn.
   */
  const [enlargeSmallText, setEnlargeSmallText] = useState(false);
  const [pendingExport, setPendingExport] = useState<ExportTarget | null>(null);
  const [multiPageExport, setMultiPageExport] = useState<MultiPageExport | null>(null);
  const printStageRef = useRef<Konva.Stage>(null);

  // A project saved before KL-009 has no sheets at all; rather than write
  // one into the document the moment the export dialog opens, the editor
  // works against a transient default until the user actually changes
  // something.
  const availableSheets = useMemo(
    () => (project.sheets.length > 0 ? project.sheets : [createSheet()]),
    [project.sheets],
  );
  const sheet = useMemo(
    () =>
      availableSheets.find((candidate) => candidate.id === activeSheetId) ?? availableSheets[0]!,
    [availableSheets, activeSheetId],
  );
  const contentBounds: BoundsM | null = useMemo(() => getProjectBoundsM(project), [project]);
  const sheetLayout = useMemo(
    () => computeSheetLayout(sheet, contentBounds),
    [sheet, contentBounds],
  );
  /** During a tiled export the stage is sized to the tile being captured, not to the single-sheet layout. */
  const activePrintLayout = multiPageExport?.layouts[multiPageExport.index] ?? sheetLayout;
  const printRaster: PrintRaster = useMemo(
    () => computePrintRaster(activePrintLayout),
    [activePrintLayout],
  );
  const labelDisplay = project.labelDisplay ?? DEFAULT_LABEL_DISPLAY;

  /** The shapes the PDF writer draws as vectors: everything visible that isn't a bitmap. */
  const vectorObjects = useMemo(
    () =>
      orderedObjects.filter(
        (object) => visibleLayerIds.has(object.layerId) && object.type !== "image",
      ),
    [orderedObjects, visibleLayerIds],
  );
  /**
   * Whether the stand names survive this scale on paper (KL-041).
   *
   * Computed from the sheet's own scale rather than from the print
   * raster: the number the dialogue reports must be the one attached to
   * the scale the user is choosing, and it must not wait for an export to
   * be started.
   */
  const standLegibility = useMemo(
    () =>
      measureStandLegibility(
        orderedObjects,
        labelDisplay,
        sheet.scaleDenominator,
        enlargeSmallText,
      ),
    [orderedObjects, labelDisplay, sheet.scaleDenominator, enlargeSmallText],
  );

  /** The shapes the off-screen stage must rasterise. For a PNG that is everything; for a PDF, only what vectors can't express. */
  const rasterObjects = useMemo(
    () =>
      pendingExport === "png"
        ? [...orderedObjects]
        : orderedObjects.filter((object) => object.type === "image"),
    [pendingExport, orderedObjects],
  );

  const withSheets = useCallback(
    (current: Project, sheets: Sheet[]): Project => ({
      ...current,
      sheets,
      updatedAt: new Date().toISOString(),
    }),
    [],
  );
  /** The sheets to build on: the document's own, or the transient default the first edit makes real. */
  const persistedSheets = useCallback(
    (current: Project) => (current.sheets.length > 0 ? current.sheets : availableSheets),
    [availableSheets],
  );

  const changeSheet = useCallback(
    (patch: Partial<Sheet>) => {
      commitChange((current) =>
        withSheets(
          current,
          persistedSheets(current).map((candidate) =>
            candidate.id === sheet.id ? { ...candidate, ...patch } : candidate,
          ),
        ),
      );
    },
    [commitChange, sheet.id, persistedSheets, withSheets],
  );

  const addSheet = useCallback(() => {
    const next = createSheet({
      name: `Planche ${availableSheets.length + 1}`,
      paperSize: sheet.paperSize,
      orientation: sheet.orientation,
      scaleDenominator: sheet.scaleDenominator,
      marginMm: sheet.marginMm,
    });
    commitChange((current) => withSheets(current, [...persistedSheets(current), next]));
    setActiveSheetId(next.id);
  }, [availableSheets.length, sheet, commitChange, persistedSheets, withSheets]);

  const duplicateSheet = useCallback(() => {
    const next = createSheet({ ...sheet, name: `${sheet.name} — copie` });
    commitChange((current) => withSheets(current, [...persistedSheets(current), next]));
    setActiveSheetId(next.id);
  }, [sheet, commitChange, persistedSheets, withSheets]);

  const deleteSheet = useCallback(() => {
    if (availableSheets.length <= 1) return;
    const nextSheets = availableSheets.filter((candidate) => candidate.id !== sheet.id);
    commitChange((current) => withSheets(current, nextSheets));
    setActiveSheetId(nextSheets[0]?.id ?? null);
  }, [availableSheets, sheet.id, commitChange, withSheets]);

  const startExport = useCallback((target: "pdf" | "png") => setPendingExport(target), []);

  const startMultiPageExport = useCallback(() => {
    const layouts = computeTiledSheetLayouts(sheet, contentBounds, MAX_TILED_SHEETS);
    setMultiPageExport({ layouts, index: 0, captures: [] });
    setPendingExport("multipage");
  }, [sheet, contentBounds]);

  /**
   * Rasterises the off-screen print stage and hands the result to the
   * chosen writer. Called only from `PrintCanvas`'s `onReady`, so the
   * background image is guaranteed to have decoded — capturing earlier
   * would quietly produce a plan with a blank backdrop.
   */
  const handlePrintCanvasReady = useCallback(() => {
    const target = pendingExport;
    const stage = printStageRef.current;
    if (!target || !stage) return;

    let rasterDataUrl: string;
    try {
      rasterDataUrl = stage.toDataURL({
        mimeType: target === "png" ? "image/png" : "image/jpeg",
        quality: target !== "png" ? 0.92 : undefined,
        pixelRatio: 1,
      });
    } catch (error) {
      // Whatever happens, the off-screen stage must come down, or a
      // failure would leave a huge canvas mounted forever.
      setPendingExport(null);
      setMultiPageExport(null);
      onError(`L'export a échoué : ${describe(error)}. Essayez un format de papier plus petit.`);
      return;
    }

    if (target === "multipage" && multiPageExport) {
      const captures = [...multiPageExport.captures, rasterDataUrl];
      // One tile per render pass: the stage is re-laid-out for the next
      // tile and this handler is called again.
      if (multiPageExport.index + 1 < multiPageExport.layouts.length) {
        setMultiPageExport({ ...multiPageExport, index: multiPageExport.index + 1, captures });
        return;
      }
      setPendingExport(null);
      setMultiPageExport(null);
      const now = new Date();
      void import("../exportSheet")
        .then(({ downloadMultiSheetPdf }) => {
          downloadMultiSheetPdf(
            multiPageExport.layouts.map((layout, index) => {
              const raster = computePrintRaster(layout);
              return {
                project,
                sheet,
                layout,
                drawingJpegDataUrl: captures[index]!,
                pixelWidth: raster.pixelWidth,
                pixelHeight: raster.pixelHeight,
                now,
                vectorObjects,
                vectorViewport: raster.viewport,
                labelDisplay,
                enlargeSmallText,
              };
            }),
          );
        })
        .catch((error: unknown) => onError(`L'export multipage a échoué : ${describe(error)}.`));
      return;
    }

    setPendingExport(null);
    void import("../exportSheet")
      .then(({ downloadPng, downloadSheetPdf }) => {
        if (target === "png") downloadPng(rasterDataUrl, project);
        else
          downloadSheetPdf({
            project,
            sheet,
            layout: activePrintLayout,
            drawingJpegDataUrl: rasterDataUrl,
            pixelWidth: printRaster.pixelWidth,
            pixelHeight: printRaster.pixelHeight,
            now: new Date(),
            vectorObjects,
            vectorViewport: printRaster.viewport,
            labelDisplay,
            enlargeSmallText,
          });
      })
      .catch((error: unknown) =>
        onError(`L'export a échoué : ${describe(error)}. Essayez un format de papier plus petit.`),
      );
  }, [
    pendingExport,
    multiPageExport,
    project,
    sheet,
    activePrintLayout,
    printRaster,
    vectorObjects,
    labelDisplay,
    enlargeSmallText,
    onError,
  ]);

  return {
    sheet,
    availableSheets,
    setActiveSheetId,
    contentBounds,
    sheetLayout,
    printRaster,
    printStageRef,
    pendingExport,
    rasterObjects,
    printGrid,
    setPrintGrid,
    transparentPng,
    setTransparentPng,
    enlargeSmallText,
    setEnlargeSmallText,
    changeSheet,
    addSheet,
    duplicateSheet,
    deleteSheet,
    startExport,
    startMultiPageExport,
    handlePrintCanvasReady,
    standLegibility,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
