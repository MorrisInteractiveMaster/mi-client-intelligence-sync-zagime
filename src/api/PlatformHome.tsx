import { ArrowRight, Building2, Eye, LayoutGrid, ShieldCheck } from "lucide-react";
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { brandAsset, branding } from "../config/branding";
import type { ProjectWorkspace } from "../projects/model";
import { navigatePlatform, periodHref } from "./portal-location";
import { clientBase } from "./platform-routes";

export function PlatformLink({ href, beforeNavigate, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; beforeNavigate?: () => boolean }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (beforeNavigate?.() !== false) navigatePlatform(href);
  }
  return <a {...props} href={href} onClick={follow} />;
}

export function PlatformHome({ workspace, month }: { workspace: ProjectWorkspace; month: string }) {
  const cards = [
    { title: "Open Morris Workspace", label: "Plan delivery, organize projects and assign recorded time.", href: "/workspace", icon: LayoutGrid },
    { title: "View Zagimē Dashboard", label: "See what an approved client access profile can view.", href: clientBase, icon: Building2 },
    { title: "Preview unpublished changes", label: "Review drafts in a private staff preview before publishing.", href: clientBase, query: { previewMode: "draft" }, icon: Eye },
    ...(workspace.platformAdmin ? [{ title: "Open Control Panel", label: "Manage access, reporting preferences and integration health.", href: "/control", icon: ShieldCheck }] : []),
  ];
  return <main id="platform-content" className="platform-home">
    <section className="platform-hero mi-home-stage">
      <div className="mi-home-stage-content"><span>Client Intelligence Platform</span>
        <h2>Morris Interactive</h2>
        <p>Manage delivery and report progress for {workspace.tenant.name}.</p>
        <PlatformLink className="mi-home-primary" href={periodHref("/workspace", month)}>Go to workspace <ArrowRight size={18} aria-hidden="true" /></PlatformLink>
      </div>
    </section>
    <nav className="platform-destinations" aria-label="Your destinations">
      {cards.map(({ title, label, href, icon: Icon, query }) => <PlatformLink className="platform-card" key={title} href={periodHref(href, month, query)}>
        <span className="platform-card-icon"><Icon aria-hidden="true" size={22} /></span>
        <strong>{title}</strong><span>{label}</span><ArrowRight className="platform-card-arrow" aria-hidden="true" size={20} />
      </PlatformLink>)}
    </nav>
    {branding.partnerLogo && <img className="platform-home-wordmark" src={brandAsset(branding.partnerLogo)} alt="Morris Interactive" />}
  </main>;
}
