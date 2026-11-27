export type QboCompany = { realm: string; name: string; currency: string };
export type QboCustomer = { id: string; name: string; parentId?: string; active: boolean };
export type QboSourceProject = {
  key: string; id: string; name: string; customerId: string; active: boolean; kind: "job" | "project";
};
export type QboProjectRow = QboSourceProject & {
  linked?: string; suggestions: string[]; newlyDiscovered: boolean;
};
export type QboProjectChoice = { id: string; name: string; workOrder?: string };
export type QboSetup = {
  company: QboCompany; confirmed: boolean; root?: QboCustomer; binding?: string;
  projects: QboProjectRow[]; choices: QboProjectChoice[]; native: boolean; discoveredAt?: string;
  held?: number;
};
