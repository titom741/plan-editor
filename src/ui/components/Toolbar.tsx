interface ToolbarProps {
  projectName: string;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function Toolbar({ projectName, zoom, canUndo, canRedo, onUndo, onRedo }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__brand">Implantation Événementielle</div>
      <div className="toolbar__project">{projectName}</div>
      <div className="toolbar__history">
        <button type="button" className="toolbar__button" onClick={onUndo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
          ↶ Annuler
        </button>
        <button type="button" className="toolbar__button" onClick={onRedo} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)">
          ↷ Rétablir
        </button>
      </div>
      <div className="toolbar__zoom" data-testid="zoom-indicator">
        Zoom&nbsp;: {Math.round(zoom * 100)}&nbsp;%
      </div>
    </header>
  );
}
