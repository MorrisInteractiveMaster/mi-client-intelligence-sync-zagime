import { ArrowUpRight, ChevronsLeft, ChevronsRight, Menu, Search, X, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export type WorkspaceDestination = {
  id: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
  external?: boolean;
  select: () => void;
};
export type WorkspaceGroup = { label?: string; destinations: WorkspaceDestination[] };
type SearchResult = { id: string; label: string; context: string; select: () => void };

export function WorkspaceNavigation({ groups, collapsed, onCollapse, busy, children, searchResults = [] }: {
  groups: WorkspaceGroup[];
  collapsed: boolean;
  onCollapse: () => void;
  busy: boolean;
  children: ReactNode;
  searchResults?: SearchResult[];
}) {
  const menu = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLDialogElement>(null);
  const mobileButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const normalized = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
  const needle = normalized(query.trim());
  const destinations = groups.flatMap(({ label, destinations }) => destinations.map(row => ({ ...row, context: label ?? "Workspace" })));
  const results = needle ? [...destinations, ...searchResults].filter(item => normalized(item.label + " " + item.context).includes(needle)).slice(0, 14)
    : destinations.slice(0, 7);
  function showSearch() {
    if (!search.current?.open) search.current?.showModal();
    setQuery("");
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        showSearch();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  function navigation(mobile = false) {
    return <nav aria-label="Morris workspace sections">
      {groups.map((group, index) => <div className="mi-nav-group" key={group.label ?? index}>
        {group.label && <p>{group.label}</p>}
        {group.destinations.map(({ id, label, icon: Icon, active, select, external }) => <button key={id} type="button"
          aria-label={label} title={!mobile && collapsed ? label : undefined} aria-current={active ? "page" : undefined}
          disabled={busy} onClick={() => { if (mobile) menu.current?.close(); select(); }}>
          <Icon size={18} aria-hidden="true" /><span>{label}</span>{external && <ArrowUpRight className="mi-nav-jump" aria-hidden="true" />}
        </button>)}
      </div>)}
    </nav>;
  }
  return <div className="mi-workspace-frame" data-collapsed={collapsed}>
    <aside className="mi-workspace-sidebar">
      <div className="mi-sidebar-heading"><span>Workspace</span>
        <button type="button" className="mi-collapse" onClick={onCollapse} aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"}>
          {collapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
        </button>
      </div>
      {navigation()}
    </aside>
    <div className="mi-workspace-body">
      <div className="mi-workspace-tools">
        <button type="button" className="secure-secondary mi-mobile-navigation" ref={mobileButton}
          onClick={() => menu.current?.showModal()}><Menu aria-hidden="true" /> Menu</button>
        <button type="button" className="secure-secondary" ref={searchButton} onClick={showSearch}><Search aria-hidden="true" />
          Search workspace <kbd>Ctrl K</kbd></button>
      </div>
      {children}
    </div>
    <dialog className="mi-navigation-dialog" aria-label="Workspace menu" ref={menu} onClose={() => mobileButton.current?.focus()}>
      <div className="mi-dialog-heading"><h2>Workspace menu</h2><button type="button" className="secure-secondary" aria-label="Close menu" onClick={() => menu.current?.close()}><X aria-hidden="true" /></button></div>
      {navigation(true)}
    </dialog>
    <dialog className="mi-search-dialog" aria-label="Search workspace" ref={search}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); search.current?.close(); } }} onClose={() => searchButton.current?.focus()}>
      <div className="mi-dialog-heading"><h2>Search workspace</h2><button type="button" className="secure-secondary" aria-label="Close search" onClick={() => search.current?.close()}><X aria-hidden="true" /></button></div>
      <label>Find a page or project<input type="search" value={query} onChange={event => setQuery(event.target.value)} autoFocus /></label>
      {results.length ? <ul>{results.map(item => <li key={item.id}><button type="button" disabled={busy} className="secure-secondary"
        onClick={() => { search.current?.close(); item.select(); }}><span>{item.label}</span><small>{item.context}</small></button></li>)}</ul>
        : <p role="status">No pages or projects match.</p>}
    </dialog>
  </div>;
}
