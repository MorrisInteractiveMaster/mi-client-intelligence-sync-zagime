import { createContext, useContext, useState, type ReactNode } from "react";
import {
  demo,
  persist,
  validate,
  DEMO_MONTH,
  type ReportingState,
} from "./model";
const Context = createContext<null | {
  month: string;
  setMonth: (month: string) => void;
  state: ReportingState;
  issue: string;
  save: (next: ReportingState) => void;
}>(null);
export function ReportingProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try {
      const value = localStorage.getItem("mi-reporting-v2");
      if (value) {
        const state = JSON.parse(value);
        validate(state);
        return { state: state as ReportingState, issue: "" };
      }
    } catch {
      return {
        state: demo(),
        issue:
          "Saved reporting data could not be loaded. This read-only preview leaves the original save unchanged.",
      };
    }
    return { state: demo(), issue: "" };
  });
  const [state, setState] = useState(initial.state);
  const [month, setMonth] = useState(DEMO_MONTH);
  function save(next: ReportingState) {
    if (initial.issue) throw Error(initial.issue);
    persist(localStorage, state, next);
    setState(next);
  }
  return (
    <Context.Provider
      value={{ state, month, setMonth, issue: initial.issue, save }}
    >
      {children}
    </Context.Provider>
  );
}
export function useReporting() {
  const c = useContext(Context);
  if (!c) throw Error("ReportingProvider required");
  return c;
}
