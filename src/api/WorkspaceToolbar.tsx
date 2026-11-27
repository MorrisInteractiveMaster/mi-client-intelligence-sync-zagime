import { UserRound } from "lucide-react";
import { navigatePlatform } from "./portal-location";
import { createContext, useContext, type ReactNode } from "react";
import "./workspace-banner.css";

export const WorkspaceSessionControls = createContext<ReactNode>(null);
export const WorkspaceNavigationControls = createContext<ReactNode>(null);

export function WorkspaceToolbarControls() {
  const session = useContext(WorkspaceSessionControls);
  const navigation = useContext(WorkspaceNavigationControls);
  if (!session && !navigation) return null;
  return <div className="mi-page-tools">{navigation}{session}</div>;
}

export function WorkspaceBanner({ title, eyebrow, description, actions, period, headingId, headingRef, utilities = true }: {
  title: string;
  eyebrow?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  period?: ReactNode;
  headingId?: string;
  headingRef?: React.Ref<HTMLHeadingElement>;
  utilities?: boolean;
}) {
  return <header className="mi-workspace-banner">
    <div className="mi-banner-top">
      <div className="mi-banner-copy">
        {eyebrow && <span className="mi-banner-eyebrow">{eyebrow}</span>}
        <h1 id={headingId} ref={headingRef} tabIndex={-1}>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {utilities && <WorkspaceToolbarControls />}
    </div>
    {(period || actions) && <div className="mi-banner-context">{period}{actions}</div>}
  </header>;
}

export function WorkspaceAccount({ returnHref, permit, onSignOut }: {
  returnHref?: string;
  permit?: () => boolean;
  onSignOut: () => void | Promise<void>;
}) {
  return <details className="mi-account" onKeyDown={event => {
    if (event.key !== "Escape" || !event.currentTarget.open) return;
    event.preventDefault();
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
  }}>
    <summary aria-label="Account" title="Account"><UserRound size={17} aria-hidden="true" /></summary>
    <div className="mi-account-menu">
      {returnHref && <a href={returnHref} onClick={event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (permit?.() !== false) navigatePlatform(returnHref);
      }}>Return to Morris workspace</a>}
      <button type="button" className="secure-secondary" onClick={() => void onSignOut()}>Sign out</button>
    </div>
  </details>;
}
