import { ArrowUpRight, ChevronDown, ChevronsLeft, ChevronsRight, Menu, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { WorkspaceNavigationControls } from "./WorkspaceToolbar";
import { branding, brandAsset } from "../config/branding";
import { ZAGIME_NATION_NAME } from "../config/client-identity";
import "./premium-shell.css";
import "./experience-shell.css";

export type WorkspaceDestination = {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  external?: boolean;
  select: () => void;
  children?: WorkspaceDestination[];
};
export type WorkspaceGroup = { label?: string; destinations: WorkspaceDestination[] };
type SearchResult = { id: string; label: string; context: string; select: () => void };

export function WorkspaceNavigation({ groups, collapsed, onCollapse, busy, children, searchResults = [],
  heading = "Workspace", navigationLabel = "Morris workspace sections", mobileLabel = "Menu", collapseLabel = "navigation", embedded = false }: {
  groups: WorkspaceGroup[];
  collapsed: boolean;
  onCollapse: () => void;
  busy: boolean;
  children: ReactNode;
  searchResults?: SearchResult[];
  heading?: string;
  navigationLabel?: string;
  mobileLabel?: string;
  collapseLabel?: string;
  embedded?: boolean;
}) {
  const menu = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLDialogElement>(null);
  const mobileButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const sidebarSearch = useRef<HTMLButtonElement>(null);
  const searchOpener = useRef<HTMLElement | null>(null);
  const menuSelection = useRef(false);
  const searchSelection = useRef(false);
  const [query, setQuery] = useState("");
  const [closedGroups, setClosedGroups] = useState<string[]>([]);
  const groupPrefix = useId();
  const menuLabel = embedded ? "Client preview menu" : "Workspace menu";
  const searchLabel = embedded ? "Search client preview" : "Search workspace";
  const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const needle = normalized(query.trim());
  const destinations = groups.flatMap(({ label, destinations }) => destinations.flatMap(row => [
    { ...row, context: label ?? heading }, ...(row.children ?? []).map(child => ({ ...child, context: row.label })),
  ]));
  const results = needle ? [...destinations, ...searchResults].filter(item => normalized(item.label + " " + item.context).includes(needle)).slice(0, 14)
    : destinations.slice(0, 7);
  function showSearch() {
    if (!search.current?.open) {
      searchOpener.current = document.activeElement instanceof HTMLElement && document.activeElement.tagName === "BUTTON"
        ? document.activeElement : sidebarSearch.current?.getClientRects().length ? sidebarSearch.current : searchButton.current;
      search.current?.showModal();
    }
    setQuery("");
  }
  useEffect(() => {
    if (embedded) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        showSearch();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [embedded]);
  function navigation(mobile = false) {
    const button = ({ id, label, icon: Icon, active, select, external }: WorkspaceDestination) => <button key={id} type="button" className="mi-nav-item"
      aria-label={label} title={!mobile && collapsed ? label : undefined} aria-current={active ? "page" : undefined}
      disabled={busy} onClick={() => {
        if (mobile) {
          menuSelection.current = true;
          menu.current?.close();
        }
        select();
      }}>
      <Icon size={18} aria-hidden="true" /><span>{label}</span>{external && <ArrowUpRight className="mi-nav-jump" aria-hidden="true" />}
    </button>;
    return <nav aria-label={mobile ? navigationLabel + " menu" : navigationLabel}>
      {groups.map((group, index) => <div className="mi-nav-group" key={group.label ?? index}>
        {group.label && <p>{group.label}</p>}
        {group.destinations.map(row => {
          if (!row.children?.length || (!mobile && collapsed)) return button(row);
          const expanded = !closedGroups.includes(row.id);
          const subtree = groupPrefix + (mobile ? "-drawer-" : "-sidebar-") + row.id;
          return <div key={row.id} className="mi-nav-branch">
            <div>{button(row)}<button type="button" className="mi-nav-expand" aria-expanded={expanded} aria-controls={subtree}
              aria-label={(expanded ? "Collapse " : "Expand ") + row.label} onClick={() => setClosedGroups(current =>
                current.includes(row.id) ? current.filter(id => id !== row.id) : [...current, row.id])}><ChevronDown aria-hidden="true" /></button></div>
            <div className="mi-nav-subtree" id={subtree} hidden={!expanded}>{row.children.map(button)}</div>
          </div>;
        })}
      </div>)}
    </nav>;
  }
  const commands = <div className="mi-workspace-tools">
    <button type="button" className="secure-secondary mi-mobile-navigation" ref={mobileButton}
      aria-haspopup="dialog" onClick={() => menu.current?.showModal()}><Menu aria-hidden="true" /> <span>{mobileLabel}</span></button>
    <button type="button" className="secure-secondary mi-toolbar-search" ref={searchButton} onClick={showSearch} aria-label={searchLabel}><Search aria-hidden="true" />
      <span>{searchLabel}</span>{!embedded && <kbd>Ctrl K</kbd>}</button>
  </div>;
  return <div className={"mi-workspace-frame" + (embedded ? " mi-workspace-embedded" : "")} data-collapsed={collapsed}>
    {!embedded && <aside className="mi-workspace-sidebar">
      <div className="mi-sidebar-brand">
        <div className="mi-sidebar-partner">
          <img className="mi-sidebar-partner-mark" src={brandAsset("branding/morris/morris-sidebar-mark.png")} alt="" width="32" height="32" />
          <span>{branding.partnerName}</span>
        </div>
        <img src={brandAsset("branding/zagime/zagime-main-logo.png")} alt={ZAGIME_NATION_NAME} width="495" height="155" />
      </div>
      <div className="mi-sidebar-heading"><span>{heading}</span>
        <button type="button" className="mi-collapse" onClick={onCollapse} aria-expanded={!collapsed}
          aria-label={(collapsed ? "Expand " : "Collapse ") + collapseLabel} title={(collapsed ? "Expand " : "Collapse ") + collapseLabel}>
          {collapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
        </button>
      </div>
      <button type="button" className="mi-sidebar-search" ref={sidebarSearch} onClick={showSearch} aria-label={searchLabel}>
        <Search size={18} aria-hidden="true" /><span>Search workspace</span><kbd>Ctrl K</kbd>
      </button>
      {navigation()}
    </aside>}
    <div className="mi-workspace-body">
      {embedded && commands}
      <WorkspaceNavigationControls.Provider value={embedded ? null : commands}>{children}</WorkspaceNavigationControls.Provider>
    </div>
    <dialog className="mi-navigation-dialog" aria-label={menuLabel} ref={menu} onClose={() => {
      if (!menuSelection.current) mobileButton.current?.focus();
      menuSelection.current = false;
    }}>
      <div className="mi-dialog-heading"><h2>{menuLabel}</h2><button type="button" className="secure-secondary" aria-label="Close menu" onClick={() => menu.current?.close()}><X aria-hidden="true" /></button></div>
      <button type="button" className="mi-navigation-search" onClick={() => {
        menuSelection.current = true;
        menu.current?.close();
        showSearch();
        searchOpener.current = mobileButton.current;
      }}><Search size={18} aria-hidden="true" />{searchLabel}</button>
      {navigation(true)}
    </dialog>
    <dialog className="mi-search-dialog" aria-label={searchLabel} ref={search}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); search.current?.close(); } }} onClose={() => {
        if (!searchSelection.current) searchOpener.current?.focus();
        searchSelection.current = false;
      }}>
      <div className="mi-dialog-heading"><h2>{searchLabel}</h2><button type="button" className="secure-secondary" aria-label="Close search" onClick={() => search.current?.close()}><X aria-hidden="true" /></button></div>
      <label>Find a page or project<input type="search" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></label>
      {results.length ? <ul>{results.map(item => <li key={item.id}><button type="button" disabled={busy} className="secure-secondary"
        onClick={() => { searchSelection.current = true; search.current?.close(); item.select(); }}><span>{item.label}</span><small>{item.context}</small></button></li>)}</ul>
        : <p role="status">No pages or projects match.</p>}
    </dialog>
  </div>;
}
