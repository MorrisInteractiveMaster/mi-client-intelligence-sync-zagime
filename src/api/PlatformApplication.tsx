import { ArrowLeft, Building2, Home } from "lucide-react";
import { lazy, Suspense, useEffect } from "react";
import type { ProjectWorkspace } from "../projects/model";
import type { SecuredApiClient } from "./client";
import { DeliveryPreview } from "./DeliveryOperations";
import { PlatformHome, PlatformLink } from "./PlatformHome";
import { ProjectClientReport } from "./ProjectClientReport";
import { ProjectStaffWorkspace } from "./ProjectWorkspace";
import { clientBase } from "./platform-routes";
import { navigatePlatform, periodHref, usePlatformRoute } from "./portal-location";

const Control = lazy(async () => ({ default: (await import("./PlatformControl")).PlatformControl }));
type Props = {
  client: SecuredApiClient;
  workspace: ProjectWorkspace;
  month: string;
  unsaved: boolean;
  onUnsavedChange: (dirty: boolean) => void;
  onDenied: () => void;
};

export function PlatformApplication({ client, workspace, month, unsaved, onUnsavedChange, onDenied }: Props) {
  const route = usePlatformRoute();
  const tenant = workspace.tenant.id;
  const staff = workspace.role === "staff";
  useEffect(() => {
    if (route?.kind === "home") {
      if (staff) document.title = "Morris Interactive · Client Intelligence Platform";
      else navigatePlatform(periodHref(clientBase, month), true);
    }
  }, [route?.kind, staff, month]);
  if (!route) return null;
  if (route.kind === "home") return staff ? <PlatformHome workspace={workspace} month={month} /> : <p role="status">Opening your client dashboard…</p>;

  const blocked = (route.kind === "staff" && !staff) ||
    (route.kind === "control" && (!staff || !workspace.platformAdmin)) ||
    (route.kind === "client" && "/clients/" + route.slug !== clientBase);
  if (blocked) return <main id="platform-content" className="platform-denied">
    <h2>Access unavailable</h2><p role="alert">This destination is outside your approved access.</p>
    <PlatformLink href={periodHref(staff ? "/" : clientBase, month)}>{staff ? "Return to Morris Home" : "Open your client dashboard"}</PlatformLink>
  </main>;
  const permit = () => !unsaved || window.confirm("Leave without saving your changes?");
  return <>
    {staff && <nav className="platform-context" aria-label="Platform destinations">
      <PlatformLink href={periodHref("/", month)} beforeNavigate={permit}><Home aria-hidden="true" size={17} /> Morris Home</PlatformLink>
      {route.kind === "staff" && <PlatformLink href={periodHref(clientBase, month)} beforeNavigate={permit}><Building2 aria-hidden="true" size={17} /> View as Zagimē</PlatformLink>}
      {route.kind === "client" && <PlatformLink href={periodHref("/workspace", month)} beforeNavigate={permit}><ArrowLeft aria-hidden="true" size={17} /> Back to Morris Workspace</PlatformLink>}
    </nav>}
    {route.kind === "staff" && <main id="platform-content">
      <ProjectStaffWorkspace client={client} tenant={tenant} workspace={workspace} month={month} onDenied={onDenied} onUnsavedChange={onUnsavedChange} />
    </main>}
    {route.kind === "control" && <Suspense fallback={<p role="status">Opening Control Panel…</p>}>
      <Control client={client} workspace={workspace} month={month} section={route.section} onDenied={onDenied} onUnsavedChange={onUnsavedChange} />
    </Suspense>}
    {route.kind === "client" && <main id="platform-content" className={staff ? "platform-client-preview" : undefined}>
      {staff ? <DeliveryPreview client={client} tenant={tenant} month={month} standalone /> :
        <ProjectClientReport client={client} tenant={tenant} month={month} onDenied={onDenied} />}
    </main>}
  </>;
}
