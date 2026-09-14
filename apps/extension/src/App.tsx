/**
 * The one shared shell mounted from every surface (popup, sidepanel,
 * and — once the provider-bridge layer lands — the approval window),
 * per core-design.md's Entrypoint layout: "apps/extension/src/App.tsx
 * is the one shared shell mounted with a different `layout` prop per
 * surface."
 *
 * This scaffold layer owns only the shell and a placeholder view; every
 * later layer replaces the placeholder with real screens, never the
 * shell's mounting contract.
 */
export type AppLayout = "popup" | "sidepanel" | "approval";

export interface AppProps {
  layout: AppLayout;
}

export function App({ layout }: AppProps) {
  return (
    <div data-layout={layout} className="min-h-full bg-background text-foreground">
      <p className="p-4 text-sm">Gleam — {layout}</p>
    </div>
  );
}

export default App;
