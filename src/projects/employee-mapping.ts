export interface TimeEmployeeCandidate {
  employeeKey: string;
  userId: string;
  providerName?: string;
  sourceId: string;
  sourceRevision: string;
  workDate: string;
  workOrder: string;
}

export interface EmployeeProfile {
  id: number;
  name: string;
  title?: string;
  photo?: string;
  alt?: string;
  url: string;
}

export interface EmployeeMappingLink {
  employeeKey: string;
  userId: string;
  profileId: number;
  updatedAt: string;
}

export interface EmployeeMappingsPage {
  revision: number;
  candidates: TimeEmployeeCandidate[];
  profiles: EmployeeProfile[];
  links: EmployeeMappingLink[];
  nextCursor?: string;
}

export interface EmployeeMappingReceipt {
  revision: number;
  changed: boolean;
  link?: EmployeeMappingLink;
}

export type EmployeeMappingChange = {
  action: "link";
  expectedRevision: number;
  employeeKey: string;
  sourceId: string;
  sourceRevision: string;
  profileId: number;
} | {
  action: "unlink";
  expectedRevision: number;
  employeeKey: string;
};
