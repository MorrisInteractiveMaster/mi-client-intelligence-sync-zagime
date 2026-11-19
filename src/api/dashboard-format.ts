const hoursFormat = new Intl.NumberFormat("en-CA", {
  maximumFractionDigits: 3,
});
const calendarFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const timestampFormat = new Intl.DateTimeFormat("en-CA", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});
const monthFormat = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export const reportHours = (seconds: number) =>
  seconds > 0 && seconds < 3.6 ? "<0.001" : hoursFormat.format(seconds / 3600);
export const reportDay = (date: string) =>
  calendarFormat.format(new Date(date));
export const reportMonth = (month: string) =>
  monthFormat.format(new Date(month + "-01"));
export const reportTimestamp = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? timestampFormat.format(new Date(value)) + " UTC"
    : "Date unavailable";
export const today = () => new Date().toISOString().slice(0, 10);
export const projectStatus = {
  planned: "Planned",
  active: "In progress",
  paused: "Paused",
  completed: "Completed",
};
