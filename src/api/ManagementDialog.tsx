import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function ManagementDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const opener = document.activeElement;
    node.showModal();
    return () => {
      if (node.open) node.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  function dismiss() {
    dialog.current?.close();
    close();
  }
  return <dialog ref={dialog} className="mi-picker-dialog mi-management-dialog" aria-labelledby={id}
    onCancel={event => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      dismiss();
    }}>
    <header><h3 id={id}>{title}</h3><button type="button" className="secure-secondary" onClick={dismiss} aria-label="Close dialog"><X size={19} /></button></header>
    {children}
  </dialog>;
}
